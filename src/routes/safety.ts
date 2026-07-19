import type { FastifyPluginAsync } from "fastify";
import { ControlType, HazardStatus, HseqDomain, HseqInspectionType, InspectionResult, PermitStatus, PermitType, RiskLevel, Role, SafetyObservationType, Status } from "@prisma/client";
import { z } from "zod";
import { allow, authed, requireOrganisationProject } from "../lib/access.js";
import { audit, auditData } from "../lib/audit.js";
import { createHash } from "node:crypto";

const documentHash = (doc: { projectId: string; type: string; title: string; version: number; riskLevel: unknown; activities: unknown; hazards: unknown; controls: unknown; reviewDueAt: Date | null }) =>
  createHash("sha256").update(JSON.stringify({ projectId: doc.projectId, type: doc.type, title: doc.title, version: doc.version, riskLevel: doc.riskLevel, activities: doc.activities, hazards: doc.hazards, controls: doc.controls, reviewDueAt: doc.reviewDueAt?.toISOString() ?? null })).digest("hex");

const uuidParam = z.object({ id: z.string().uuid() });
const optionalProjectQuery = z.object({ projectId: z.string().uuid().optional() });
const actionSource = z.object({ incidentId: z.string().uuid().optional(), hazardId: z.string().uuid().optional(), observationId: z.string().uuid().optional(), inspectionId: z.string().uuid().optional(), permitId: z.string().uuid().optional() });
const hseqCreators = [Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER, Role.OPERATIONS_MANAGER, Role.SUPERVISOR, Role.SITE_SUPERVISOR, Role.SITE_ENGINEER, Role.FOREMAN, Role.SAFETY_MANAGER];
const hseqVerifiers = [Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER, Role.OPERATIONS_MANAGER, Role.SUPERVISOR, Role.SITE_SUPERVISOR, Role.SITE_ENGINEER, Role.SAFETY_MANAGER];
const documentAuthors = [Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER, Role.OPERATIONS_MANAGER, Role.SUPERVISOR, Role.SITE_SUPERVISOR, Role.SITE_ENGINEER, Role.SAFETY_MANAGER];

const routes: FastifyPluginAsync = async app => {
  app.post("/documents", { preHandler: allow(...documentAuthors) }, async (req, reply) => {
    const b = z.object({ projectId: z.string().uuid(), type: z.enum(["SWMS","JSA","TOOLBOX_TALK","RISK_ASSESSMENT","ENVIRONMENTAL_PLAN","TRAFFIC_PLAN","EMERGENCY_PLAN"]), title: z.string(), version: z.number().int().positive().default(1), riskLevel: z.nativeEnum(RiskLevel).optional(), activities: z.array(z.any()).optional(), hazards: z.array(z.any()).optional(), controls: z.array(z.any()).optional(), reviewDueAt: z.coerce.date().optional(), supersedesId: z.string().uuid().optional() }).parse(req.body);
    await requireOrganisationProject(app, req, b.projectId);
    if (b.supersedesId) await app.prisma.safetyDocument.findFirstOrThrow({ where: { id: b.supersedesId, projectId: b.projectId, project: { organisationId: req.auth.organisationId } } });
    const doc = await app.prisma.safetyDocument.create({ data: b }); await audit(app, req, "CREATE", "SafetyDocument", doc.id, doc); return reply.code(201).send(doc);
  });
  app.post("/documents/:id/approve", { preHandler: allow(Role.OWNER, Role.ADMIN, Role.SAFETY_MANAGER) }, async req => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await app.prisma.safetyDocument.findFirstOrThrow({ where: { id, status: Status.DRAFT, project: { organisationId: req.auth.organisationId } } });
    const doc = await app.prisma.safetyDocument.update({ where: { id }, data: { status: Status.APPROVED, approvedById: req.auth.userId, approvedAt: new Date(), contentHash: documentHash(existing) } }); await audit(app, req, "APPROVE", "SafetyDocument", id, doc); return doc;
  });
  app.post("/documents/:id/publish", { preHandler: allow(...documentAuthors) }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ workerIds: z.array(z.string().uuid()).min(1), dueAt: z.coerce.date().optional() }).parse(req.body);
    const doc = await app.prisma.safetyDocument.findFirstOrThrow({ where: { id, status: Status.APPROVED, project: { organisationId: req.auth.organisationId } } });
    const workers = await app.prisma.worker.count({ where: { id: { in: body.workerIds }, organisationId: req.auth.organisationId } });
    if (workers !== new Set(body.workerIds).size) return reply.code(400).send({ error: "All workers must belong to this organisation" });
    await app.prisma.$transaction([
      app.prisma.safetyDocument.update({ where: { id }, data: { publishedAt: doc.publishedAt ?? new Date() } }),
      ...body.workerIds.map(workerId => app.prisma.safetyAssignment.upsert({ where: { safetyDocumentId_workerId: { safetyDocumentId: id, workerId } }, create: { safetyDocumentId: id, workerId, assignedById: req.auth.userId, dueAt: body.dueAt }, update: { dueAt: body.dueAt } })),
    ]);
    await audit(app, req, "PUBLISH", "SafetyDocument", id, { workerIds: body.workerIds, dueAt: body.dueAt });
    return reply.code(201).send({ documentId: id, assigned: body.workerIds.length });
  });
  app.post("/documents/:id/acknowledge", { preHandler: authed }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params); const b = z.object({ signedName: z.string().min(2), signature: z.string().min(1).max(500_000), signatureMethod: z.enum(["DRAWN", "TYPED"]), consent: z.literal(true) }).parse(req.body);
    const assignment = await app.prisma.safetyAssignment.findFirstOrThrow({ where: { safetyDocumentId: id, worker: { organisationId: req.auth.organisationId, userId: req.auth.userId } }, include: { document: true } });
    if (!assignment.document.publishedAt || !assignment.document.contentHash || assignment.document.status !== Status.APPROVED) return reply.code(409).send({ error: "Only an approved and published document can be signed" });
    const signer = await app.prisma.user.findUniqueOrThrow({ where: { id: req.auth.userId } });
    const [ack] = await app.prisma.$transaction([
      app.prisma.safetyAcknowledgement.create({ data: { safetyDocumentId: id, workerId: assignment.workerId, assignmentId: assignment.id, signature: b.signature, signedName: signer.name, signatureMethod: b.signatureMethod, documentContentHash: assignment.document.contentHash, consentText: "I confirm I have read, understood and agree to follow this document.", ipAddress: req.ip, userAgent: req.headers["user-agent"] } }),
      app.prisma.auditEvent.create({ data: auditData(req, "ACKNOWLEDGE", "SafetyDocument", id, { workerId: assignment.workerId, documentContentHash: assignment.document.contentHash }) }),
    ]); return reply.code(201).send(ack);
  });
  app.get("/my-assignments", { preHandler: authed }, async req => app.prisma.safetyAssignment.findMany({ where: { worker: { organisationId: req.auth.organisationId, userId: req.auth.userId } }, include: { document: true, acknowledgement: true }, orderBy: { assignedAt: "desc" } }));
  app.post("/incidents", { preHandler: authed }, async (req, reply) => {
    const b = z.object({ projectId: z.string().uuid(), occurredAt: z.coerce.date(), type: z.string(), severity: z.nativeEnum(RiskLevel), description: z.string(), immediateActions: z.string().optional(), notifiableAssessment: z.record(z.any()).optional() }).parse(req.body);
    await requireOrganisationProject(app, req, b.projectId);
    const incident = await app.prisma.incident.create({ data: b }); await audit(app, req, "CREATE", "Incident", incident.id, incident); return reply.code(201).send(incident);
  });
  app.get("/hazards", { preHandler: authed }, async req => {
    const q = optionalProjectQuery.extend({ status: z.nativeEnum(HazardStatus).optional(), domain: z.nativeEnum(HseqDomain).optional(), riskLevel: z.nativeEnum(RiskLevel).optional() }).parse(req.query);
    if (q.projectId) await requireOrganisationProject(app, req, q.projectId);
    return app.prisma.hazardRegisterItem.findMany({ where: { organisationId: req.auth.organisationId, projectId: q.projectId, status: q.status, domain: q.domain, riskLevel: q.riskLevel }, include: { controls: true, correctiveActions: true }, orderBy: [{ riskLevel: "desc" }, { identifiedAt: "desc" }] });
  });
  app.post("/hazards", { preHandler: allow(...hseqCreators) }, async (req, reply) => {
    const b = z.object({ projectId: z.string().uuid(), title: z.string().min(3), description: z.string().min(3), domain: z.nativeEnum(HseqDomain).default(HseqDomain.SAFETY), activity: z.string().optional(), location: z.string().optional(), riskLevel: z.nativeEnum(RiskLevel), residualRiskLevel: z.nativeEnum(RiskLevel).optional(), status: z.nativeEnum(HazardStatus).default(HazardStatus.IDENTIFIED), legalReference: z.string().optional(), reviewDueAt: z.coerce.date().optional(), controls: z.array(z.object({ type: z.nativeEnum(ControlType), title: z.string().min(2), description: z.string().min(2), ownerId: z.string().uuid().optional(), verificationMethod: z.string().optional(), reviewDueAt: z.coerce.date().optional() })).optional() }).parse(req.body);
    await requireOrganisationProject(app, req, b.projectId);
    const ownerIds = [...new Set((b.controls ?? []).flatMap(control => control.ownerId ? [control.ownerId] : []))];
    if (ownerIds.length) {
      const owners = await app.prisma.worker.count({ where: { id: { in: ownerIds }, organisationId: req.auth.organisationId } });
      if (owners !== ownerIds.length) return reply.code(400).send({ error: "All control owners must belong to this organisation" });
    }
    const hazard = await app.prisma.hazardRegisterItem.create({ data: { organisationId: req.auth.organisationId, projectId: b.projectId, title: b.title, description: b.description, domain: b.domain, activity: b.activity, location: b.location, riskLevel: b.riskLevel, residualRiskLevel: b.residualRiskLevel, status: b.status, legalReference: b.legalReference, reviewDueAt: b.reviewDueAt, identifiedById: req.auth.userId, controls: b.controls ? { create: b.controls.map(control => ({ ...control, organisationId: req.auth.organisationId, projectId: b.projectId })) } : undefined }, include: { controls: true } });
    await audit(app, req, "CREATE", "HazardRegisterItem", hazard.id, hazard); return reply.code(201).send(hazard);
  });
  app.patch("/hazards/:id/status", { preHandler: allow(...hseqCreators) }, async req => {
    const { id } = uuidParam.parse(req.params); const b = z.object({ status: z.nativeEnum(HazardStatus), residualRiskLevel: z.nativeEnum(RiskLevel).optional(), reviewDueAt: z.coerce.date().optional() }).parse(req.body);
    await app.prisma.hazardRegisterItem.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId } });
    const hazard = await app.prisma.hazardRegisterItem.update({ where: { id }, data: { ...b, closedAt: b.status === HazardStatus.CLOSED ? new Date() : null } });
    await audit(app, req, "UPDATE_STATUS", "HazardRegisterItem", id, hazard); return hazard;
  });
  app.post("/hazards/:id/controls", { preHandler: allow(...hseqCreators) }, async (req, reply) => {
    const { id } = uuidParam.parse(req.params); const b = z.object({ type: z.nativeEnum(ControlType), title: z.string().min(2), description: z.string().min(2), ownerId: z.string().uuid().optional(), verificationMethod: z.string().optional(), implementedAt: z.coerce.date().optional(), reviewDueAt: z.coerce.date().optional() }).parse(req.body);
    const hazard = await app.prisma.hazardRegisterItem.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId } });
    if (b.ownerId) await app.prisma.worker.findFirstOrThrow({ where: { id: b.ownerId, organisationId: req.auth.organisationId } });
    const control = await app.prisma.controlMeasure.create({ data: { ...b, organisationId: req.auth.organisationId, projectId: hazard.projectId, hazardId: id } });
    await audit(app, req, "CREATE", "ControlMeasure", control.id, control); return reply.code(201).send(control);
  });
  app.get("/controls", { preHandler: authed }, async req => {
    const q = optionalProjectQuery.extend({ type: z.nativeEnum(ControlType).optional(), dueOnly: z.coerce.boolean().optional() }).parse(req.query);
    if (q.projectId) await requireOrganisationProject(app, req, q.projectId);
    return app.prisma.controlMeasure.findMany({ where: { organisationId: req.auth.organisationId, projectId: q.projectId, type: q.type, reviewDueAt: q.dueOnly ? { lte: new Date() } : undefined }, include: { hazard: true }, orderBy: [{ reviewDueAt: "asc" }, { createdAt: "desc" }] });
  });
  app.patch("/controls/:id/verify", { preHandler: allow(...hseqVerifiers) }, async req => {
    const { id } = uuidParam.parse(req.params); const b = z.object({ effectiveness: z.string().optional(), evidenceDocumentId: z.string().uuid().optional(), reviewDueAt: z.coerce.date().optional() }).parse(req.body);
    await app.prisma.controlMeasure.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId } });
    const control = await app.prisma.controlMeasure.update({ where: { id }, data: { ...b, verifiedAt: new Date(), verifiedById: req.auth.userId } });
    await audit(app, req, "VERIFY", "ControlMeasure", id, control); return control;
  });
  app.get("/observations", { preHandler: authed }, async req => {
    const q = optionalProjectQuery.extend({ type: z.nativeEnum(SafetyObservationType).optional(), status: z.nativeEnum(Status).optional() }).parse(req.query);
    if (q.projectId) await requireOrganisationProject(app, req, q.projectId);
    return app.prisma.safetyObservation.findMany({ where: { organisationId: req.auth.organisationId, projectId: q.projectId, type: q.type, status: q.status }, include: { correctiveActions: true }, orderBy: { observedAt: "desc" } });
  });
  app.post("/observations", { preHandler: authed }, async (req, reply) => {
    const b = z.object({ projectId: z.string().uuid(), type: z.nativeEnum(SafetyObservationType), title: z.string().min(3), description: z.string().min(3), location: z.string().optional(), riskLevel: z.nativeEnum(RiskLevel).optional(), observedAt: z.coerce.date().optional(), photos: z.array(z.string()).optional(), immediateAction: z.string().optional() }).parse(req.body);
    await requireOrganisationProject(app, req, b.projectId);
    const observation = await app.prisma.safetyObservation.create({ data: { ...b, organisationId: req.auth.organisationId, reportedById: req.auth.userId } });
    await audit(app, req, "CREATE", "SafetyObservation", observation.id, observation); return reply.code(201).send(observation);
  });
  app.get("/inspections", { preHandler: authed }, async req => {
    const q = optionalProjectQuery.extend({ type: z.nativeEnum(HseqInspectionType).optional(), status: z.nativeEnum(Status).optional() }).parse(req.query);
    if (q.projectId) await requireOrganisationProject(app, req, q.projectId);
    return app.prisma.hseqInspection.findMany({ where: { organisationId: req.auth.organisationId, projectId: q.projectId, type: q.type, status: q.status }, include: { items: true, correctiveActions: true }, orderBy: { inspectedAt: "desc" } });
  });
  app.post("/inspections", { preHandler: allow(...hseqCreators) }, async (req, reply) => {
    const b = z.object({ projectId: z.string().uuid(), type: z.nativeEnum(HseqInspectionType), title: z.string().min(3), location: z.string().optional(), scheduledAt: z.coerce.date().optional(), inspectedAt: z.coerce.date().optional(), score: z.number().int().min(0).max(100).optional(), result: z.nativeEnum(InspectionResult).optional(), status: z.nativeEnum(Status).default(Status.SUBMITTED), notes: z.string().optional(), photos: z.array(z.string()).optional(), items: z.array(z.object({ section: z.string().optional(), question: z.string().min(2), result: z.nativeEnum(InspectionResult), notes: z.string().optional(), hazardId: z.string().uuid().optional(), correctiveActionRequired: z.boolean().default(false) })).default([]) }).parse(req.body);
    await requireOrganisationProject(app, req, b.projectId);
    const inspection = await app.prisma.hseqInspection.create({ data: { organisationId: req.auth.organisationId, projectId: b.projectId, type: b.type, title: b.title, location: b.location, scheduledAt: b.scheduledAt, inspectedAt: b.inspectedAt, inspectedById: req.auth.userId, score: b.score, result: b.result, status: b.status, notes: b.notes, photos: b.photos, items: { create: b.items } }, include: { items: true } });
    await audit(app, req, "CREATE", "HseqInspection", inspection.id, inspection); return reply.code(201).send(inspection);
  });
  app.patch("/inspections/:id/complete", { preHandler: allow(...hseqVerifiers) }, async req => {
    const { id } = uuidParam.parse(req.params); const b = z.object({ score: z.number().int().min(0).max(100).optional(), result: z.nativeEnum(InspectionResult), notes: z.string().optional() }).parse(req.body);
    await app.prisma.hseqInspection.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId } });
    const inspection = await app.prisma.hseqInspection.update({ where: { id }, data: { ...b, status: Status.CLOSED } });
    await audit(app, req, "COMPLETE", "HseqInspection", id, inspection); return inspection;
  });
  app.get("/permits", { preHandler: authed }, async req => {
    const q = optionalProjectQuery.extend({ type: z.nativeEnum(PermitType).optional(), status: z.nativeEnum(PermitStatus).optional() }).parse(req.query);
    if (q.projectId) await requireOrganisationProject(app, req, q.projectId);
    return app.prisma.permitToWork.findMany({ where: { organisationId: req.auth.organisationId, projectId: q.projectId, type: q.type, status: q.status }, include: { correctiveActions: true }, orderBy: { startsAt: "desc" } });
  });
  app.post("/permits", { preHandler: allow(...hseqCreators) }, async (req, reply) => {
    const b = z.object({ projectId: z.string().uuid(), type: z.nativeEnum(PermitType), title: z.string().min(3), location: z.string().min(2), scope: z.string().min(3), startsAt: z.coerce.date(), expiresAt: z.coerce.date(), isolationDetails: z.record(z.any()).optional(), hazards: z.array(z.any()).optional(), controls: z.array(z.any()).optional(), signOns: z.array(z.any()).optional(), attachments: z.array(z.any()).optional() }).parse(req.body);
    if (b.expiresAt <= b.startsAt) return reply.code(400).send({ error: "Permit expiry must be after start time" });
    await requireOrganisationProject(app, req, b.projectId);
    const permit = await app.prisma.permitToWork.create({ data: { ...b, organisationId: req.auth.organisationId, requestedById: req.auth.userId } });
    await audit(app, req, "CREATE", "PermitToWork", permit.id, permit); return reply.code(201).send(permit);
  });
  app.patch("/permits/:id/status", { preHandler: allow(...hseqVerifiers) }, async req => {
    const { id } = uuidParam.parse(req.params); const b = z.object({ status: z.nativeEnum(PermitStatus) }).parse(req.body);
    await app.prisma.permitToWork.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId } });
    const approvesPermit = b.status === PermitStatus.APPROVED || b.status === PermitStatus.ACTIVE;
    const permit = await app.prisma.permitToWork.update({ where: { id }, data: { status: b.status, approvedById: approvesPermit ? req.auth.userId : undefined, closedAt: b.status === PermitStatus.CLOSED ? new Date() : undefined } });
    await audit(app, req, "UPDATE_STATUS", "PermitToWork", id, permit); return permit;
  });
  app.get("/actions", { preHandler: authed }, async req => {
    const q = optionalProjectQuery.extend({ ownerId: z.string().uuid().optional(), status: z.nativeEnum(Status).optional(), overdue: z.coerce.boolean().optional() }).parse(req.query);
    if (q.projectId) await requireOrganisationProject(app, req, q.projectId);
    return app.prisma.correctiveAction.findMany({ where: { project: { organisationId: req.auth.organisationId }, projectId: q.projectId, ownerId: q.ownerId, status: q.status, dueAt: q.overdue ? { lt: new Date() } : undefined }, include: { incident: true, hazard: true, observation: true, inspection: true, permit: true }, orderBy: [{ status: "asc" }, { dueAt: "asc" }] });
  });
  app.post("/actions", { preHandler: allow(...hseqCreators) }, async (req, reply) => {
    const b = z.object({ projectId: z.string().uuid(), description: z.string().min(3), ownerId: z.string().uuid(), dueAt: z.coerce.date(), priority: z.nativeEnum(RiskLevel).default(RiskLevel.MEDIUM), source: z.string().optional(), evidenceDocumentId: z.string().uuid().optional() }).merge(actionSource).parse(req.body);
    await requireOrganisationProject(app, req, b.projectId);
    await app.prisma.worker.findFirstOrThrow({ where: { id: b.ownerId, organisationId: req.auth.organisationId } });
    const action = await app.prisma.correctiveAction.create({ data: b });
    await audit(app, req, "CREATE", "CorrectiveAction", action.id, action); return reply.code(201).send(action);
  });
  app.patch("/actions/:id", { preHandler: allow(...hseqCreators) }, async req => {
    const { id } = uuidParam.parse(req.params); const b = z.object({ status: z.nativeEnum(Status).optional(), ownerId: z.string().uuid().optional(), dueAt: z.coerce.date().optional(), priority: z.nativeEnum(RiskLevel).optional(), completionNotes: z.string().optional(), evidenceDocumentId: z.string().uuid().optional() }).parse(req.body);
    await app.prisma.correctiveAction.findFirstOrThrow({ where: { id, project: { organisationId: req.auth.organisationId } } });
    if (b.ownerId) await app.prisma.worker.findFirstOrThrow({ where: { id: b.ownerId, organisationId: req.auth.organisationId } });
    const action = await app.prisma.correctiveAction.update({ where: { id }, data: { ...b, completedAt: b.status === Status.CLOSED ? new Date() : undefined } });
    await audit(app, req, "UPDATE", "CorrectiveAction", id, action); return action;
  });
  app.get("/dashboard", { preHandler: authed }, async req => {
    const q = optionalProjectQuery.parse(req.query);
    if (q.projectId) await requireOrganisationProject(app, req, q.projectId);
    const projectFilter = q.projectId ? { projectId: q.projectId } : {};
    const now = new Date();
    const [activeProjects, pendingTimecards, openHazards, highRiskHazards, overdueControls, openActions, overdueActions, openIncidents, activePermits, pendingDocuments, recentObservations, recentInspections] = await Promise.all([
      app.prisma.project.count({ where: { organisationId: req.auth.organisationId, status: "ACTIVE" } }),
      app.prisma.timesheetApprovalRequest.count({ where: { approverUserId: req.auth.userId, status: "PENDING", timesheet: { project: { organisationId: req.auth.organisationId } } } }),
      app.prisma.hazardRegisterItem.count({ where: { organisationId: req.auth.organisationId, ...projectFilter, status: { not: HazardStatus.CLOSED } } }),
      app.prisma.hazardRegisterItem.count({ where: { organisationId: req.auth.organisationId, ...projectFilter, status: { not: HazardStatus.CLOSED }, riskLevel: { in: [RiskLevel.HIGH, RiskLevel.EXTREME] } } }),
      app.prisma.controlMeasure.count({ where: { organisationId: req.auth.organisationId, ...projectFilter, verifiedAt: null, reviewDueAt: { lt: now } } }),
      app.prisma.correctiveAction.count({ where: { project: { organisationId: req.auth.organisationId }, ...projectFilter, status: { not: Status.CLOSED } } }),
      app.prisma.correctiveAction.count({ where: { project: { organisationId: req.auth.organisationId }, ...projectFilter, status: { not: Status.CLOSED }, dueAt: { lt: now } } }),
      app.prisma.incident.count({ where: { project: { organisationId: req.auth.organisationId }, ...projectFilter, status: { not: Status.CLOSED } } }),
      app.prisma.permitToWork.count({ where: { organisationId: req.auth.organisationId, ...projectFilter, status: { in: [PermitStatus.APPROVED, PermitStatus.ACTIVE] }, expiresAt: { gte: now } } }),
      app.prisma.safetyDocument.count({ where: { project: { organisationId: req.auth.organisationId }, ...projectFilter, status: { in: [Status.DRAFT, Status.SUBMITTED] } } }),
      app.prisma.safetyObservation.findMany({ where: { organisationId: req.auth.organisationId, ...projectFilter }, orderBy: { observedAt: "desc" }, take: 5 }),
      app.prisma.hseqInspection.findMany({ where: { organisationId: req.auth.organisationId, ...projectFilter }, orderBy: { inspectedAt: "desc" }, take: 5, include: { items: true } }),
    ]);
    return { activeProjects, pendingTimecards, openHazards, highRiskHazards, overdueControls, openActions, overdueActions, openIncidents, activePermits, pendingDocuments, recentObservations, recentInspections };
  });
};
export default routes;
