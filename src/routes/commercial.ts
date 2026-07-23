import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import { CostEntryStatus, CostEntryType, FileAccess, FileStorageProvider, ForecastConfidence, Prisma, Role, Status } from "@prisma/client";
import { z } from "zod";
import { allow, requireOrganisationProject } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { summariseProjectCost } from "../lib/commercial-costs.js";
import { analyseTender, extractTenderText } from "../lib/tender-parser.js";
import { createHash, randomUUID } from "node:crypto";

const managers = allow(Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER, Role.OPERATIONS_MANAGER);
const activeCostStatuses: CostEntryStatus[] = [CostEntryStatus.ACCRUED, CostEntryStatus.INVOICED, CostEntryStatus.APPROVED, CostEntryStatus.PAID];
const safePathPart = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 120) || "file";

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") return value.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function costCodeBelongsToProject(app: FastifyInstance, projectId: string, costCodeId?: string | null) {
  if (!costCodeId) return;
  await app.prisma.costCode.findFirstOrThrow({ where: { id: costCodeId, projectId } });
}

function assertBlobConfigured(reply: FastifyReply) {
  if (process.env.BLOB_READ_WRITE_TOKEN || (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID)) return null;
  return reply.code(503).send({
    error: "File storage is not configured",
    message: "Set BLOB_READ_WRITE_TOKEN on the backend server, or configure VERCEL_OIDC_TOKEN with BLOB_STORE_ID.",
  });
}

function likelyInvoiceAmount(text: string): number | null {
  const candidates: Array<{ amount: number; score: number }> = [];
  const money = /(?:AUD|A\$|\$)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2}))/gi;
  let match: RegExpExecArray | null;
  while ((match = money.exec(text)) !== null) {
    const amount = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const before = text.slice(Math.max(0, match.index - 60), match.index).toLowerCase();
    let score = amount;
    if (/\b(balance due|amount due|total due|invoice total|total inc(?:luding)? gst|grand total|total)\b/.test(before)) score += 1_000_000;
    if (/\b(subtotal|gst|tax|paid|deposit|rate|unit price)\b/.test(before)) score -= 500_000;
    candidates.push({ amount, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.amount ?? null;
}

function likelyInvoiceNumber(text: string): string | null {
  return text.match(/\b(?:invoice|tax invoice|inv)\s*(?:no\.?|number|#)?\s*[:-]?\s*([A-Z0-9][A-Z0-9._/-]{2,40})/i)?.[1] ?? null;
}

function likelySupplier(text: string, filename: string): string | null {
  const firstLine = text.split(/\r?\n/).map(line => line.trim()).find(line => /^[A-Za-z0-9 &.,'()-]{3,80}$/.test(line));
  return firstLine ?? (filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 80) || null);
}

async function parseCommercialDocument(buffer: Buffer, mimeType: string, filename: string) {
  try {
    const parsed = await extractTenderText(buffer, mimeType, filename);
    return parsed.sections.map(section => section.text).join("\n");
  } catch (error) {
    if (mimeType.startsWith("image/")) return "";
    throw error;
  }
}

function missingDailyCostSchema(error: unknown) {
  const message = String(error instanceof Error ? error.message : error);
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2021" || error.code === "P2022")) ||
    message.includes("DailyProjectCostDraft") ||
    message.includes("DailyProjectCostLine")
  );
}

async function optionalDailyCostRead<T>(app: FastifyInstance, fallback: T, query: () => Promise<T>) {
  try {
    return await query();
  } catch (error) {
    if (missingDailyCostSchema(error)) {
      app.log.warn({ err: error }, "Daily project cost schema is missing; returned an empty daily draft response");
      return fallback;
    }
    throw error;
  }
}

async function loadProjectCostBooks(app: FastifyInstance, organisationId: string, projectId?: string) {
  return app.prisma.project.findMany({
    where: { organisationId, ...(projectId ? { id: projectId } : {}) },
    orderBy: { code: "asc" },
    include: {
      costPlan: true,
      costCodes: { orderBy: { code: "asc" } },
      costEntries: { orderBy: { incurredAt: "desc" }, include: { costCode: true } },
      costForecasts: { where: { resolvedAt: null }, orderBy: { createdAt: "desc" }, include: { costCode: true } },
      progressClaims: true,
      variations: true,
      timesheets: {
        where: { status: "APPROVED" },
        include: { worker: true, entries: { include: { costCode: true } } },
      },
    },
  });
}

type ProjectCostBook = Awaited<ReturnType<typeof loadProjectCostBooks>>[number];

function evidenceRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  return value as Record<string, Prisma.JsonValue>;
}

function postedTimeEntryIds(project: ProjectCostBook) {
  return new Set(project.costEntries.flatMap((entry) => {
    const evidence = evidenceRecord(entry.evidence);
    return entry.source === "DAILY_DRAFT" &&
      evidence?.originalSource === "TIMESHEET" &&
      typeof evidence.originalSourceId === "string"
      ? [evidence.originalSourceId]
      : [];
  }));
}

function unpostedLabourCosts(project: ProjectCostBook, postedIds: Set<string>) {
  return project.timesheets.flatMap(timesheet => {
    const rate = toNumber(timesheet.worker.baseHourlyRate);
    return timesheet.entries
      .filter(entry => !postedIds.has(entry.id))
      .map(entry => ({
        costCodeId: entry.costCodeId,
        amount: ((entry.ordinaryMinutes + entry.overtimeMinutes) / 60) * rate,
      }));
  });
}

function buildCostCodePerformance(project: ProjectCostBook) {
  const postedIds = postedTimeEntryIds(project);
  const codedBudget = project.costCodes.reduce((total, code) =>
    total + toNumber(code.budgetLabour) + toNumber(code.budgetPlant) + toNumber(code.budgetMaterials), 0);
  const planBudget = toNumber(project.costPlan?.contractBudget);
  const rows = new Map<string, {
    costCodeId: string | null;
    code: string;
    description: string;
    budget: number;
    actual: number;
    committed: number;
    forecast: number;
  }>();
  for (const costCode of project.costCodes) {
    rows.set(costCode.id, {
      costCodeId: costCode.id,
      code: costCode.code,
      description: costCode.description,
      budget: toNumber(costCode.budgetLabour) + toNumber(costCode.budgetPlant) + toNumber(costCode.budgetMaterials),
      actual: 0,
      committed: 0,
      forecast: 0,
    });
  }
  const unallocatedBudget = (planBudget > 0 ? planBudget : codedBudget) - codedBudget;
  if (Math.abs(unallocatedBudget) >= 0.01) {
    rows.set("UNALLOCATED", {
      costCodeId: null,
      code: "UNALLOCATED",
      description: unallocatedBudget > 0 ? "Control budget not assigned to a cost code" : "Cost-code budgets exceed the control budget",
      budget: unallocatedBudget,
      actual: 0,
      committed: 0,
      forecast: 0,
    });
  }
  const contingency = toNumber(project.costPlan?.contingencyAmount);
  if (contingency > 0) {
    rows.set("CONTINGENCY", {
      costCodeId: null,
      code: "CONTINGENCY",
      description: "Project contingency",
      budget: contingency,
      actual: 0,
      committed: 0,
      forecast: 0,
    });
  }
  const rowFor = (costCodeId?: string | null) => {
    const key = costCodeId ?? "UNALLOCATED";
    const existing = rows.get(key);
    if (existing) return existing;
    const unallocated = {
      costCodeId: null,
      code: "UNALLOCATED",
      description: "Needs cost code",
      budget: 0,
      actual: 0,
      committed: 0,
      forecast: 0,
    };
    rows.set(key, unallocated);
    return unallocated;
  };
  for (const entry of project.costEntries) {
    const row = rowFor(entry.costCodeId);
    if (entry.committed || entry.status === CostEntryStatus.COMMITTED) row.committed += toNumber(entry.amount);
    else if (activeCostStatuses.includes(entry.status)) row.actual += toNumber(entry.amount);
  }
  for (const labour of unpostedLabourCosts(project, postedIds)) rowFor(labour.costCodeId).actual += labour.amount;
  for (const forecast of project.costForecasts) rowFor(forecast.costCodeId).forecast += toNumber(forecast.amount);
  return [...rows.values()]
    .map(row => {
      const exposure = row.actual + row.committed + row.forecast;
      return {
        ...row,
        budget: Number(row.budget.toFixed(2)),
        actual: Number(row.actual.toFixed(2)),
        committed: Number(row.committed.toFixed(2)),
        forecast: Number(row.forecast.toFixed(2)),
        exposure: Number(exposure.toFixed(2)),
        variance: Number((row.budget - exposure).toFixed(2)),
        usedPercent: row.budget > 0 ? Number(((exposure / row.budget) * 100).toFixed(2)) : null,
      };
    })
    .filter(row => row.budget !== 0 || row.exposure !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));
}

function buildCostSummary(project: Awaited<ReturnType<typeof loadProjectCostBooks>>[number]) {
  const postedIds = postedTimeEntryIds(project);
  const actualEntries = project.costEntries.filter((entry) => activeCostStatuses.includes(entry.status) && !entry.committed);
  const manualActualCosts = actualEntries.filter(entry => entry.type !== CostEntryType.LABOUR).map((entry) => entry.amount);
  const labourActualCosts = [
    ...actualEntries.filter(entry => entry.type === CostEntryType.LABOUR).map(entry => entry.amount),
    ...unpostedLabourCosts(project, postedIds).map(entry => entry.amount),
  ];
  const committedCosts = project.costEntries.filter((entry) => entry.committed || entry.status === CostEntryStatus.COMMITTED).map((entry) => entry.amount);
  const summary = summariseProjectCost({
    contractValue: project.contractValue,
    contractBudget: project.costPlan?.contractBudget,
    contingencyAmount: project.costPlan?.contingencyAmount,
    budgetBuckets: project.costCodes.flatMap((code) => [code.budgetLabour, code.budgetPlant, code.budgetMaterials]),
    approvedVariations: project.variations.filter((variation) => variation.status === "APPROVED").map((variation) => variation.approvedAmount ?? variation.quotedAmount),
    claimedAmounts: project.progressClaims.map((claim) => claim.claimedAmount),
    certifiedAmounts: project.progressClaims.map((claim) => claim.certifiedAmount),
    manualActualCosts,
    committedCosts,
    forecastCosts: project.costForecasts.map((forecast) => forecast.amount),
    labourActualCosts,
  });
  return {
    project: { id: project.id, code: project.code, name: project.name, clientName: project.clientName, status: project.status },
    summary,
    costPlan: project.costPlan,
  };
}

const routes: FastifyPluginAsync = async app => {
  app.post("/tenders", { preHandler: managers }, async (req, reply) => {
    const b = z.object({ reference: z.string(), title: z.string(), clientName: z.string(), jurisdiction: z.string(), closesAt: z.coerce.date(), scope: z.string().optional(), estimate: z.record(z.any()).optional(), risks: z.array(z.any()).optional(), clarifications: z.array(z.any()).optional(), submissionChecklist: z.array(z.any()).optional() }).parse(req.body);
    const tender = await app.prisma.tender.create({ data: { ...b, organisationId: req.auth.organisationId } }); await audit(app, req, "CREATE", "Tender", tender.id, tender); return reply.code(201).send(tender);
  });
  app.get("/tenders/:id", { preHandler: managers }, async req => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return app.prisma.tender.findFirstOrThrow({
      where: { id, organisationId: req.auth.organisationId },
      include: {
        documents: { orderBy: { uploadedAt: "desc" } },
        requirements: { where: { reviewStatus: { not: "SUPERSEDED" } }, orderBy: [{ mandatory: "desc" }, { category: "asc" }] },
        checklistItems: {
          where: { OR: [{ requirementId: null }, { requirement: { is: { reviewStatus: { not: "SUPERSEDED" } } } }] },
          orderBy: [{ mandatory: "desc" }, { title: "asc" }],
        },
      },
    });
  });
  app.post("/tenders/:id/documents", { preHandler: managers }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const query = z.object({ resetDuplicate: z.coerce.boolean().default(false) }).parse(req.query);
    await app.prisma.tender.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId } });
    const upload = await req.file();
    if (!upload) return reply.code(400).send({ error: "A tender document file is required" });
    const buffer = await upload.toBuffer();
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const duplicate = await app.prisma.tenderDocument.findUnique({ where: { tenderId_sha256: { tenderId: id, sha256 } } });
    if (duplicate && !query.resetDuplicate) return reply.code(409).send({
      error: "This document has already been uploaded to the tender",
      code: "DUPLICATE_TENDER_DOCUMENT",
      documentId: duplicate.id,
      warning: "You have already uploaded this document. Re-uploading will reset extracted requirements and checklist progress for this document.",
    });
    const safeName = upload.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-160) || "tender-document";
    const storageKey = duplicate?.storageKey ?? `organisations/${req.auth.organisationId}/tenders/${id}/${randomUUID()}-${safeName}`;
    const blob = await import("@vercel/blob");
    if (!duplicate) {
      await blob.put(storageKey, buffer, {
        access: "private",
        contentType: upload.mimetype,
        addRandomSuffix: false,
      });
    }
    let document;
    try {
      document = duplicate
        ? await app.prisma.tenderDocument.update({ where: { id: duplicate.id }, data: { name: upload.filename, mimeType: upload.mimetype, storageKey, sha256, sizeBytes: buffer.length, uploadedById: req.auth.userId, uploadedAt: new Date(), processingStatus: "PROCESSING", processingError: null, pageCount: null } })
        : await app.prisma.tenderDocument.create({ data: { tenderId: id, name: upload.filename, mimeType: upload.mimetype, storageKey, sha256, sizeBytes: buffer.length, uploadedById: req.auth.userId, processingStatus: "PROCESSING" } });
    } catch (error: any) {
      if (!duplicate) await blob.del(storageKey).catch(() => undefined);
      if (error?.code === "P2002") return reply.code(409).send({
        error: "This document has already been uploaded to the tender",
        code: "DUPLICATE_TENDER_DOCUMENT",
        warning: "You have already uploaded this document. Re-uploading will reset extracted requirements and checklist progress for this document.",
      });
      throw error;
    }
    try {
      const parsed = await extractTenderText(buffer, upload.mimetype, upload.filename);
      const suggestions = analyseTender(parsed.sections);
      if (duplicate) {
        const existingRequirements = await app.prisma.tenderRequirement.findMany({ where: { tenderId: id, documentId: document.id }, select: { id: true } });
        const requirementIds = existingRequirements.map(requirement => requirement.id);
        if (requirementIds.length) await app.prisma.tenderChecklistItem.updateMany({ where: { tenderId: id, requirementId: { in: requirementIds } }, data: { status: "NOT_APPLICABLE", completedAt: null } });
        await app.prisma.tenderRequirement.updateMany({ where: { tenderId: id, documentId: document.id }, data: { reviewStatus: "SUPERSEDED" } });
      }
      await app.prisma.tenderDocument.update({ where: { id: document.id }, data: { processingStatus: suggestions.length ? "REVIEW_REQUIRED" : "NO_REQUIREMENTS_FOUND", pageCount: parsed.pageCount } });
      for (const suggestion of suggestions) {
        await app.prisma.tenderRequirement.create({
          data: {
            tenderId: id,
            documentId: document.id,
            ...suggestion,
            checklistItems: { create: { tenderId: id, title: suggestion.title, description: suggestion.detail, mandatory: suggestion.mandatory } },
          },
        });
      }
      if (await app.prisma.tenderChecklistItem.count({ where: { tenderId: id, requirementId: null } }) === 0) {
        await app.prisma.tenderChecklistItem.createMany({ data: [
          { tenderId: id, title: "Confirm closing date, time and submission method", mandatory: true },
          { tenderId: id, title: "Review all addenda and tender clarifications", mandatory: true },
          { tenderId: id, title: "Complete pricing schedules and check arithmetic", mandatory: true },
          { tenderId: id, title: "Complete declarations, licences and insurance evidence", mandatory: true },
          { tenderId: id, title: "Final authorised submission review", mandatory: true },
        ] });
      }
      const result = await app.prisma.tenderDocument.findUniqueOrThrow({
        where: { id: document.id },
        include: { requirements: { where: { reviewStatus: { not: "SUPERSEDED" } } } },
      });
      await audit(app, req, duplicate ? "REUPLOAD_AND_ANALYSE" : "UPLOAD_AND_ANALYSE", "TenderDocument", document.id, { tenderId: id, requirementsFound: suggestions.length, resetDuplicate: Boolean(duplicate) });
      return reply.code(duplicate ? 200 : 201).send(result);
    } catch (error) {
      await app.prisma.tenderRequirement.updateMany({ where: { tenderId: id, documentId: document.id }, data: { reviewStatus: "SUPERSEDED" } });
      await app.prisma.tenderDocument.update({ where: { id: document.id }, data: { processingStatus: "FAILED", processingError: error instanceof Error ? error.message.slice(0, 1000) : "Document processing failed" } });
      throw error;
    }
  });
  app.patch("/tenders/:tenderId/requirements/:id", { preHandler: managers }, async req => {
    const p = z.object({ tenderId: z.string().uuid(), id: z.string().uuid() }).parse(req.params);
    const body = z.object({ reviewStatus: z.enum(["CONFIRMED", "REJECTED"]), title: z.string().min(1).optional(), detail: z.string().min(1).optional(), mandatory: z.boolean().optional() }).parse(req.body);
    const requirement = await app.prisma.tenderRequirement.findFirstOrThrow({ where: { id: p.id, tenderId: p.tenderId, tender: { organisationId: req.auth.organisationId } } });
    const [result] = await app.prisma.$transaction([
      app.prisma.tenderRequirement.update({ where: { id: requirement.id }, data: body }),
      app.prisma.tenderChecklistItem.updateMany({ where: { requirementId: requirement.id }, data: body.reviewStatus === "REJECTED" ? { status: "NOT_APPLICABLE", completedAt: null } : { title: body.title, description: body.detail, mandatory: body.mandatory, status: "TODO", completedAt: null } }),
    ]); await audit(app, req, "REVIEW", "TenderRequirement", result.id, result); return result;
  });
  app.patch("/tenders/:tenderId/checklist/:id", { preHandler: managers }, async (req, reply) => {
    const p = z.object({ tenderId: z.string().uuid(), id: z.string().uuid() }).parse(req.params);
    const body = z.object({ status: z.enum(["TODO", "IN_PROGRESS", "COMPLETE", "NOT_APPLICABLE"]), ownerId: z.string().uuid().nullable().optional(), dueAt: z.coerce.date().nullable().optional() }).parse(req.body);
    const item = await app.prisma.tenderChecklistItem.findFirstOrThrow({ where: { id: p.id, tenderId: p.tenderId, tender: { organisationId: req.auth.organisationId } } });
    if (body.ownerId) {
      const [userOwner, workerOwner] = await Promise.all([
        app.prisma.user.findFirst({ where: { id: body.ownerId, organisationId: req.auth.organisationId, active: true }, select: { id: true } }),
        app.prisma.worker.findFirst({ where: { id: body.ownerId, organisationId: req.auth.organisationId, terminationDate: null }, select: { id: true } }),
      ]);
      if (!userOwner && !workerOwner) return reply.code(400).send({ error: "Assignee must be an active user or worker in your organisation" });
    }
    const result = await app.prisma.tenderChecklistItem.update({ where: { id: item.id }, data: { ...body, completedAt: body.status === "COMPLETE" ? new Date() : null } }); await audit(app, req, "CHECKLIST_UPDATE", "TenderChecklistItem", result.id, result); return result;
  });
  app.post("/progress-claims", { preHandler: managers }, async (req, reply) => {
    const b = z.object({ projectId: z.string().uuid(), claimNumber: z.number().int().positive(), periodEnd: z.coerce.date(), claimedAmount: z.number().nonnegative(), retentionAmount: z.number().nonnegative().optional(), dueAt: z.coerce.date().optional(), breakdown: z.array(z.any()) }).parse(req.body);
    await requireOrganisationProject(app, req, b.projectId);
    const claim = await app.prisma.progressClaim.create({ data: b }); await audit(app, req, "CREATE", "ProgressClaim", claim.id, claim); return reply.code(201).send(claim);
  });
  app.post("/variations", { preHandler: managers }, async (req, reply) => {
    const b = z.object({ projectId: z.string().uuid(), reference: z.string(), title: z.string(), description: z.string(), cause: z.string().optional(), noticeDate: z.coerce.date().optional(), quotedAmount: z.number().optional(), extensionDays: z.number().int().optional() }).parse(req.body);
    await requireOrganisationProject(app, req, b.projectId);
    const variation = await app.prisma.variation.create({ data: b }); await audit(app, req, "CREATE", "Variation", variation.id, variation); return reply.code(201).send(variation);
  });
  app.get("/cost-tracking/summary", { preHandler: managers }, async req => {
    const { projectId } = z.object({ projectId: z.string().uuid().optional() }).parse(req.query);
    if (projectId) await requireOrganisationProject(app, req, projectId);
    const projects = await loadProjectCostBooks(app, req.auth.organisationId, projectId);
    return projects.map(buildCostSummary);
  });
  app.get("/cost-tracking/projects/:projectId", { preHandler: managers }, async req => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(req.params);
    await requireOrganisationProject(app, req, projectId);
    const [project] = await loadProjectCostBooks(app, req.auth.organisationId, projectId);
    if (!project) throw Object.assign(new Error("Project cost book not found"), { statusCode: 404 });
    const dailyCostDrafts = await optionalDailyCostRead(app, [], () => app.prisma.dailyProjectCostDraft.findMany({
      where: { organisationId: req.auth.organisationId, projectId },
      orderBy: { costDate: "desc" },
      take: 31,
      include: {
        lines: {
          orderBy: [{ type: "asc" }, { description: "asc" }],
          include: {
            worker: { select: { id: true, employeeNumber: true, firstName: true, lastName: true, classification: true } },
            plant: { select: { id: true, assetNumber: true, type: true, make: true, model: true } },
          },
        },
      },
    }));
    const openDrafts = dailyCostDrafts.filter(draft => draft.status !== Status.APPROVED);
    const attachmentIds = [...new Set(project.costEntries.flatMap(entry => entry.attachmentFileAssetId ? [entry.attachmentFileAssetId] : []))];
    const attachments = attachmentIds.length
      ? await app.prisma.fileAsset.findMany({
        where: { id: { in: attachmentIds }, organisationId: req.auth.organisationId, deletedAt: null },
        select: { id: true, url: true, downloadUrl: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true },
      })
      : [];
    const attachmentsById = new Map(attachments.map(file => [file.id, file]));
    const attention = {
      draftDays: openDrafts.length,
      missingRates: openDrafts.reduce((total, draft) => total + draft.lines.filter(line => line.unitRate === null || toNumber(line.amount) <= 0).length, 0),
      unallocated: project.costEntries.filter(entry => activeCostStatuses.includes(entry.status) && !entry.costCodeId).length +
        openDrafts.reduce((total, draft) => total + draft.lines.filter(line => !line.costCodeId).length, 0),
      disputed: project.costEntries.filter(entry => entry.status === CostEntryStatus.DISPUTED).length,
      missingEvidence: project.costEntries.filter(entry => entry.invoiceNumber && !entry.attachmentFileAssetId).length,
    };
    return {
      ...buildCostSummary(project),
      costCodes: project.costCodes,
      costCodePerformance: buildCostCodePerformance(project),
      attention,
      costEntries: project.costEntries.map(entry => ({
        ...entry,
        attachment: entry.attachmentFileAssetId ? attachmentsById.get(entry.attachmentFileAssetId) ?? null : null,
      })),
      costForecasts: project.costForecasts,
      dailyCostDrafts,
      progressClaims: project.progressClaims,
      variations: project.variations,
    };
  });
  app.get("/cost-tracking/projects/:projectId/daily-cost-drafts", { preHandler: managers }, async req => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(req.params);
    const query = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }).parse(req.query);
    await requireOrganisationProject(app, req, projectId);
    return optionalDailyCostRead(app, [], () => app.prisma.dailyProjectCostDraft.findMany({
      where: { organisationId: req.auth.organisationId, projectId, costDate: { gte: query.from, lte: query.to } },
      include: {
        lines: {
          orderBy: [{ type: "asc" }, { description: "asc" }],
          include: {
            worker: { select: { id: true, employeeNumber: true, firstName: true, lastName: true, classification: true } },
            plant: { select: { id: true, assetNumber: true, type: true, make: true, model: true } },
          },
        },
      },
      orderBy: { costDate: "desc" },
    }));
  });
  app.post("/cost-tracking/projects/:projectId/daily-cost-drafts", { preHandler: managers }, async (req, reply) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(req.params);
    const body = z.object({ costDate: z.coerce.date() }).parse(req.body);
    await requireOrganisationProject(app, req, projectId);
    const costDate = new Date(Date.UTC(body.costDate.getUTCFullYear(), body.costDate.getUTCMonth(), body.costDate.getUTCDate()));
    const draft = await app.prisma.dailyProjectCostDraft.upsert({
      where: { projectId_costDate: { projectId, costDate } },
      create: { organisationId: req.auth.organisationId, projectId, costDate },
      update: {},
      include: { lines: true },
    });
    return reply.code(201).send(draft);
  });
  app.patch("/cost-tracking/daily-cost-drafts/:id", { preHandler: managers }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const lineBody = z.object({
      id: z.string().uuid().optional(),
      remove: z.boolean().optional(),
      costCodeId: z.string().uuid().nullable().optional(),
      type: z.nativeEnum(CostEntryType),
      workerId: z.string().uuid().nullable().optional(),
      plantId: z.string().uuid().nullable().optional(),
      description: z.string().min(1).max(1000),
      quantity: z.number().nonnegative(),
      unit: z.string().min(1).max(30).default("hr"),
      unitRate: z.number().nonnegative().nullable().optional(),
      amount: z.number().nonnegative().optional(),
      notes: z.string().max(2000).nullable().optional(),
    });
    const body = z.object({ status: z.nativeEnum(Status).optional(), notes: z.string().max(4000).nullable().optional(), lines: z.array(lineBody).max(200) }).parse(req.body);
    const draft = await app.prisma.dailyProjectCostDraft.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId } });
    const lineIds = body.lines.flatMap(line => line.id ? [line.id] : []);
    if (lineIds.length) {
      const ownedLineCount = await app.prisma.dailyProjectCostLine.count({ where: { id: { in: lineIds }, draftId: draft.id } });
      if (ownedLineCount !== lineIds.length) return reply.code(400).send({ error: "Every daily cost line must belong to this draft" });
    }
    const costCodeIds = [...new Set(body.lines.flatMap(line => line.costCodeId ? [line.costCodeId] : []))];
    if (costCodeIds.length && await app.prisma.costCode.count({ where: { id: { in: costCodeIds }, projectId: draft.projectId } }) !== costCodeIds.length) return reply.code(400).send({ error: "Cost codes must belong to the selected project" });
    const workerIds = [...new Set(body.lines.flatMap(line => line.workerId ? [line.workerId] : []))];
    if (workerIds.length && await app.prisma.worker.count({ where: { id: { in: workerIds }, organisationId: req.auth.organisationId, terminationDate: null } }) !== workerIds.length) return reply.code(400).send({ error: "Workers must belong to your organisation" });
    const plantIds = [...new Set(body.lines.flatMap(line => line.plantId ? [line.plantId] : []))];
    if (plantIds.length && await app.prisma.plant.count({ where: { id: { in: plantIds }, organisationId: req.auth.organisationId } }) !== plantIds.length) return reply.code(400).send({ error: "Plant must belong to your organisation" });
    await app.prisma.$transaction(async tx => {
      await tx.dailyProjectCostDraft.update({ where: { id: draft.id }, data: { status: body.status, notes: body.notes } });
      for (const line of body.lines) {
        if (line.remove && line.id) {
          await tx.dailyProjectCostLine.delete({ where: { id: line.id } });
          continue;
        }
        if (line.remove) continue;
        const amount = line.amount ?? Number((line.quantity * (line.unitRate ?? 0)).toFixed(2));
        const data = {
          costCodeId: line.costCodeId ?? null,
          type: line.type,
          workerId: line.workerId ?? null,
          plantId: line.plantId ?? null,
          description: line.description.trim(),
          quantity: line.quantity,
          unit: line.unit,
          unitRate: line.unitRate ?? null,
          amount,
          notes: line.notes ?? null,
        };
        if (line.id) await tx.dailyProjectCostLine.update({ where: { id: line.id }, data });
        else await tx.dailyProjectCostLine.create({ data: { ...data, draftId: draft.id, source: "MANUAL", sourceId: randomUUID() } });
      }
    });
    const updated = await app.prisma.dailyProjectCostDraft.findUniqueOrThrow({
      where: { id: draft.id },
      include: {
        lines: {
          orderBy: [{ type: "asc" }, { description: "asc" }],
          include: {
            worker: { select: { id: true, employeeNumber: true, firstName: true, lastName: true, classification: true } },
            plant: { select: { id: true, assetNumber: true, type: true, make: true, model: true } },
          },
        },
      },
    });
    await audit(app, req, "UPDATE", "DailyProjectCostDraft", draft.id, { lineCount: updated.lines.length, status: updated.status });
    return updated;
  });
  app.post("/cost-tracking/projects/:projectId/daily-cost-drafts/post", { preHandler: managers }, async (req, reply) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      draftIds: z.array(z.string().uuid()).min(1).max(31),
      status: z.nativeEnum(CostEntryStatus).default(CostEntryStatus.APPROVED),
      description: z.string().max(240).optional(),
    }).parse(req.body);
    await requireOrganisationProject(app, req, projectId);
    const drafts = await app.prisma.dailyProjectCostDraft.findMany({
      where: { id: { in: body.draftIds }, organisationId: req.auth.organisationId, projectId },
      include: { lines: true },
      orderBy: { costDate: "asc" },
    });
    if (drafts.length !== body.draftIds.length) return reply.code(400).send({ error: "Every selected daily cost draft must belong to this project" });
    const lines = drafts.flatMap(draft => draft.lines.map(line => ({ draft, line }))).filter(({ line }) => toNumber(line.amount) > 0);
    if (lines.length === 0) return reply.code(400).send({ error: "Selected draft days do not contain any cost lines" });
    const lineIds = lines.map(({ line }) => line.id);
    const existing = await app.prisma.costEntry.findMany({ where: { projectId, source: "DAILY_DRAFT", sourceId: { in: lineIds } }, select: { sourceId: true } });
    const existingLineIds = new Set(existing.flatMap(entry => entry.sourceId ? [entry.sourceId] : []));
    const created = await app.prisma.$transaction(async tx => {
      const entries = [];
      for (const { draft, line } of lines) {
        if (existingLineIds.has(line.id)) continue;
        const entry = await tx.costEntry.create({
          data: {
            projectId,
            costCodeId: line.costCodeId,
            type: line.type,
            status: body.status,
            description: `${body.description?.trim() || "Daily resource cost"} - ${draft.costDate.toISOString().slice(0, 10)} - ${line.description}`,
            incurredAt: draft.costDate,
            quantity: line.quantity,
            unit: line.unit,
            unitRate: line.unitRate,
            amount: line.amount,
            gstAmount: 0,
            committed: false,
            source: "DAILY_DRAFT",
            sourceId: line.id,
            evidence: {
              dailyCostDraftId: draft.id,
              dailyCostLineId: line.id,
              originalSource: line.source,
              originalSourceId: line.sourceId,
              workerId: line.workerId,
              plantId: line.plantId,
            },
            createdById: req.auth.userId,
          },
        });
        entries.push(entry);
      }
      await tx.dailyProjectCostDraft.updateMany({ where: { id: { in: body.draftIds } }, data: { status: Status.APPROVED } });
      return entries;
    });
    await audit(app, req, "POST", "DailyProjectCostDraft", projectId, { draftIds: body.draftIds, createdCostEntries: created.length, skippedExisting: existingLineIds.size });
    return reply.code(201).send({ created, skippedExisting: existingLineIds.size });
  });
  app.put("/cost-tracking/projects/:projectId/plan", { preHandler: managers }, async (req, reply) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      contractBudget: z.number().nonnegative().nullable().optional(),
      contingencyAmount: z.number().nonnegative().optional(),
      targetMarginPercent: z.number().min(-100).max(100).nullable().optional(),
      notes: z.string().max(4000).nullable().optional(),
    }).parse(req.body);
    await requireOrganisationProject(app, req, projectId);
    const plan = await app.prisma.projectCostPlan.upsert({
      where: { projectId },
      create: { projectId, ...body },
      update: body,
    });
    await audit(app, req, "UPSERT", "ProjectCostPlan", plan.id, plan);
    return reply.code(200).send(plan);
  });
  app.post("/cost-tracking/projects/:projectId/invoice-costs/extract", { preHandler: managers }, async (req, reply) => {
    const storageError = assertBlobConfigured(reply);
    if (storageError) return storageError;
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(req.params);
    await requireOrganisationProject(app, req, projectId);
    const upload = await req.file();
    if (!upload) return reply.code(400).send({ error: "An invoice, docket or receipt file is required" });
    const buffer = await upload.toBuffer();
    const pathname = `organisations/${req.auth.organisationId}/projects/${projectId}/cost-evidence/${randomUUID()}-${safePathPart(upload.filename)}`;
    const blob = await import("@vercel/blob");
    const uploaded = await blob.put(pathname, buffer, {
      access: "private",
      contentType: upload.mimetype,
      addRandomSuffix: false,
    });
    const text = await parseCommercialDocument(buffer, upload.mimetype, upload.filename);
    const supplier = likelySupplier(text, upload.filename);
    const invoiceNumber = likelyInvoiceNumber(text);
    const [previousCoding, possibleDuplicate] = await Promise.all([
      supplier
        ? app.prisma.costEntry.findFirst({
          where: {
            supplier: { equals: supplier, mode: "insensitive" },
            project: { organisationId: req.auth.organisationId },
            costCodeId: { not: null },
          },
          orderBy: { createdAt: "desc" },
          select: { type: true, costCode: { select: { code: true } } },
        })
        : null,
      invoiceNumber
        ? app.prisma.costEntry.findFirst({
          where: {
            invoiceNumber: { equals: invoiceNumber, mode: "insensitive" },
            ...(supplier ? { supplier: { equals: supplier, mode: "insensitive" as const } } : {}),
            ...(supplier ? { project: { organisationId: req.auth.organisationId } } : { projectId }),
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, projectId: true, invoiceNumber: true, supplier: true, amount: true, incurredAt: true, description: true },
        })
        : null,
    ]);
    const rememberedCostCode = previousCoding?.costCode?.code
      ? await app.prisma.costCode.findFirst({ where: { projectId, code: previousCoding.costCode.code }, select: { id: true, code: true, description: true } })
      : null;
    const fileAsset = await app.prisma.fileAsset.create({
      data: {
        organisationId: req.auth.organisationId,
        projectId,
        uploadedById: req.auth.userId,
        entityType: "CostEntry",
        provider: FileStorageProvider.VERCEL_BLOB,
        access: FileAccess.PRIVATE,
        pathname,
        url: uploaded.url,
        downloadUrl: "downloadUrl" in uploaded ? uploaded.downloadUrl : undefined,
        mimeType: upload.mimetype,
        sizeBytes: buffer.length,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        originalName: upload.filename,
        description: "Project cost evidence",
        metadata: { extractedTextLength: text.length },
      },
    });
    const suggestion = {
      amount: likelyInvoiceAmount(text),
      supplier,
      invoiceNumber,
      description: upload.filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "),
      incurredAt: new Date().toISOString().slice(0, 10),
      type: previousCoding?.type ?? CostEntryType.SUBCONTRACTOR,
      costCodeId: rememberedCostCode?.id ?? null,
      costCodeLabel: rememberedCostCode ? `${rememberedCostCode.code} - ${rememberedCostCode.description}` : null,
      possibleDuplicate,
      confidence: text ? "REVIEW_REQUIRED" : "MANUAL_REVIEW_REQUIRED",
      message: possibleDuplicate
        ? "A cost with this supplier and invoice number already exists. Review it before continuing."
        : previousCoding
          ? "Values were extracted and the supplier's previous coding was applied. Review before adding this cost."
          : text
            ? "Review the extracted values before adding this cost."
            : "The file was stored, but no text could be read automatically. Enter the cost details before adding it.",
    };
    await audit(app, req, "UPLOAD_AND_EXTRACT", "FileAsset", fileAsset.id, { projectId, amount: suggestion.amount, invoiceNumber: suggestion.invoiceNumber });
    return reply.code(201).send({ fileAsset, suggestion });
  });
  app.post("/cost-tracking/cost-entries", { preHandler: managers }, async (req, reply) => {
    const body = z.object({
      projectId: z.string().uuid(),
      costCodeId: z.string().uuid().nullable().optional(),
      type: z.nativeEnum(CostEntryType),
      status: z.nativeEnum(CostEntryStatus).optional(),
      supplier: z.string().max(200).optional(),
      description: z.string().min(1).max(1000),
      incurredAt: z.coerce.date(),
      invoiceNumber: z.string().max(100).optional(),
      quantity: z.number().nonnegative().nullable().optional(),
      unit: z.string().max(30).optional(),
      unitRate: z.number().nonnegative().nullable().optional(),
      amount: z.number().nonnegative(),
      gstAmount: z.number().nonnegative().optional(),
      committed: z.boolean().optional(),
      source: z.string().max(80).optional(),
      sourceId: z.string().max(120).nullable().optional(),
      evidence: z.record(z.any()).nullable().optional(),
      attachmentFileAssetId: z.string().uuid().nullable().optional(),
      allowDuplicate: z.boolean().optional(),
    }).parse(req.body);
    await requireOrganisationProject(app, req, body.projectId);
    await costCodeBelongsToProject(app, body.projectId, body.costCodeId);
    if (body.attachmentFileAssetId) {
      const file = await app.prisma.fileAsset.findFirst({ where: { id: body.attachmentFileAssetId, organisationId: req.auth.organisationId, projectId: body.projectId, deletedAt: null } });
      if (!file) return reply.code(400).send({ error: "Attached file must belong to this project" });
    }
    if (body.invoiceNumber && !body.allowDuplicate) {
      const duplicate = await app.prisma.costEntry.findFirst({
        where: {
          invoiceNumber: { equals: body.invoiceNumber, mode: "insensitive" },
          ...(body.supplier ? { supplier: { equals: body.supplier, mode: "insensitive" as const } } : {}),
          ...(body.supplier ? { project: { organisationId: req.auth.organisationId } } : { projectId: body.projectId }),
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, projectId: true, supplier: true, invoiceNumber: true, description: true, amount: true, incurredAt: true },
      });
      if (duplicate) return reply.code(409).send({
        error: "This invoice may already be recorded",
        code: "DUPLICATE_COST_INVOICE",
        warning: "Adding it again may double-count the project cost. Review the existing cost before proceeding.",
        duplicate,
      });
    }
    const { allowDuplicate: _allowDuplicate, ...entryBody } = body;
    void _allowDuplicate;
    const entry = await app.prisma.costEntry.create({
      data: {
        ...entryBody,
        costCodeId: body.costCodeId ?? undefined,
        source: body.source ?? "MANUAL",
        sourceId: body.sourceId ?? undefined,
        evidence: body.evidence ?? undefined,
        attachmentFileAssetId: body.attachmentFileAssetId ?? undefined,
        createdById: req.auth.userId,
      },
    });
    if (body.attachmentFileAssetId) await app.prisma.fileAsset.update({ where: { id: body.attachmentFileAssetId }, data: { entityId: entry.id } });
    await audit(app, req, "CREATE", "CostEntry", entry.id, entry);
    return reply.code(201).send(entry);
  });
  app.post("/cost-tracking/forecasts", { preHandler: managers }, async (req, reply) => {
    const body = z.object({
      projectId: z.string().uuid(),
      costCodeId: z.string().uuid().nullable().optional(),
      type: z.nativeEnum(CostEntryType),
      description: z.string().min(1).max(1000),
      amount: z.number().nonnegative(),
      confidence: z.nativeEnum(ForecastConfidence).optional(),
    }).parse(req.body);
    await requireOrganisationProject(app, req, body.projectId);
    await costCodeBelongsToProject(app, body.projectId, body.costCodeId);
    const forecast = await app.prisma.costForecast.create({ data: { ...body, costCodeId: body.costCodeId ?? undefined, createdById: req.auth.userId } });
    await audit(app, req, "CREATE", "CostForecast", forecast.id, forecast);
    return reply.code(201).send(forecast);
  });
};
export default routes;
