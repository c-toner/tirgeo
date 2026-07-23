import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { ApprovalRequestStatus, Prisma, Role, Status, TimesheetSignatureType } from "@prisma/client";
import { z } from "zod";
import { allow, authed } from "../lib/access.js";
import { audit, auditData } from "../lib/audit.js";
import { syncTimeEntryDailyCost } from "../lib/daily-costs.js";
import { timesheetContentHash, validateTimesheetEntries } from "../lib/timesheet.js";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";

const entry = z.object({ id: z.string().uuid().optional(), costCodeId: z.string().uuid().optional(), workDate: z.coerce.date(), startedAt: z.coerce.date(), finishedAt: z.coerce.date(), unpaidBreakMinutes: z.number().int().min(0).max(24 * 60).default(0), ordinaryMinutes: z.number().int().min(0).max(24 * 60), overtimeMinutes: z.number().int().min(0).max(24 * 60).default(0), allowanceCodes: z.array(z.string().min(1).max(50)).max(20).default([]), notes: z.string().max(2000).optional() }).refine(v => v.finishedAt > v.startedAt, "finish must be after start");
const createTimesheetBody = z.object({ projectId: z.string().uuid(), workerId: z.string().uuid(), weekEnding: z.coerce.date(), entries: z.array(entry).min(1) });
const employeeSignatureBody = z.object({ signedName: z.string().min(2), signature: z.string().min(1).max(500_000), signatureMethod: z.enum(["DRAWN", "TYPED"]), consent: z.literal(true) });
const onsiteApproverSignatureBody = z.object({ approverUserId: z.string().uuid(), pin: z.string().regex(/^\d{4}$/), approverSignedName: z.string().min(2), approverSignature: z.string().min(1).max(500_000), approverSignatureMethod: z.enum(["DRAWN", "TYPED"]), approverConsent: z.literal(true) });
const approverRoles: Role[] = [Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER, Role.OPERATIONS_MANAGER, Role.SUPERVISOR, Role.SITE_SUPERVISOR, Role.SITE_ENGINEER, Role.FOREMAN, Role.PAYROLL];
const managerRoles: Role[] = [Role.PROJECT_MANAGER, Role.OPERATIONS_MANAGER];
const supervisorRoles: Role[] = [Role.SUPERVISOR, Role.SITE_SUPERVISOR, Role.SITE_ENGINEER, Role.FOREMAN];
const higherPrivilegeApproverRoles: Role[] = [Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER, Role.OPERATIONS_MANAGER, Role.PAYROLL];

function signingConflict(message = "This timecard has already been signed") {
  return Object.assign(new Error(message), { statusCode: 409 });
}

function isUniqueConstraint(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function eligibleApproverFilter(requesterRole: Role, requesterUserId: string) {
  if (requesterRole === Role.OWNER) return { role: { in: [Role.OWNER] }, id: requesterUserId };
  if (managerRoles.includes(requesterRole)) return { role: Role.OWNER };
  if (supervisorRoles.includes(requesterRole)) return { role: { in: higherPrivilegeApproverRoles }, id: { not: requesterUserId } };
  return { role: { in: approverRoles }, id: { not: requesterUserId } };
}

function isAllowedApproverForRequester(requesterRole: Role, requesterUserId: string, approver: { id: string; role: Role }) {
  if (requesterRole === Role.OWNER) return approver.id === requesterUserId && approver.role === Role.OWNER;
  if (managerRoles.includes(requesterRole)) return approver.role === Role.OWNER && approver.id !== requesterUserId;
  if (supervisorRoles.includes(requesterRole)) return higherPrivilegeApproverRoles.includes(approver.role) && approver.id !== requesterUserId;
  return approverRoles.includes(approver.role) && approver.id !== requesterUserId;
}

async function verifyApproverPin(app: FastifyInstance, organisationId: string, approverUserId: string, pin: string) {
  const approver = await app.prisma.user.findFirstOrThrow({ where: { id: approverUserId, organisationId, active: true, role: { in: approverRoles } } });
  if (!approver.signaturePinHash) throw Object.assign(new Error("Supervisor must create a signing PIN after logging in"), { statusCode: 409 });
  if (approver.signaturePinLockedUntil && approver.signaturePinLockedUntil > new Date()) throw Object.assign(new Error("Supervisor signing PIN is temporarily locked"), { statusCode: 429 });
  if (!(await bcrypt.compare(pin, approver.signaturePinHash))) {
    const attempts = approver.signaturePinFailedAttempts + 1;
    await app.prisma.user.update({ where: { id: approver.id }, data: { signaturePinFailedAttempts: attempts >= 5 ? 0 : attempts, signaturePinLockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null } });
    throw Object.assign(new Error("Signing PIN is incorrect"), { statusCode: 403 });
  }
  await app.prisma.user.update({ where: { id: approver.id }, data: { signaturePinFailedAttempts: 0, signaturePinLockedUntil: null } });
  return approver;
}

async function syncWorkerCurrentProject(app: FastifyInstance, organisationId: string, workerId: string, projectId: string) {
  await app.prisma.worker.updateMany({
    where: { id: workerId, organisationId, terminationDate: null, OR: [{ currentProjectId: null }, { currentProjectId: { not: projectId } }, { currentProjectAssignedAt: null }] },
    data: { currentProjectId: projectId, currentProjectAssignedAt: new Date() },
  });
}

async function syncTimesheetDailyCosts(app: FastifyInstance, organisationId: string, projectId: string, workerId: string, entries: Array<{ id: string; workDate: Date; ordinaryMinutes: number; overtimeMinutes: number; costCodeId?: string | null }>) {
  const worker = await app.prisma.worker.findFirstOrThrow({ where: { id: workerId, organisationId }, select: { id: true, firstName: true, lastName: true, baseHourlyRate: true } });
  await Promise.all(entries.map(entry => syncTimeEntryDailyCost(app, organisationId, projectId, worker, entry)));
}

function queueTimesheetDailyCosts(app: FastifyInstance, organisationId: string, projectId: string, workerId: string, entries: Array<{ id: string; workDate: Date; ordinaryMinutes: number; overtimeMinutes: number; costCodeId?: string | null }>) {
  void syncTimesheetDailyCosts(app, organisationId, projectId, workerId, entries).catch(error => {
    app.log.warn({ err: error, projectId, workerId }, "Timecard saved but daily cost draft sync failed");
  });
}

const routes: FastifyPluginAsync = async app => {
  app.get("/", { preHandler: authed }, async req => {
    const worker = await app.prisma.worker.findFirst({ where: { organisationId: req.auth.organisationId, userId: req.auth.userId }, select: { id: true } });
    if (!worker) return [];
    return app.prisma.timesheet.findMany({
      where: { workerId: worker.id, project: { organisationId: req.auth.organisationId } },
      include: { worker: true, project: true, entries: true, signatures: true, approvalRequest: true },
      orderBy: [{ weekEnding: "desc" }, { submittedAt: "desc" }, { approvedAt: "desc" }],
      take: 100,
    });
  });
  app.get("/approvers", { preHandler: authed }, req => app.prisma.user.findMany({ where: { organisationId: req.auth.organisationId, active: true, ...eligibleApproverFilter(req.auth.role, req.auth.userId) }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }));
  app.post("/verify-signing-pin", { preHandler: authed, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z.object({ approverUserId: z.string().uuid(), pin: z.string().regex(/^\d{4}$/) }).parse(req.body);
    const approver = await verifyApproverPin(app, req.auth.organisationId, body.approverUserId, body.pin);
    if (!isAllowedApproverForRequester(req.auth.role, req.auth.userId, approver)) return reply.code(403).send({ error: "Select an eligible approver for your role" });
    return { ok: true };
  });
  app.get("/pending-approvals", { preHandler: allow(...approverRoles) }, async req => app.prisma.timesheet.findMany({
    where: { status: Status.SUBMITTED, project: { organisationId: req.auth.organisationId }, approvalRequest: { approverUserId: req.auth.userId, status: ApprovalRequestStatus.PENDING } },
    include: { worker: true, project: true, entries: true, signatures: true, approvalRequest: true },
    orderBy: [{ submittedAt: "asc" }, { weekEnding: "asc" }],
    take: 100,
  }));
  app.get("/:id", { preHandler: authed }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const timesheet = await app.prisma.timesheet.findFirstOrThrow({
      where: {
        id,
        project: { organisationId: req.auth.organisationId },
        OR: [
          { worker: { userId: req.auth.userId } },
          { approvalRequest: { approverUserId: req.auth.userId } },
          { approvedById: req.auth.userId },
        ],
      },
      include: { worker: true, project: true, entries: { include: { costCode: true }, orderBy: { workDate: "asc" } }, signatures: true, approvalRequest: true },
    });
    if (!timesheet) return reply.code(404).send({ error: "Timecard not found" });
    return timesheet;
  });
  app.post("/", { preHandler: authed }, async (req, reply) => {
    const body = createTimesheetBody.parse(req.body);
    const entries = body.entries.map(e => ({ ...e, id: e.id ?? randomUUID(), costCodeId: e.costCodeId ?? null, notes: e.notes ?? null }));
    const project = await app.prisma.project.findFirstOrThrow({ where: { id: body.projectId, organisationId: req.auth.organisationId }, include: { organisation: { select: { timezone: true } } } });
    const timeIssues = validateTimesheetEntries(entries, body.weekEnding, project.organisation.timezone); if (timeIssues.length) return reply.code(400).send({ error: "Invalid timesheet entries", issues: timeIssues });
    const worker = await app.prisma.worker.findFirstOrThrow({ where: { id: body.workerId, organisationId: req.auth.organisationId } });
    if ((req.auth.role === Role.WORKER || req.auth.role === Role.SUBCONTRACTOR) && worker.userId !== req.auth.userId) return reply.code(403).send({ error: "Workers can only create their own timesheets" });
    const costCodeIds = [...new Set(entries.flatMap(e => e.costCodeId ? [e.costCodeId] : []))];
    if (costCodeIds.length && await app.prisma.costCode.count({ where: { id: { in: costCodeIds }, projectId: project.id } }) !== costCodeIds.length) return reply.code(400).send({ error: "Cost codes must belong to the selected project" });
    const timesheet = await app.prisma.timesheet.create({ data: { projectId: project.id, workerId: body.workerId, weekEnding: body.weekEnding, entries: { create: entries } }, include: { entries: true } });
    await syncWorkerCurrentProject(app, req.auth.organisationId, worker.id, project.id);
    queueTimesheetDailyCosts(app, req.auth.organisationId, project.id, worker.id, timesheet.entries);
    await audit(app, req, "CREATE", "Timesheet", timesheet.id, timesheet); return reply.code(201).send(timesheet);
  });
  app.post("/lodge", { preHandler: authed }, async (req, reply) => {
    const body = createTimesheetBody.merge(employeeSignatureBody).extend({ approverUserId: z.string().uuid().optional() }).parse(req.body);
    const entries = body.entries.map(e => ({ ...e, id: e.id ?? randomUUID(), costCodeId: e.costCodeId ?? null, notes: e.notes ?? null }));
    const project = await app.prisma.project.findFirstOrThrow({ where: { id: body.projectId, organisationId: req.auth.organisationId }, include: { organisation: { select: { timezone: true } } } });
    const timeIssues = validateTimesheetEntries(entries, body.weekEnding, project.organisation.timezone); if (timeIssues.length) return reply.code(400).send({ error: "Invalid timesheet entries", issues: timeIssues });
    const worker = await app.prisma.worker.findFirstOrThrow({ where: { id: body.workerId, organisationId: req.auth.organisationId } });
    if ((req.auth.role === Role.WORKER || req.auth.role === Role.SUBCONTRACTOR) && worker.userId !== req.auth.userId) return reply.code(403).send({ error: "Workers can only lodge their own timesheets" });
    const approver = body.approverUserId ? await app.prisma.user.findFirstOrThrow({ where: { id: body.approverUserId, organisationId: req.auth.organisationId, active: true, role: { in: approverRoles } } }) : null;
    if (!approver) return reply.code(400).send({ error: "Select the supervisor who will sign this timecard" });
    if (!isAllowedApproverForRequester(req.auth.role, req.auth.userId, approver)) return reply.code(403).send({ error: "Select an eligible approver for your role" });
    const costCodeIds = [...new Set(entries.flatMap(e => e.costCodeId ? [e.costCodeId] : []))];
    if (costCodeIds.length && await app.prisma.costCode.count({ where: { id: { in: costCodeIds }, projectId: project.id } }) !== costCodeIds.length) return reply.code(400).send({ error: "Cost codes must belong to the selected project" });
    const signer = await app.prisma.user.findUniqueOrThrow({ where: { id: req.auth.userId } });
    const created = await app.prisma.timesheet.create({ data: { projectId: project.id, workerId: body.workerId, weekEnding: body.weekEnding, entries: { create: entries } }, include: { entries: true } });
    await syncWorkerCurrentProject(app, req.auth.organisationId, worker.id, project.id);
    queueTimesheetDailyCosts(app, req.auth.organisationId, project.id, worker.id, created.entries);
    const contentHash = timesheetContentHash(created);
    try {
      await app.prisma.timesheetSignature.create({ data: { timesheetId: created.id, signerUserId: req.auth.userId, type: TimesheetSignatureType.EMPLOYEE, signedName: signer.name, signature: body.signature, signatureMethod: body.signatureMethod, timesheetContentHash: contentHash, consentText: "I confirm this timecard is a complete and accurate record of the hours I worked.", ipAddress: req.ip, userAgent: req.headers["user-agent"] } });
    } catch (error) {
      if (isUniqueConstraint(error)) throw signingConflict();
      throw error;
    }
    const lodged = await app.prisma.timesheet.update({ where: { id: created.id }, data: { status: Status.SUBMITTED, submittedAt: new Date(), contentHash }, include: { signatures: true, approvalRequest: true, entries: true } });
    await app.prisma.timesheetApprovalRequest.create({ data: { timesheetId: created.id, approverUserId: approver.id, requestedByUserId: req.auth.userId } });
    await app.prisma.notification.create({ data: { userId: approver.id, type: "TIMESHEET_APPROVAL_REQUESTED", title: "Timecard awaiting your signature", body: `${signer.name} submitted a timecard for approval.`, entityType: "Timesheet", entityId: created.id } });
    await app.prisma.auditEvent.create({ data: auditData(req, "LODGE", "Timesheet", created.id, { status: Status.SUBMITTED, contentHash, approverUserId: approver.id }) });
    return reply.code(201).send(lodged);
  });
  app.post("/lodge-onsite-approve", { preHandler: authed, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = createTimesheetBody.merge(employeeSignatureBody).merge(onsiteApproverSignatureBody).parse(req.body);
    const entries = body.entries.map(e => ({ ...e, id: e.id ?? randomUUID(), costCodeId: e.costCodeId ?? null, notes: e.notes ?? null }));
    const project = await app.prisma.project.findFirstOrThrow({ where: { id: body.projectId, organisationId: req.auth.organisationId }, include: { organisation: { select: { timezone: true } } } });
    const timeIssues = validateTimesheetEntries(entries, body.weekEnding, project.organisation.timezone); if (timeIssues.length) return reply.code(400).send({ error: "Invalid timesheet entries", issues: timeIssues });
    const worker = await app.prisma.worker.findFirstOrThrow({ where: { id: body.workerId, organisationId: req.auth.organisationId } });
    if ((req.auth.role === Role.WORKER || req.auth.role === Role.SUBCONTRACTOR) && worker.userId !== req.auth.userId) return reply.code(403).send({ error: "Workers can only lodge their own timesheets" });
    const approver = await verifyApproverPin(app, req.auth.organisationId, body.approverUserId, body.pin);
    if (!isAllowedApproverForRequester(req.auth.role, req.auth.userId, approver)) return reply.code(403).send({ error: "Select an eligible approver for your role" });
    const costCodeIds = [...new Set(entries.flatMap(e => e.costCodeId ? [e.costCodeId] : []))];
    if (costCodeIds.length && await app.prisma.costCode.count({ where: { id: { in: costCodeIds }, projectId: project.id } }) !== costCodeIds.length) return reply.code(400).send({ error: "Cost codes must belong to the selected project" });
    const signer = await app.prisma.user.findUniqueOrThrow({ where: { id: req.auth.userId } });
    const created = await app.prisma.timesheet.create({ data: { projectId: project.id, workerId: body.workerId, weekEnding: body.weekEnding, entries: { create: entries } }, include: { entries: true } });
    await syncWorkerCurrentProject(app, req.auth.organisationId, worker.id, project.id);
    queueTimesheetDailyCosts(app, req.auth.organisationId, project.id, worker.id, created.entries);
    const contentHash = timesheetContentHash(created);
    try {
      await app.prisma.timesheetSignature.create({ data: { timesheetId: created.id, signerUserId: approver.id, type: TimesheetSignatureType.APPROVER, signedName: approver.name, signature: body.approverSignature, signatureMethod: body.approverSignatureMethod, timesheetContentHash: contentHash, consentText: "I have reviewed this timecard and approve the recorded hours.", ipAddress: req.ip, userAgent: req.headers["user-agent"] } });
      await app.prisma.timesheetSignature.create({ data: { timesheetId: created.id, signerUserId: req.auth.userId, type: TimesheetSignatureType.EMPLOYEE, signedName: signer.name, signature: body.signature, signatureMethod: body.signatureMethod, timesheetContentHash: contentHash, consentText: "I confirm this timecard is a complete and accurate record of the hours I worked.", ipAddress: req.ip, userAgent: req.headers["user-agent"] } });
    } catch (error) {
      if (isUniqueConstraint(error)) throw signingConflict();
      throw error;
    }
    await app.prisma.timesheetApprovalRequest.create({ data: { timesheetId: created.id, approverUserId: approver.id, requestedByUserId: req.auth.userId, status: ApprovalRequestStatus.APPROVED, respondedAt: new Date() } });
    const approved = await app.prisma.timesheet.update({ where: { id: created.id }, data: { status: Status.APPROVED, submittedAt: new Date(), approvedAt: new Date(), approvedById: approver.id, contentHash }, include: { signatures: true, approvalRequest: true, entries: true } });
    await app.prisma.auditEvent.create({ data: { organisationId: req.auth.organisationId, actorId: approver.id, action: "ONSITE_APPROVE", entityType: "Timesheet", entityId: created.id, after: { sharedDevice: true, approvedById: approver.id, contentHash }, ipAddress: req.ip } });
    return reply.code(201).send(approved);
  });
  app.post("/:id/submit", { preHandler: authed }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = employeeSignatureBody.extend({ approverUserId: z.string().uuid().optional() }).parse(req.body);
    const existing = await app.prisma.timesheet.findFirstOrThrow({ where: { id, status: Status.DRAFT, worker: { organisationId: req.auth.organisationId, userId: req.auth.userId } }, include: { entries: true } });
    const approver = body.approverUserId ? await app.prisma.user.findFirstOrThrow({ where: { id: body.approverUserId, organisationId: req.auth.organisationId, active: true, role: { in: approverRoles } } }) : null;
    if (approver?.id === req.auth.userId && req.auth.role !== Role.OWNER) return reply.code(400).send({ error: "The employee and approver must be different users" });
    if (approver && !isAllowedApproverForRequester(req.auth.role, req.auth.userId, approver)) return reply.code(403).send({ error: "Select an eligible approver for your role" });
    const signer = await app.prisma.user.findUniqueOrThrow({ where: { id: req.auth.userId } }); const contentHash = timesheetContentHash(existing);
    try {
      await app.prisma.timesheetSignature.create({ data: { timesheetId: id, signerUserId: req.auth.userId, type: TimesheetSignatureType.EMPLOYEE, signedName: signer.name, signature: body.signature, signatureMethod: body.signatureMethod, timesheetContentHash: contentHash, consentText: "I confirm this timecard is a complete and accurate record of the hours I worked.", ipAddress: req.ip, userAgent: req.headers["user-agent"] } });
    } catch (error) {
      if (isUniqueConstraint(error)) throw signingConflict();
      throw error;
    }
    const result = await app.prisma.timesheet.update({ where: { id }, data: { status: Status.SUBMITTED, submittedAt: new Date(), contentHash, approvalRequest: approver ? { create: { approverUserId: approver.id, requestedByUserId: req.auth.userId } } : undefined }, include: { signatures: true, approvalRequest: true, entries: true } });
    await syncWorkerCurrentProject(app, req.auth.organisationId, existing.workerId, existing.projectId);
    queueTimesheetDailyCosts(app, req.auth.organisationId, existing.projectId, existing.workerId, existing.entries);
    if (approver) await app.prisma.notification.create({ data: { userId: approver.id, type: "TIMESHEET_APPROVAL_REQUESTED", title: "Timecard awaiting your signature", body: `${signer.name} submitted a timecard for approval.`, entityType: "Timesheet", entityId: id } });
    await app.prisma.auditEvent.create({ data: auditData(req, "SUBMIT", "Timesheet", id, { status: Status.SUBMITTED, contentHash, approverUserId: approver?.id ?? null }) });
    return result;
  });
  app.post("/:id/submit-onsite-approve", { preHandler: authed, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = employeeSignatureBody.merge(onsiteApproverSignatureBody).parse(req.body);
    const existing = await app.prisma.timesheet.findFirstOrThrow({ where: { id, status: Status.DRAFT, worker: { organisationId: req.auth.organisationId, userId: req.auth.userId } }, include: { entries: true } });
    const approver = await verifyApproverPin(app, req.auth.organisationId, body.approverUserId, body.pin);
    if (!isAllowedApproverForRequester(req.auth.role, req.auth.userId, approver)) return reply.code(403).send({ error: "Select an eligible approver for your role" });
    const signer = await app.prisma.user.findUniqueOrThrow({ where: { id: req.auth.userId } });
    const contentHash = timesheetContentHash(existing);
    try {
      await app.prisma.timesheetSignature.create({ data: { timesheetId: id, signerUserId: approver.id, type: TimesheetSignatureType.APPROVER, signedName: approver.name, signature: body.approverSignature, signatureMethod: body.approverSignatureMethod, timesheetContentHash: contentHash, consentText: "I have reviewed this timecard and approve the recorded hours.", ipAddress: req.ip, userAgent: req.headers["user-agent"] } });
      await app.prisma.timesheetSignature.create({ data: { timesheetId: id, signerUserId: req.auth.userId, type: TimesheetSignatureType.EMPLOYEE, signedName: signer.name, signature: body.signature, signatureMethod: body.signatureMethod, timesheetContentHash: contentHash, consentText: "I confirm this timecard is a complete and accurate record of the hours I worked.", ipAddress: req.ip, userAgent: req.headers["user-agent"] } });
    } catch (error) {
      if (isUniqueConstraint(error)) return reply.code(409).send({ error: "This timecard has already been signed" });
      throw error;
    }
    await app.prisma.timesheetApprovalRequest.upsert({ where: { timesheetId: id }, update: { status: ApprovalRequestStatus.APPROVED, approverUserId: approver.id, respondedAt: new Date() }, create: { timesheetId: id, approverUserId: approver.id, requestedByUserId: req.auth.userId, status: ApprovalRequestStatus.APPROVED, respondedAt: new Date() } });
    const result = await app.prisma.timesheet.update({ where: { id }, data: { status: Status.APPROVED, submittedAt: new Date(), approvedAt: new Date(), approvedById: approver.id, contentHash }, include: { signatures: true, approvalRequest: true, entries: true } });
    await syncWorkerCurrentProject(app, req.auth.organisationId, existing.workerId, existing.projectId);
    queueTimesheetDailyCosts(app, req.auth.organisationId, existing.projectId, existing.workerId, existing.entries);
    await app.prisma.auditEvent.create({ data: { organisationId: req.auth.organisationId, actorId: approver.id, action: "ONSITE_APPROVE", entityType: "Timesheet", entityId: id, after: { sharedDevice: true, approvedById: approver.id, contentHash }, ipAddress: req.ip } });
    return result;
  });
  app.post("/:id/request-approval", { preHandler: authed }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ approverUserId: z.string().uuid() }).parse(req.body);
    const existing = await app.prisma.timesheet.findFirstOrThrow({ where: { id, status: Status.SUBMITTED, worker: { organisationId: req.auth.organisationId, userId: req.auth.userId }, signatures: { some: { type: TimesheetSignatureType.EMPLOYEE } } }, include: { worker: true, approvalRequest: true } });
    if (existing.approvalRequest?.status === ApprovalRequestStatus.PENDING) return reply.code(409).send({ error: "This timecard already has a pending approval request" });
    const approver = await app.prisma.user.findFirstOrThrow({ where: { id: body.approverUserId, organisationId: req.auth.organisationId, active: true, role: { in: approverRoles } } });
    if (!isAllowedApproverForRequester(req.auth.role, req.auth.userId, approver)) return reply.code(403).send({ error: "Select an eligible approver for your role" });
    const request = await app.prisma.$transaction(async tx => {
      const approvalRequest = existing.approvalRequest
        ? await tx.timesheetApprovalRequest.update({ where: { timesheetId: id }, data: { approverUserId: approver.id, requestedByUserId: req.auth.userId, status: ApprovalRequestStatus.PENDING, requestedAt: new Date(), respondedAt: null, rejectionReason: null } })
        : await tx.timesheetApprovalRequest.create({ data: { timesheetId: id, approverUserId: approver.id, requestedByUserId: req.auth.userId } });
      await tx.notification.create({ data: { userId: approver.id, type: "TIMESHEET_APPROVAL_REQUESTED", title: "Timecard awaiting your signature", body: `${existing.worker.firstName} ${existing.worker.lastName} requested approval on a timecard.`, entityType: "Timesheet", entityId: id } });
      await tx.auditEvent.create({ data: auditData(req, "REQUEST_APPROVAL", "Timesheet", id, { approverUserId: approver.id }) });
      return approvalRequest;
    });
    return reply.code(201).send(request);
  });
  app.post("/:id/approve", { preHandler: allow(...approverRoles) }, async req => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ signedName: z.string().min(2), signature: z.string().min(1).max(500_000), signatureMethod: z.enum(["DRAWN", "TYPED"]), consent: z.literal(true) }).parse(req.body);
    const existing = await app.prisma.timesheet.findFirstOrThrow({ where: { id, status: Status.SUBMITTED, project: { organisationId: req.auth.organisationId }, approvalRequest: { approverUserId: req.auth.userId, status: ApprovalRequestStatus.PENDING } }, include: { entries: true } });
    const signer = await app.prisma.user.findUniqueOrThrow({ where: { id: req.auth.userId } }); const currentHash = timesheetContentHash(existing);
    if (!existing.contentHash || currentHash !== existing.contentHash) throw Object.assign(new Error("Timecard contents changed after the employee signed it"), { statusCode: 409 });
    try {
      await app.prisma.timesheetSignature.create({ data: { timesheetId: id, signerUserId: req.auth.userId, type: TimesheetSignatureType.APPROVER, signedName: signer.name, signature: body.signature, signatureMethod: body.signatureMethod, timesheetContentHash: currentHash, consentText: "I have reviewed this timecard and approve the recorded hours.", ipAddress: req.ip, userAgent: req.headers["user-agent"] } });
    } catch (error) {
      if (isUniqueConstraint(error)) throw signingConflict("This timecard has already been approved");
      throw error;
    }
    const result = await app.prisma.timesheet.update({ where: { id: existing.id }, data: { status: Status.APPROVED, approvedAt: new Date(), approvedById: req.auth.userId, approvalRequest: { update: { status: ApprovalRequestStatus.APPROVED, respondedAt: new Date() } } }, include: { signatures: true, approvalRequest: true } });
    await syncWorkerCurrentProject(app, req.auth.organisationId, existing.workerId, existing.projectId);
    await app.prisma.auditEvent.create({ data: auditData(req, "APPROVE", "Timesheet", id, { status: Status.APPROVED, approvedById: req.auth.userId, contentHash: currentHash }) });
    return result;
  });
  app.post("/:id/onsite-approve", { preHandler: authed, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ approverUserId: z.string().uuid(), pin: z.string().regex(/^\d{4}$/), signedName: z.string().min(2), signature: z.string().min(1).max(500_000), signatureMethod: z.enum(["DRAWN", "TYPED"]), consent: z.literal(true) }).parse(req.body);
    const approver = await app.prisma.user.findFirstOrThrow({ where: { id: body.approverUserId, organisationId: req.auth.organisationId, active: true, role: { in: approverRoles } } });
    if (!approver.signaturePinHash) return reply.code(409).send({ error: "Supervisor must create a signing PIN after logging in" });
    if (approver.signaturePinLockedUntil && approver.signaturePinLockedUntil > new Date()) return reply.code(429).send({ error: "Supervisor signing PIN is temporarily locked" });
    if (!(await bcrypt.compare(body.pin, approver.signaturePinHash))) {
      const attempts = approver.signaturePinFailedAttempts + 1; await app.prisma.user.update({ where: { id: approver.id }, data: { signaturePinFailedAttempts: attempts >= 5 ? 0 : attempts, signaturePinLockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null } });
      return reply.code(403).send({ error: "Supervisor verification failed" });
    }
    await app.prisma.user.update({ where: { id: approver.id }, data: { signaturePinFailedAttempts: 0, signaturePinLockedUntil: null } });
    const existing = await app.prisma.timesheet.findFirstOrThrow({ where: { id, status: Status.SUBMITTED, worker: { userId: req.auth.userId, organisationId: req.auth.organisationId } }, include: { entries: true, approvalRequest: true } });
    const currentHash = timesheetContentHash(existing);
    if (!existing.contentHash || currentHash !== existing.contentHash) return reply.code(409).send({ error: "Timecard contents changed after the employee signed it" });
    try {
      await app.prisma.timesheetSignature.create({ data: { timesheetId: id, signerUserId: approver.id, type: TimesheetSignatureType.APPROVER, signedName: approver.name, signature: body.signature, signatureMethod: body.signatureMethod, timesheetContentHash: currentHash, consentText: "I have reviewed this timecard and approve the recorded hours.", ipAddress: req.ip, userAgent: req.headers["user-agent"] } });
    } catch (error) {
      if (isUniqueConstraint(error)) return reply.code(409).send({ error: "This timecard has already been approved" });
      throw error;
    }
    await app.prisma.timesheetApprovalRequest.upsert({ where: { timesheetId: id }, update: { status: ApprovalRequestStatus.APPROVED, approverUserId: approver.id, respondedAt: new Date() }, create: { timesheetId: id, approverUserId: approver.id, requestedByUserId: req.auth.userId, status: ApprovalRequestStatus.APPROVED, respondedAt: new Date() } });
    const result = await app.prisma.timesheet.update({ where: { id }, data: { status: Status.APPROVED, approvedAt: new Date(), approvedById: approver.id }, include: { signatures: true, approvalRequest: true } });
    await syncWorkerCurrentProject(app, req.auth.organisationId, existing.workerId, existing.projectId);
    await app.prisma.notification.updateMany({ where: { userId: approver.id, entityType: "Timesheet", entityId: id, readAt: null }, data: { readAt: new Date() } });
    await app.prisma.auditEvent.create({ data: { organisationId: req.auth.organisationId, actorId: approver.id, action: "ONSITE_APPROVE", entityType: "Timesheet", entityId: id, after: { sharedDevice: true, approvedById: approver.id }, ipAddress: req.ip } });
    return result;
  });
  app.post("/:id/reject", { preHandler: allow(...approverRoles) }, async req => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params); const { reason } = z.object({ reason: z.string().min(3) }).parse(req.body);
    const existing = await app.prisma.timesheet.findFirstOrThrow({ where: { id, status: Status.SUBMITTED, project: { organisationId: req.auth.organisationId }, approvalRequest: { approverUserId: req.auth.userId, status: ApprovalRequestStatus.PENDING } } });
    const [result] = await app.prisma.$transaction([
      app.prisma.timesheet.update({ where: { id: existing.id }, data: { status: Status.REJECTED, correctionReason: reason, approvalRequest: { update: { status: ApprovalRequestStatus.REJECTED, rejectionReason: reason, respondedAt: new Date() } } } }),
      app.prisma.auditEvent.create({ data: auditData(req, "REJECT", "Timesheet", id, { status: Status.REJECTED }, reason) }),
    ]); return result;
  });
  app.post("/:id/correct", { preHandler: authed }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const original = await app.prisma.timesheet.findFirstOrThrow({ where: { id, status: Status.REJECTED, worker: { organisationId: req.auth.organisationId, userId: req.auth.userId } }, include: { entries: true, corrections: { orderBy: { revision: "desc" }, take: 1 } } });
    if (original.corrections.length) return reply.code(409).send({ error: "A correction already exists", timesheetId: original.corrections[0]!.id });
    const corrected = await app.prisma.timesheet.create({ data: { projectId: original.projectId, workerId: original.workerId, weekEnding: original.weekEnding, revision: original.revision + 1, parentTimesheetId: original.id, correctionReason: original.correctionReason, entries: { create: original.entries.map(e => ({ costCodeId: e.costCodeId, workDate: e.workDate, startedAt: e.startedAt, finishedAt: e.finishedAt, unpaidBreakMinutes: e.unpaidBreakMinutes, ordinaryMinutes: e.ordinaryMinutes, overtimeMinutes: e.overtimeMinutes, allowanceCodes: e.allowanceCodes, notes: e.notes })) } }, include: { entries: true } });
    await syncWorkerCurrentProject(app, req.auth.organisationId, original.workerId, original.projectId);
    queueTimesheetDailyCosts(app, req.auth.organisationId, original.projectId, original.workerId, corrected.entries);
    await audit(app, req, "CORRECT", "Timesheet", corrected.id, { parentTimesheetId: original.id, revision: corrected.revision }); return reply.code(201).send(corrected);
  });
};
export default routes;
