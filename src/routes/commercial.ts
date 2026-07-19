import type { FastifyPluginAsync } from "fastify";
import { Role } from "@prisma/client";
import { z } from "zod";
import { allow, requireOrganisationProject } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { analyseTender, extractTenderText } from "../lib/tender-parser.js";
import { config } from "../config.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const managers = allow(Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER, Role.OPERATIONS_MANAGER);
const routes: FastifyPluginAsync = async app => {
  app.post("/tenders", { preHandler: managers }, async (req, reply) => {
    const b = z.object({ reference: z.string(), title: z.string(), clientName: z.string(), jurisdiction: z.string(), closesAt: z.coerce.date(), scope: z.string().optional(), estimate: z.record(z.any()).optional(), risks: z.array(z.any()).optional(), clarifications: z.array(z.any()).optional(), submissionChecklist: z.array(z.any()).optional() }).parse(req.body);
    const tender = await app.prisma.tender.create({ data: { ...b, organisationId: req.auth.organisationId } }); await audit(app, req, "CREATE", "Tender", tender.id, tender); return reply.code(201).send(tender);
  });
  app.get("/tenders/:id", { preHandler: managers }, async req => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return app.prisma.tender.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId }, include: { documents: { orderBy: { uploadedAt: "desc" } }, requirements: { orderBy: [{ mandatory: "desc" }, { category: "asc" }] }, checklistItems: { orderBy: [{ mandatory: "desc" }, { title: "asc" }] } } });
  });
  app.post("/tenders/:id/documents", { preHandler: managers }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await app.prisma.tender.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId } });
    const upload = await req.file();
    if (!upload) return reply.code(400).send({ error: "A tender document file is required" });
    const buffer = await upload.toBuffer();
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    if (await app.prisma.tenderDocument.findUnique({ where: { tenderId_sha256: { tenderId: id, sha256 } } })) return reply.code(409).send({ error: "This document has already been uploaded to the tender" });
    const safeName = upload.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-160) || "tender-document";
    const storageKey = join(req.auth.organisationId, "tenders", id, `${randomUUID()}-${safeName}`);
    const absolutePath = join(config.STORAGE_PATH, storageKey); await mkdir(join(config.STORAGE_PATH, req.auth.organisationId, "tenders", id), { recursive: true });
    await writeFile(absolutePath, buffer, { flag: "wx" });
    let document;
    try {
      document = await app.prisma.tenderDocument.create({ data: { tenderId: id, name: upload.filename, mimeType: upload.mimetype, storageKey, sha256, sizeBytes: buffer.length, uploadedById: req.auth.userId, processingStatus: "PROCESSING" } });
    } catch (error: any) {
      await unlink(absolutePath).catch(() => undefined);
      if (error?.code === "P2002") return reply.code(409).send({ error: "This document has already been uploaded to the tender" });
      throw error;
    }
    try {
      const parsed = await extractTenderText(buffer, upload.mimetype, upload.filename);
      const suggestions = analyseTender(parsed.sections);
      await app.prisma.$transaction(async tx => {
        await tx.tenderDocument.update({ where: { id: document.id }, data: { processingStatus: suggestions.length ? "REVIEW_REQUIRED" : "NO_REQUIREMENTS_FOUND", pageCount: parsed.pageCount } });
        for (const suggestion of suggestions) {
          const requirement = await tx.tenderRequirement.create({ data: { tenderId: id, documentId: document.id, ...suggestion } });
          await tx.tenderChecklistItem.create({ data: { tenderId: id, requirementId: requirement.id, title: suggestion.title, description: suggestion.detail, mandatory: suggestion.mandatory } });
        }
        if (await tx.tenderChecklistItem.count({ where: { tenderId: id, requirementId: null } }) === 0) await tx.tenderChecklistItem.createMany({ data: [
          { tenderId: id, title: "Confirm closing date, time and submission method", mandatory: true },
          { tenderId: id, title: "Review all addenda and tender clarifications", mandatory: true },
          { tenderId: id, title: "Complete pricing schedules and check arithmetic", mandatory: true },
          { tenderId: id, title: "Complete declarations, licences and insurance evidence", mandatory: true },
          { tenderId: id, title: "Final authorised submission review", mandatory: true },
        ] });
      });
      const result = await app.prisma.tenderDocument.findUniqueOrThrow({ where: { id: document.id }, include: { requirements: true } });
      await audit(app, req, "UPLOAD_AND_ANALYSE", "TenderDocument", document.id, { tenderId: id, requirementsFound: suggestions.length });
      return reply.code(201).send(result);
    } catch (error) {
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
  app.patch("/tenders/:tenderId/checklist/:id", { preHandler: managers }, async req => {
    const p = z.object({ tenderId: z.string().uuid(), id: z.string().uuid() }).parse(req.params);
    const body = z.object({ status: z.enum(["TODO", "IN_PROGRESS", "COMPLETE", "NOT_APPLICABLE"]), ownerId: z.string().uuid().nullable().optional(), dueAt: z.coerce.date().nullable().optional() }).parse(req.body);
    const item = await app.prisma.tenderChecklistItem.findFirstOrThrow({ where: { id: p.id, tenderId: p.tenderId, tender: { organisationId: req.auth.organisationId } } });
    if (body.ownerId) await app.prisma.user.findFirstOrThrow({ where: { id: body.ownerId, organisationId: req.auth.organisationId, active: true } });
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
};
export default routes;
