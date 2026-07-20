import type { FastifyPluginAsync } from "fastify";
import { AccountSection, InspectionResult, Role } from "@prisma/client";
import { z } from "zod";
import { allow, allowSection, authed, requireOrganisationProject } from "../lib/access.js";
import { audit, auditData } from "../lib/audit.js";
import { plantTelemetryReading } from "../lib/civil.js";
import { defectQuestionIds, preStartSections, validatePreStartAnswers } from "../lib/prestart.js";

const plantManagers = [Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER, Role.OPERATIONS_MANAGER];
const plantTelemetryManagers = [...plantManagers, Role.SUPERVISOR, Role.SITE_SUPERVISOR, Role.SITE_ENGINEER];
const plantClearers = [...plantManagers, Role.SAFETY_MANAGER];

const routes: FastifyPluginAsync = async app => {
  app.get("/pre-start-templates", { preHandler: authed }, async req => {
    const q = z.object({ plantType: z.string().optional() }).parse(req.query);
    const templates = await app.prisma.preStartTemplate.findMany({
      where: {
        organisationId: req.auth.organisationId,
        status: "PUBLISHED",
        OR: q.plantType ? [{ plantType: { equals: q.plantType, mode: "insensitive" } }, { plantType: null }] : undefined,
      },
      orderBy: [{ version: "desc" }, { name: "asc" }],
    });
    return templates.sort((a, b) => {
      const aSpecific = q.plantType && a.plantType?.toLowerCase() === q.plantType.toLowerCase();
      const bSpecific = q.plantType && b.plantType?.toLowerCase() === q.plantType.toLowerCase();
      return Number(bSpecific) - Number(aSpecific);
    });
  });
  app.get("/pre-start-templates/manage", { preHandler: allow(Role.OWNER, Role.ADMIN) }, req => app.prisma.preStartTemplate.findMany({ where: { organisationId: req.auth.organisationId }, orderBy: [{ name: "asc" }, { version: "desc" }] }));
  app.post("/pre-start-templates", { preHandler: allow(Role.OWNER, Role.ADMIN) }, async (req, reply) => {
    const b = z.object({ name: z.string().min(2).max(120), plantType: z.string().max(100).optional(), sections: preStartSections }).parse(req.body);
    const latest = await app.prisma.preStartTemplate.findFirst({ where: { organisationId: req.auth.organisationId, name: b.name }, orderBy: { version: "desc" } });
    const template = await app.prisma.preStartTemplate.create({ data: { ...b, organisationId: req.auth.organisationId, version: (latest?.version ?? 0) + 1, createdById: req.auth.userId } });
    await audit(app, req, "CREATE", "PreStartTemplate", template.id, template); return reply.code(201).send(template);
  });
  app.patch("/pre-start-templates/:id", { preHandler: allow(Role.OWNER, Role.ADMIN) }, async req => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params); const b = z.object({ plantType: z.string().max(100).nullable().optional(), sections: preStartSections.optional() }).parse(req.body);
    const existing = await app.prisma.preStartTemplate.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId, status: "DRAFT" } });
    const template = await app.prisma.preStartTemplate.update({ where: { id: existing.id }, data: b }); await audit(app, req, "UPDATE", "PreStartTemplate", id, template); return template;
  });
  app.post("/pre-start-templates/:id/publish", { preHandler: allow(Role.OWNER, Role.ADMIN) }, async req => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params); const existing = await app.prisma.preStartTemplate.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId, status: "DRAFT" } });
    const template = await app.prisma.preStartTemplate.update({ where: { id: existing.id }, data: { status: "PUBLISHED", publishedAt: new Date() } }); await audit(app, req, "PUBLISH", "PreStartTemplate", id, template); return template;
  });
  app.get("/", { preHandler: authed }, req => app.prisma.plant.findMany({ where: { organisationId: req.auth.organisationId }, include: { currentProject: true }, orderBy: { assetNumber: "asc" } }));
  app.get("/my-pre-starts", { preHandler: authed }, async req => {
    const q = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(10) }).parse(req.query);
    const worker = await app.prisma.worker.findFirst({ where: { organisationId: req.auth.organisationId, userId: req.auth.userId }, select: { id: true } });
    if (!worker) return { items: [], page: q.page, pageSize: q.pageSize, total: 0 };
    const where = { workerId: worker.id, plant: { organisationId: req.auth.organisationId } };
    const [items, total] = await Promise.all([
      app.prisma.plantPreStart.findMany({
        where,
        include: {
          plant: { select: { id: true, assetNumber: true, type: true, make: true, model: true, currentProject: { select: { id: true, code: true, name: true } } } },
        },
        orderBy: { inspectedAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      app.prisma.plantPreStart.count({ where }),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total };
  });
  app.post("/", { preHandler: allowSection(AccountSection.PLANT_MANAGEMENT, ...plantManagers) }, async (req, reply) => {
    const body = z.object({ assetNumber: z.string(), type: z.string(), make: z.string().optional(), model: z.string().optional(), serialNumber: z.string().optional(), registration: z.string().optional(), currentProjectId: z.string().uuid().optional(), nextServiceAt: z.coerce.date().optional(), nextServiceHours: z.number().optional() }).parse(req.body);
    if (body.currentProjectId) await requireOrganisationProject(app, req, body.currentProjectId);
    const plant = await app.prisma.plant.create({ data: { ...body, organisationId: req.auth.organisationId } });
    await audit(app, req, "CREATE", "Plant", plant.id, plant); return reply.code(201).send(plant);
  });
  app.patch("/:id/location", { preHandler: allowSection(AccountSection.PLANT_MANAGEMENT, ...plantManagers) }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ projectId: z.string().uuid().nullable() }).parse(req.body);
    const plant = await app.prisma.plant.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId } });
    if (body.projectId) await requireOrganisationProject(app, req, body.projectId);
    const updated = await app.prisma.plant.update({ where: { id: plant.id }, data: { currentProjectId: body.projectId }, include: { currentProject: true } });
    await audit(app, req, "UPDATE_LOCATION", "Plant", id, { previousProjectId: plant.currentProjectId, currentProjectId: body.projectId });
    return reply.send(updated);
  });
  app.get("/:id/telemetry", { preHandler: authed }, async req => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const q = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), source: z.string().optional() }).parse(req.query);
    await app.prisma.plant.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId } });
    return app.prisma.plantTelemetryReading.findMany({
      where: { plantId: id, source: q.source, capturedAt: { gte: q.from, lte: q.to } },
      orderBy: { capturedAt: "desc" },
    });
  });
  app.post("/:id/telemetry", { preHandler: allowSection(AccountSection.PLANT_MANAGEMENT, ...plantTelemetryManagers) }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const plant = await app.prisma.plant.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId } });
    const body = plantTelemetryReading.parse(req.body);
    if (body.projectId) await requireOrganisationProject(app, req, body.projectId);
    if (body.engineHours !== undefined && plant.hourMeter !== null && body.engineHours < Number(plant.hourMeter)) return reply.code(409).send({ error: "Engine hours cannot move backwards" });
    if (body.odometerKm !== undefined && plant.odometerKm !== null && body.odometerKm < plant.odometerKm) return reply.code(409).send({ error: "Odometer cannot move backwards" });
    const [reading] = await app.prisma.$transaction([
      app.prisma.plantTelemetryReading.create({ data: { ...body, plantId: id, organisationId: req.auth.organisationId } }),
      app.prisma.plant.update({ where: { id }, data: { hourMeter: body.engineHours ?? undefined, odometerKm: body.odometerKm ?? undefined, currentProjectId: body.projectId ?? undefined } }),
    ]);
    await audit(app, req, "TELEMETRY", "Plant", id, { readingId: reading.id, source: reading.source, capturedAt: reading.capturedAt });
    return reply.code(201).send(reading);
  });
  app.post("/:id/pre-starts", { preHandler: authed }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const plant = await app.prisma.plant.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId } });
    const body = z.object({ workerId: z.string().uuid(), projectId: z.string().uuid().optional(), inspectedAt: z.coerce.date().optional(), hourMeter: z.number().nonnegative().optional(), odometerKm: z.number().int().nonnegative().optional(), checklistTemplateId: z.string().uuid().optional(), answers: z.record(z.union([z.boolean(), z.string(), z.number(), z.null()])), result: z.nativeEnum(InspectionResult), photoIds: z.array(z.string().uuid()).max(30).default([]), defects: z.array(z.object({ questionId: z.string(), item: z.string().min(1), severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]), detail: z.string().min(1), photoIds: z.array(z.string().uuid()).max(20).default([]) })).default([]), signature: z.string().min(1).max(500_000) }).parse(req.body);
    if (body.projectId) await requireOrganisationProject(app, req, body.projectId);
    await app.prisma.worker.findFirstOrThrow({ where: { id: body.workerId, organisationId: req.auth.organisationId, userId: req.auth.userId } });
    const template = body.checklistTemplateId
      ? await app.prisma.preStartTemplate.findFirstOrThrow({ where: { id: body.checklistTemplateId, organisationId: req.auth.organisationId, status: "PUBLISHED", OR: [{ plantType: null }, { plantType: { equals: plant.type, mode: "insensitive" } }] } })
      : await app.prisma.preStartTemplate.findFirst({
          where: { organisationId: req.auth.organisationId, status: "PUBLISHED", plantType: { equals: plant.type, mode: "insensitive" } },
          orderBy: [{ version: "desc" }, { publishedAt: "desc" }, { name: "asc" }],
        }) ?? await app.prisma.preStartTemplate.findFirst({
          where: { organisationId: req.auth.organisationId, status: "PUBLISHED", plantType: null },
          orderBy: [{ version: "desc" }, { publishedAt: "desc" }, { name: "asc" }],
        });
    if (!template) return reply.code(409).send({ error: "No published generic pre-start template is available" });
    if (body.hourMeter !== undefined && plant.hourMeter !== null && body.hourMeter < Number(plant.hourMeter)) return reply.code(409).send({ error: "Hour meter cannot move backwards" });
    if (body.odometerKm !== undefined && plant.odometerKm !== null && body.odometerKm < plant.odometerKm) return reply.code(409).send({ error: "Odometer cannot move backwards" });
    const validation = validatePreStartAnswers(template.sections, body.answers); if (!validation.valid) return reply.code(400).send({ error: "Checklist answers do not match the template", ...validation });
    const triggeringQuestions = defectQuestionIds(template.sections, body.answers); const hasDefect = triggeringQuestions.length > 0;
    if (hasDefect && body.result === InspectionResult.PASS) return reply.code(409).send({ error: "A checklist with failed or defect-triggering answers cannot pass" });
    if (!hasDefect && body.result !== InspectionResult.PASS) return reply.code(409).send({ error: "A defect result requires at least one defect-triggering answer" });
    const defectIds = new Set(body.defects.map(d => d.questionId)); const missingDefects = triggeringQuestions.filter(questionId => !defectIds.has(questionId));
    if (missingDefects.length) return reply.code(400).send({ error: "Every failed check requires a defect record", questionIds: missingDefects });
    const submittedPhotoIds = [...new Set([...body.photoIds, ...body.defects.flatMap(defect => defect.photoIds)])];
    if (submittedPhotoIds.length) {
      const photoCount = await app.prisma.fileAsset.count({ where: { id: { in: submittedPhotoIds }, organisationId: req.auth.organisationId, deletedAt: null } });
      if (photoCount !== submittedPhotoIds.length) return reply.code(400).send({ error: "Every pre-start photo must belong to this organisation" });
    }
    if (body.result === InspectionResult.OUT_OF_SERVICE && body.answers["lockout-tagout"] !== true) return reply.code(409).send({ error: "Out-of-service plant must be locked out or tagged out" });
    const [preStart] = await app.prisma.$transaction([
      app.prisma.plantPreStart.create({ data: { ...body, checklistTemplateId: template.id, plantId: id, checklistVersion: `${template.name}:v${template.version}`, answers: body.answers, defects: body.defects } }),
      app.prisma.plant.update({ where: { id }, data: { status: body.result === InspectionResult.OUT_OF_SERVICE ? "OUT_OF_SERVICE" : body.result === InspectionResult.DEFECT ? "DEFECT_REPORTED" : undefined, hourMeter: body.hourMeter, odometerKm: body.odometerKm, currentProjectId: body.projectId ?? plant.currentProjectId } }),
      app.prisma.auditEvent.create({ data: auditData(req, "PRE_START", "Plant", id, { result: body.result, checklistTemplateId: template.id, checklistVersion: template.version, workerId: body.workerId }) }),
    ]);
    return reply.code(201).send(preStart);
  });
  app.post("/:id/clearance", { preHandler: allow(...plantClearers) }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params); const body = z.object({ reason: z.string().min(10).max(2000), evidenceDocumentId: z.string().uuid().optional() }).parse(req.body);
    const plant = await app.prisma.plant.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId, status: { in: ["OUT_OF_SERVICE", "DEFECT_REPORTED"] } } });
    const [clearance] = await app.prisma.$transaction([
      app.prisma.plantClearance.create({ data: { plantId: id, clearedById: req.auth.userId, reason: body.reason, evidenceDocumentId: body.evidenceDocumentId, previousStatus: plant.status } }),
      app.prisma.plant.update({ where: { id }, data: { status: "AVAILABLE" } }),
    ]);
    await audit(app, req, "CLEARANCE", "Plant", id, clearance, body.reason); return reply.code(201).send(clearance);
  });
};
export default routes;
