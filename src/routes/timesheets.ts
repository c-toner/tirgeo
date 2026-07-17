import type { FastifyPluginAsync } from "fastify";
import { ApprovalRequestStatus, Role, Status, TimesheetSignatureType } from "@prisma/client";
import { z } from "zod";
import { allow, authed } from "../lib/access.js";
import { audit, auditData } from "../lib/audit.js";
import { timesheetContentHash, validateTimesheetEntries } from "../lib/timesheet.js";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";

const entry = z.object({ id: z.string().uuid().optional(), costCodeId: z.string().uuid().optional(), workDate: z.coerce.date(), startedAt: z.coerce.date(), finishedAt: z.coerce.date(), unpaidBreakMinutes: z.number().int().min(0).max(24 * 60).default(0), ordinaryMinutes: z.number().int().min(0).max(24 * 60), overtimeMinutes: z.number().int().min(0).max(24 * 60).default(0), allowanceCodes: z.array(z.string().min(1).max(50)).max(20).default([]), notes: z.string().max(2000).optional() }).refine(v => v.finishedAt > v.startedAt, "finish must be after start");
const routes: FastifyPluginAsync = async app => {
  app.get("/approvers", { preHandler: authed }, req => app.prisma.user.findMany({ where: { organisationId: req.auth.organisationId, active: true, id: { not: req.auth.userId }, role: { in: [Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER, Role.SUPERVISOR, Role.SITE_SUPERVISOR, Role.FOREMAN] } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }));
  app.post("/", { preHandler: authed }, async (req, reply) => {
    const body = z.object({ projectId: z.string().uuid(), workerId: z.string().uuid(), weekEnding: z.coerce.date(), entries: z.array(entry).min(1) }).parse(req.body);
    const entries = body.entries.map(e => ({ ...e, id: e.id ?? randomUUID(), costCodeId: e.costCodeId ?? null, notes: e.notes ?? null }));
    const project = await app.prisma.project.findFirstOrThrow({ where: { id: body.projectId, organisationId: req.auth.organisationId }, include: { organisation: { select: { timezone: true } } } });
    const timeIssues = validateTimesheetEntries(entries, body.weekEnding, project.organisation.timezone); if (timeIssues.length) return reply.code(400).send({ error: "Invalid timesheet entries", issues: timeIssues });
    const worker = await app.prisma.worker.findFirstOrThrow({ where: { id: body.workerId, organisationId: req.auth.organisationId } });
    if ((req.auth.role === Role.WORKER || req.auth.role === Role.SUBCONTRACTOR) && worker.userId !== req.auth.userId) return reply.code(403).send({ error: "Workers can only create their own timesheets" });
    const costCodeIds = [...new Set(entries.flatMap(e => e.costCodeId ? [e.costCodeId] : []))];
    if (costCodeIds.length && await app.prisma.costCode.count({ where: { id: { in: costCodeIds }, projectId: project.id } }) !== costCodeIds.length) return reply.code(400).send({ error: "Cost codes must belong to the selected project" });
    const timesheet = await app.prisma.timesheet.create({ data: { projectId: project.id, workerId: body.workerId, weekEnding: body.weekEnding, entries: { create: entries } }, include: { entries: true } });
    await audit(app, req, "CREATE", "Timesheet", timesheet.id, timesheet); return reply.code(201).send(timesheet);
  });
  app.post("/:id/submit", { preHandler: authed }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ approverUserId: z.string().uuid(), signedName: z.string().min(2), signature: z.string().min(1).max(500_000), signatureMethod: z.enum(["DRAWN", "TYPED"]), consent: z.literal(true) }).parse(req.body);
    const existing = await app.prisma.timesheet.findFirstOrThrow({ where: { id, status: Status.DRAFT, worker: { organisationId: req.auth.organisationId, userId: req.auth.userId } }, include: { entries: true } });
    const approver = await app.prisma.user.findFirstOrThrow({ where: { id: body.approverUserId, organisationId: req.auth.organisationId, active: true, role: { in: [Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER, Role.SUPERVISOR, Role.SITE_SUPERVISOR, Role.FOREMAN] } } });
    if (approver.id === req.auth.userId) return reply.code(400).send({ error: "The employee and approver must be different users" });
    const signer = await app.prisma.user.findUniqueOrThrow({ where: { id: req.auth.userId } }); const contentHash = timesheetContentHash(existing);
    const [, result] = await app.prisma.$transaction([
      app.prisma.timesheetSignature.create({ data: { timesheetId: id, signerUserId: req.auth.userId, type: TimesheetSignatureType.EMPLOYEE, signedName: signer.name, signature: body.signature, signatureMethod: body.signatureMethod, timesheetContentHash: contentHash, consentText: "I confirm this timecard is a complete and accurate record of the hours I worked.", ipAddress: req.ip, userAgent: req.headers["user-agent"] } }),
      app.prisma.timesheet.update({ where: { id }, data: { status: Status.SUBMITTED, submittedAt: new Date(), contentHash, approvalRequest: { create: { approverUserId: approver.id, requestedByUserId: req.auth.userId } } }, include: { signatures: true, approvalRequest: true } }),
      app.prisma.notification.create({ data: { userId: approver.id, type: "TIMESHEET_APPROVAL_REQUESTED", title: "Timecard awaiting your signature", body: `${signer.name} submitted a timecard for approval.`, entityType: "Timesheet", entityId: id } }),
      app.prisma.auditEvent.create({ data: auditData(req, "SUBMIT", "Timesheet", id, { status: Status.SUBMITTED, contentHash, approverUserId: approver.id }) }),
    ]);
    return result;
  });
  app.post("/:id/approve", { preHandler: allow(Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER, Role.SUPERVISOR, Role.SITE_SUPERVISOR, Role.FOREMAN) }, async req => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ signedName: z.string().min(2), signature: z.string().min(1).max(500_000), signatureMethod: z.enum(["DRAWN", "TYPED"]), consent: z.literal(true) }).parse(req.body);
    const existing = await app.prisma.timesheet.findFirstOrThrow({ where: { id, status: Status.SUBMITTED, project: { organisationId: req.auth.organisationId }, approvalRequest: { approverUserId: req.auth.userId, status: ApprovalRequestStatus.PENDING } }, include: { entries: true } });
    const signer = await app.prisma.user.findUniqueOrThrow({ where: { id: req.auth.userId } }); const currentHash = timesheetContentHash(existing);
    if (!existing.contentHash || currentHash !== existing.contentHash) throw Object.assign(new Error("Timecard contents changed after the employee signed it"), { statusCode: 409 });
    const [, result] = await app.prisma.$transaction([
      app.prisma.timesheetSignature.create({ data: { timesheetId: id, signerUserId: req.auth.userId, type: TimesheetSignatureType.APPROVER, signedName: signer.name, signature: body.signature, signatureMethod: body.signatureMethod, timesheetContentHash: currentHash, consentText: "I have reviewed this timecard and approve the recorded hours.", ipAddress: req.ip, userAgent: req.headers["user-agent"] } }),
      app.prisma.timesheet.update({ where: { id: existing.id }, data: { status: Status.APPROVED, approvedAt: new Date(), approvedById: req.auth.userId, approvalRequest: { update: { status: ApprovalRequestStatus.APPROVED, respondedAt: new Date() } } }, include: { signatures: true, approvalRequest: true } }),
      app.prisma.auditEvent.create({ data: auditData(req, "APPROVE", "Timesheet", id, { status: Status.APPROVED, approvedById: req.auth.userId, contentHash: currentHash }) }),
    ]);
    return result;
  });
  app.post("/:id/onsite-approve", { preHandler: authed, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ approverUserId: z.string().uuid(), pin: z.string().regex(/^\d{4}$/), signedName: z.string().min(2), signature: z.string().min(1).max(500_000), signatureMethod: z.enum(["DRAWN", "TYPED"]), consent: z.literal(true) }).parse(req.body);
    const approver = await app.prisma.user.findFirstOrThrow({ where: { id: body.approverUserId, organisationId: req.auth.organisationId, active: true, role: { in: [Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER, Role.SUPERVISOR, Role.SITE_SUPERVISOR, Role.FOREMAN] } } });
    if (!approver.signaturePinHash) return reply.code(409).send({ error: "Supervisor must create a signing PIN after logging in" });
    if (approver.signaturePinLockedUntil && approver.signaturePinLockedUntil > new Date()) return reply.code(429).send({ error: "Supervisor signing PIN is temporarily locked" });
    if (!(await bcrypt.compare(body.pin, approver.signaturePinHash))) {
      const attempts = approver.signaturePinFailedAttempts + 1; await app.prisma.user.update({ where: { id: approver.id }, data: { signaturePinFailedAttempts: attempts >= 5 ? 0 : attempts, signaturePinLockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null } });
      return reply.code(401).send({ error: "Supervisor verification failed" });
    }
    await app.prisma.user.update({ where: { id: approver.id }, data: { signaturePinFailedAttempts: 0, signaturePinLockedUntil: null } });
    const existing = await app.prisma.timesheet.findFirstOrThrow({ where: { id, status: Status.SUBMITTED, worker: { userId: req.auth.userId, organisationId: req.auth.organisationId }, approvalRequest: { approverUserId: approver.id, status: ApprovalRequestStatus.PENDING } }, include: { entries: true } });
    const currentHash = timesheetContentHash(existing);
    if (!existing.contentHash || currentHash !== existing.contentHash) return reply.code(409).send({ error: "Timecard contents changed after the employee signed it" });
    const [, result] = await app.prisma.$transaction([
      app.prisma.timesheetSignature.create({ data: { timesheetId: id, signerUserId: approver.id, type: TimesheetSignatureType.APPROVER, signedName: approver.name, signature: body.signature, signatureMethod: body.signatureMethod, timesheetContentHash: currentHash, consentText: "I have reviewed this timecard and approve the recorded hours.", ipAddress: req.ip, userAgent: req.headers["user-agent"] } }),
      app.prisma.timesheet.update({ where: { id }, data: { status: Status.APPROVED, approvedAt: new Date(), approvedById: approver.id, approvalRequest: { update: { status: ApprovalRequestStatus.APPROVED, respondedAt: new Date() } } }, include: { signatures: true, approvalRequest: true } }),
      app.prisma.notification.updateMany({ where: { userId: approver.id, entityType: "Timesheet", entityId: id, readAt: null }, data: { readAt: new Date() } }),
      app.prisma.auditEvent.create({ data: { organisationId: req.auth.organisationId, actorId: approver.id, action: "ONSITE_APPROVE", entityType: "Timesheet", entityId: id, after: { sharedDevice: true, approvedById: approver.id }, ipAddress: req.ip } }),
    ]);
    return result;
  });
  app.post("/:id/reject", { preHandler: allow(Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER, Role.SUPERVISOR, Role.SITE_SUPERVISOR, Role.FOREMAN) }, async req => {
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
    await audit(app, req, "CORRECT", "Timesheet", corrected.id, { parentTimesheetId: original.id, revision: corrected.revision }); return reply.code(201).send(corrected);
  });
};
export default routes;
