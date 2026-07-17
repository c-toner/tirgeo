import type { FastifyPluginAsync } from "fastify";
import { InspectionResult, Role } from "@prisma/client";
import { z } from "zod";
import { allow, authed, requireOrganisationProject } from "../lib/access.js";
import { audit, auditData } from "../lib/audit.js";
import { plantTelemetryReading } from "../lib/civil.js";
import { defectQuestionIds, preStartSections, validatePreStartAnswers } from "../lib/prestart.js";

const routes: FastifyPluginAsync = async app => {
  app.get("/pre-start-templates", { preHandler: authed }, async req => {
    const q = z.object({ plantType: z.string().optional() }).parse(req.query);
    return app.prisma.preStartTemplate.findMany({ where: { organisationId: req.auth.organisationId, status: "PUBLISHED", OR: q.plantType ? [{ plantType: q.plantType }, { plantType: null }] : undefined }, orderBy: [{ plantType: "desc" }, { name: "asc" }, { version: "desc" }] });
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
  app.get("/", { preHandler: authed }, req => app.prisma.plant.findMany({ where: { organisationId: req.auth.organisationId }, orderBy: { assetNumber: "asc" } }));
  app.post("/", { preHandler: allow(Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER) }, async (req, reply) => {
    const body = z.object({ assetNumber: z.string(), type: z.string(), make: z.string().optional(), model: z.string().optional(), serialNumber: z.string().optional(), registration: z.string().optional(), nextServiceAt: z.coerce.date().optional(), nextServiceHours: z.number().optional() }).parse(req.body);
    const plant = await app.prisma.plant.create({ data: { ...body, organisationId: req.auth.organisationId } });
    await audit(app, req, "CREATE", "Plant", plant.id, plant); return reply.code(201).send(plant);
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
  app.post("/:id/telemetry", { preHandler: allow(Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER, Role.SUPERVISOR) }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const plant = await app.prisma.plant.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId } });
    const body = plantTelemetryReading.parse(req.body);
    if (body.projectId) await requireOrganisationProject(app, req, body.projectId);
    if (body.engineHours !== undefined && plant.hourMeter !== null && body.engineHours < Number(plant.hourMeter)) return reply.code(409).send({ error: "Engine hours cannot move backwards" });
    if (body.odometerKm !== undefined && plant.odometerKm !== null && body.odometerKm < plant.odometerKm) return reply.code(409).send({ error: "Odometer cannot move backwards" });
    const [reading] = await app.prisma.$transaction([
      app.prisma.plantTelemetryReading.create({ data: { ...body, plantId: id, organisationId: req.auth.organisationId } }),
      app.prisma.plant.update({ where: { id }, data: { hourMeter: body.engineHours ?? undefined, odometerKm: body.odometerKm ?? undefined } }),
    ]);
    await audit(app, req, "TELEMETRY", "Plant", id, { readingId: reading.id, source: reading.source, capturedAt: reading.capturedAt });
    return reply.code(201).send(reading);
  });
  app.post("/:id/pre-starts", { preHandler: authed }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const plant = await app.prisma.plant.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId } });
    const body = z.object({ workerId: z.string().uuid(), projectId: z.string().uuid().optional(), inspectedAt: z.coerce.date().optional(), hourMeter: z.number().nonnegative().optional(), odometerKm: z.number().int().nonnegative().optional(), checklistTemplateId: z.string().uuid(), answers: z.record(z.union([z.boolean(), z.string(), z.number(), z.null()])), result: z.nativeEnum(InspectionResult), defects: z.array(z.object({ questionId: z.string(), item: z.string().min(1), severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]), detail: z.string().min(1), photoIds: z.array(z.string()).default([]) })).default([]), signature: z.string().min(1).max(500_000) }).parse(req.body);
    if (body.projectId) await requireOrganisationProject(app, req, body.projectId);
    await app.prisma.worker.findFirstOrThrow({ where: { id: body.workerId, organisationId: req.auth.organisationId, userId: req.auth.userId } });
    const template = await app.prisma.preStartTemplate.findFirstOrThrow({ where: { id: body.checklistTemplateId, organisationId: req.auth.organisationId, status: "PUBLISHED", OR: [{ plantType: null }, { plantType: plant.type }] } });
    if (body.hourMeter !== undefined && plant.hourMeter !== null && body.hourMeter < Number(plant.hourMeter)) return reply.code(409).send({ error: "Hour meter cannot move backwards" });
    if (body.odometerKm !== undefined && plant.odometerKm !== null && body.odometerKm < plant.odometerKm) return reply.code(409).send({ error: "Odometer cannot move backwards" });
    const validation = validatePreStartAnswers(template.sections, body.answers); if (!validation.valid) return reply.code(400).send({ error: "Checklist answers do not match the template", ...validation });
    const triggeringQuestions = defectQuestionIds(template.sections, body.answers); const hasDefect = triggeringQuestions.length > 0;
    if (hasDefect && body.result === InspectionResult.PASS) return reply.code(409).send({ error: "A checklist with failed or defect-triggering answers cannot pass" });
    if (!hasDefect && body.result !== InspectionResult.PASS) return reply.code(409).send({ error: "A defect result requires at least one defect-triggering answer" });
    const defectIds = new Set(body.defects.map(d => d.questionId)); const missingDefects = triggeringQuestions.filter(questionId => !defectIds.has(questionId));
    if (missingDefects.length) return reply.code(400).send({ error: "Every failed check requires a defect record", questionIds: missingDefects });
    if (body.result === InspectionResult.OUT_OF_SERVICE && body.answers["lockout-tagout"] !== true) return reply.code(409).send({ error: "Out-of-service plant must be locked out or tagged out" });
    const [preStart] = await app.prisma.$transaction([
      app.prisma.plantPreStart.create({ data: { ...body, plantId: id, checklistVersion: `${template.name}:v${template.version}`, answers: body.answers, defects: body.defects } }),
      app.prisma.plant.update({ where: { id }, data: { status: body.result === InspectionResult.OUT_OF_SERVICE ? "OUT_OF_SERVICE" : body.result === InspectionResult.DEFECT ? "DEFECT_REPORTED" : undefined, hourMeter: body.hourMeter, odometerKm: body.odometerKm } }),
      app.prisma.auditEvent.create({ data: auditData(req, "PRE_START", "Plant", id, { result: body.result, checklistTemplateId: template.id, checklistVersion: template.version, workerId: body.workerId }) }),
    ]);
    return reply.code(201).send(preStart);
  });
  app.post("/:id/clearance", { preHandler: allow(Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER, Role.SAFETY_MANAGER) }, async (req, reply) => {
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
