import type { FastifyPluginAsync } from "fastify";
import { AccountingProvider, PayrollExportStatus, Role, Status } from "@prisma/client";
import { z } from "zod";
import { allow } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { buildProviderPayload, canTransitionPayrollExport } from "../lib/payroll.js";

const payrollManagers = allow(Role.OWNER, Role.ADMIN, Role.PAYROLL);

const routes: FastifyPluginAsync = async app => {
  app.put("/connections/:provider", { preHandler: payrollManagers }, async (req, reply) => {
    const { provider } = z.object({ provider: z.nativeEnum(AccountingProvider) }).parse(req.params);
    const body = z.object({ externalTenantId: z.string().min(1), displayName: z.string().optional(), settings: z.record(z.any()).optional() }).parse(req.body);
    const connection = await app.prisma.accountingConnection.upsert({
      where: { organisationId_provider: { organisationId: req.auth.organisationId, provider } },
      create: { ...body, provider, organisationId: req.auth.organisationId, status: "CONFIGURED" },
      update: { ...body, status: "CONFIGURED", connectedAt: null },
    });
    await audit(app, req, "CONFIGURE", "AccountingConnection", connection.id, connection);
    return reply.code(201).send(connection);
  });

  app.put("/connections/:provider/employees/:workerId", { preHandler: payrollManagers }, async req => {
    const p = z.object({ provider: z.nativeEnum(AccountingProvider), workerId: z.string().uuid() }).parse(req.params);
    const { externalEmployeeId } = z.object({ externalEmployeeId: z.string().min(1) }).parse(req.body);
    const connection = await app.prisma.accountingConnection.findUniqueOrThrow({ where: { organisationId_provider: { organisationId: req.auth.organisationId, provider: p.provider } } });
    await app.prisma.worker.findFirstOrThrow({ where: { id: p.workerId, organisationId: req.auth.organisationId } });
    return app.prisma.payrollEmployeeMapping.upsert({ where: { connectionId_workerId: { connectionId: connection.id, workerId: p.workerId } }, create: { connectionId: connection.id, workerId: p.workerId, externalEmployeeId }, update: { externalEmployeeId } });
  });

  app.put("/connections/:provider/pay-items/:localCode", { preHandler: payrollManagers }, async req => {
    const p = z.object({ provider: z.nativeEnum(AccountingProvider), localCode: z.string().min(1).max(80) }).parse(req.params);
    const { externalPayItemId } = z.object({ externalPayItemId: z.string().min(1).max(200) }).parse(req.body);
    const connection = await app.prisma.accountingConnection.findUniqueOrThrow({ where: { organisationId_provider: { organisationId: req.auth.organisationId, provider: p.provider } } });
    return app.prisma.payrollPayItemMapping.upsert({ where: { connectionId_localCode: { connectionId: connection.id, localCode: p.localCode } }, create: { connectionId: connection.id, localCode: p.localCode, externalPayItemId }, update: { externalPayItemId } });
  });

  app.post("/exports", { preHandler: payrollManagers }, async (req, reply) => {
    const body = z.object({ provider: z.nativeEnum(AccountingProvider), periodStart: z.coerce.date(), periodEnd: z.coerce.date(), timesheetIds: z.array(z.string().uuid()).min(1) }).refine(v => v.periodEnd >= v.periodStart, "periodEnd must be on or after periodStart").parse(req.body);
    const payrollExport = await app.prisma.$transaction(async tx => {
      const connection = await tx.accountingConnection.findUniqueOrThrow({ where: { organisationId_provider: { organisationId: req.auth.organisationId, provider: body.provider } } });
      const timesheets = await tx.timesheet.findMany({ where: { id: { in: body.timesheetIds }, status: Status.APPROVED, payrollExportItems: { none: { payrollExport: { status: { not: PayrollExportStatus.FAILED } } } }, project: { organisationId: req.auth.organisationId } }, include: { worker: { include: { payrollMappings: { where: { connectionId: connection.id } } } }, entries: { include: { costCode: true } } } });
      if (timesheets.length !== new Set(body.timesheetIds).size) throw Object.assign(new Error("Every timesheet must belong to this organisation, be approved, and not already be in an active export"), { statusCode: 409 });
      if (timesheets.some(t => t.weekEnding < body.periodStart || t.weekEnding > body.periodEnd)) throw Object.assign(new Error("Every timesheet week ending must fall within the export period"), { statusCode: 400 });
      const missing = timesheets.filter(t => !t.worker.payrollMappings[0]);
      if (missing.length) throw Object.assign(new Error(`Workers require payroll mappings: ${missing.map(t => t.workerId).join(", ")}`), { statusCode: 422 });
      const payload = buildProviderPayload(body.provider, timesheets.map(t => ({ localTimesheetId: t.id, externalEmployeeId: t.worker.payrollMappings[0]!.externalEmployeeId, periodEnd: t.weekEnding.toISOString().slice(0, 10), lines: t.entries.map(e => ({ date: e.workDate.toISOString().slice(0, 10), ordinaryHours: e.ordinaryMinutes / 60, overtimeHours: e.overtimeMinutes / 60, allowances: e.allowanceCodes, costCode: e.costCode?.code })) })));
      return tx.payrollExport.create({ data: { organisationId: req.auth.organisationId, connectionId: connection.id, periodStart: body.periodStart, periodEnd: body.periodEnd, status: PayrollExportStatus.READY, payload, createdById: req.auth.userId, items: { create: timesheets.map(t => ({ timesheetId: t.id })) } }, include: { items: true } });
    }, { isolationLevel: "Serializable" });
    await audit(app, req, "CREATE", "PayrollExport", payrollExport.id, payrollExport);
    return reply.code(201).send(payrollExport);
  });

  app.patch("/exports/:id/status", { preHandler: payrollManagers }, async req => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ status: z.enum(["SENT", "RECONCILED", "FAILED"]), externalReference: z.string().optional(), failureReason: z.string().optional() }).superRefine((v, ctx) => { if (["SENT", "RECONCILED"].includes(v.status) && !v.externalReference) ctx.addIssue({ code: "custom", message: "externalReference is required" }); if (v.status === "FAILED" && !v.failureReason) ctx.addIssue({ code: "custom", message: "failureReason is required" }); }).parse(req.body);
    const current = await app.prisma.payrollExport.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId } });
    if (!canTransitionPayrollExport(current.status, body.status)) throw Object.assign(new Error(`Cannot move payroll export from ${current.status} to ${body.status}`), { statusCode: 409 });
    const result = await app.prisma.payrollExport.update({ where: { id }, data: { ...body, sentAt: body.status === "SENT" ? new Date() : undefined, reconciledAt: body.status === "RECONCILED" ? new Date() : undefined } });
    await audit(app, req, body.status, "PayrollExport", id, result, body.failureReason); return result;
  });
};

export default routes;
