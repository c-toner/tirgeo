import type { FastifyPluginAsync } from "fastify";
import { AccountSection, DocketRateBasis, DocketType, Role, Status } from "@prisma/client";
import { z } from "zod";
import { allow, requireOrganisationProject, requireSection } from "../lib/access.js";
import { audit } from "../lib/audit.js";

const commercialManagers = allow(Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER, Role.OPERATIONS_MANAGER);
const docketSubmitters = requireSection(AccountSection.DOCKETS);
const rateBasis = z.nativeEnum(DocketRateBasis);
const docketType = z.nativeEnum(DocketType);
const invoiceableStatuses: Status[] = [Status.SUBMITTED, Status.APPROVED];

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") return value.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function scrubDocket<T extends { lines?: Array<Record<string, unknown>>; totalAmount?: unknown; gstAmount?: unknown; currency?: unknown }>(docket: T) {
  const { totalAmount: _totalAmount, gstAmount: _gstAmount, currency: _currency, ...rest } = docket;
  return {
    ...rest,
    lines: docket.lines?.map((line) => {
      const { unitRateSnapshot: _unitRateSnapshot, lineAmount: _lineAmount, ...lineRest } = line;
      return lineRest;
    }) ?? [],
  };
}

function invoiceNumber(projectCode: string, sequence: number) {
  const safeCode = projectCode.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 24) || "PROJECT";
  return `DIN-${safeCode}-${String(sequence + 1).padStart(4, "0")}`;
}

const routes: FastifyPluginAsync = async app => {
  app.get("/rates", { preHandler: docketSubmitters }, async req => {
    const query = z.object({ projectId: z.string().uuid().optional(), docketType: docketType.optional() }).parse(req.query);
    if (query.projectId) await requireOrganisationProject(app, req, query.projectId);
    const now = new Date();
    const rates = await app.prisma.docketRate.findMany({
      where: {
        organisationId: req.auth.organisationId,
        active: true,
        docketType: query.docketType,
        OR: [{ projectId: null }, ...(query.projectId ? [{ projectId: query.projectId }] : [])],
        AND: [
          { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
        ],
      },
      orderBy: [{ projectId: "desc" }, { code: "asc" }],
      select: { id: true, projectId: true, code: true, description: true, docketType: true, basis: true, unit: true },
    });
    return rates;
  });

  app.get("/my", { preHandler: docketSubmitters }, async req => {
    const worker = await app.prisma.worker.findFirst({ where: { organisationId: req.auth.organisationId, userId: req.auth.userId }, select: { id: true } });
    if (!worker) return [];
    const dockets = await app.prisma.docket.findMany({
      where: { organisationId: req.auth.organisationId, workerId: worker.id },
      include: { project: { select: { id: true, code: true, name: true } }, lines: true },
      orderBy: { docketDate: "desc" },
      take: 50,
    });
    return dockets.map(scrubDocket);
  });

  app.post("/", { preHandler: docketSubmitters }, async (req, reply) => {
    const body = z.object({
      projectId: z.string().uuid(),
      workerId: z.string().uuid().optional(),
      docketType,
      docketDate: z.coerce.date(),
      reference: z.string().max(80).optional(),
      location: z.string().max(200).optional(),
      chainageFrom: z.number().nonnegative().optional(),
      chainageTo: z.number().nonnegative().optional(),
      description: z.string().max(2000).optional(),
      notes: z.string().max(4000).optional(),
      lines: z.array(z.object({ rateId: z.string().uuid(), quantity: z.number().positive(), notes: z.string().max(1000).optional() })).min(1).max(40),
    }).parse(req.body);
    await requireOrganisationProject(app, req, body.projectId);
    const linkedWorker = await app.prisma.worker.findFirst({ where: { organisationId: req.auth.organisationId, userId: req.auth.userId, terminationDate: null }, select: { id: true } });
    const workerId = body.workerId ?? linkedWorker?.id;
    if (!workerId) return reply.code(400).send({ error: "A linked worker is required to submit a docket" });
    if ((req.auth.role === Role.WORKER || req.auth.role === Role.SUBCONTRACTOR) && workerId !== linkedWorker?.id) return reply.code(403).send({ error: "Workers can only submit their own dockets" });
    const worker = await app.prisma.worker.findFirstOrThrow({ where: { id: workerId, organisationId: req.auth.organisationId, terminationDate: null } });
    const rateIds = [...new Set(body.lines.map(line => line.rateId))];
    const rates = await app.prisma.docketRate.findMany({
      where: {
        id: { in: rateIds },
        organisationId: req.auth.organisationId,
        docketType: body.docketType,
        active: true,
        OR: [{ projectId: null }, { projectId: body.projectId }],
      },
    });
    if (rates.length !== rateIds.length) return reply.code(400).send({ error: "Every docket line must use an active rate for this project and docket type" });
    const ratesById = new Map(rates.map(rate => [rate.id, rate]));
    const lines = body.lines.map(line => {
      const rate = ratesById.get(line.rateId)!;
      const unitRate = toNumber(rate.unitRate);
      const lineAmount = Number((line.quantity * unitRate).toFixed(2));
      return {
        rateId: rate.id,
        code: rate.code,
        description: rate.description,
        basis: rate.basis,
        quantity: line.quantity,
        unit: rate.unit,
        unitRateSnapshot: unitRate,
        lineAmount,
        notes: line.notes?.trim() || undefined,
      };
    });
    const totalAmount = Number(lines.reduce((total, line) => total + line.lineAmount, 0).toFixed(2));
    const docket = await app.prisma.docket.create({
      data: {
        organisationId: req.auth.organisationId,
        projectId: body.projectId,
        workerId: worker.id,
        createdById: req.auth.userId,
        docketType: body.docketType,
        docketDate: body.docketDate,
        reference: body.reference?.trim() || undefined,
        location: body.location?.trim() || undefined,
        chainageFrom: body.chainageFrom,
        chainageTo: body.chainageTo,
        description: body.description?.trim() || undefined,
        notes: body.notes?.trim() || undefined,
        totalAmount,
        lines: { create: lines },
      },
      include: { project: { select: { id: true, code: true, name: true } }, worker: true, lines: true },
    });
    await app.prisma.worker.updateMany({
      where: { id: worker.id, organisationId: req.auth.organisationId, OR: [{ currentProjectId: null }, { currentProjectId: { not: body.projectId } }, { currentProjectAssignedAt: null }] },
      data: { currentProjectId: body.projectId, currentProjectAssignedAt: new Date() },
    });
    await audit(app, req, "CREATE", "Docket", docket.id, { docketType: docket.docketType, projectId: docket.projectId, workerId: docket.workerId, lineCount: docket.lines.length });
    return reply.code(201).send(scrubDocket(docket));
  });

  app.get("/", { preHandler: commercialManagers }, async req => {
    const query = z.object({ projectId: z.string().uuid().optional(), docketType: docketType.optional(), status: z.nativeEnum(Status).optional(), invoiced: z.coerce.boolean().optional() }).parse(req.query);
    if (query.projectId) await requireOrganisationProject(app, req, query.projectId);
    return app.prisma.docket.findMany({
      where: { organisationId: req.auth.organisationId, projectId: query.projectId, docketType: query.docketType, status: query.status, invoiceId: query.invoiced === undefined ? undefined : query.invoiced ? { not: null } : null },
      include: {
        project: { select: { id: true, code: true, name: true } },
        worker: { select: { id: true, employeeNumber: true, firstName: true, lastName: true, classification: true } },
        createdBy: { select: { id: true, name: true, role: true } },
        invoice: { select: { id: true, invoiceNumber: true, status: true } },
        lines: { orderBy: { code: "asc" } },
      },
      orderBy: { docketDate: "desc" },
      take: 200,
    });
  });

  app.get("/projects/:projectId/invoice-summary", { preHandler: commercialManagers }, async req => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(req.params);
    await requireOrganisationProject(app, req, projectId);
    const [uninvoiced, invoiced, invoices] = await Promise.all([
      app.prisma.docket.aggregate({
        where: { organisationId: req.auth.organisationId, projectId, invoiceId: null, status: { in: invoiceableStatuses } },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      app.prisma.docket.aggregate({
        where: { organisationId: req.auth.organisationId, projectId, invoiceId: { not: null } },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      app.prisma.docketInvoice.findMany({
        where: { organisationId: req.auth.organisationId, projectId },
        include: { _count: { select: { dockets: true, items: true } } },
        orderBy: { createdAt: "desc" },
        take: 12,
      }),
    ]);
    return {
      projectId,
      uninvoicedCount: uninvoiced._count._all,
      uninvoicedTotal: uninvoiced._sum.totalAmount ?? 0,
      invoicedCount: invoiced._count._all,
      invoicedTotal: invoiced._sum.totalAmount ?? 0,
      invoices,
    };
  });

  app.post("/projects/:projectId/invoices", { preHandler: commercialManagers }, async (req, reply) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      periodStart: z.coerce.date().optional(),
      periodEnd: z.coerce.date().optional(),
      issueNow: z.boolean().default(false),
      gstRate: z.number().min(0).max(1).default(0),
      notes: z.string().max(4000).optional(),
    }).parse(req.body);
    const project = await requireOrganisationProject(app, req, projectId);
    const dockets = await app.prisma.docket.findMany({
      where: { organisationId: req.auth.organisationId, projectId, invoiceId: null, status: { in: invoiceableStatuses } },
      include: { lines: { orderBy: { code: "asc" } } },
      orderBy: [{ docketDate: "asc" }, { submittedAt: "asc" }],
    });
    if (!dockets.length) return reply.code(409).send({ error: "There are no uninvoiced dockets for this project" });
    const sequence = await app.prisma.docketInvoice.count({ where: { organisationId: req.auth.organisationId, projectId } });
    const subtotalAmount = Number(dockets.reduce((total, docket) => total + toNumber(docket.totalAmount), 0).toFixed(2));
    const gstAmount = Number((subtotalAmount * body.gstRate).toFixed(2));
    const totalAmount = Number((subtotalAmount + gstAmount).toFixed(2));
    const periodStart = body.periodStart ?? dockets[0]!.docketDate;
    const periodEnd = body.periodEnd ?? dockets[dockets.length - 1]!.docketDate;
    const invoice = await app.prisma.$transaction(async tx => {
      const created = await tx.docketInvoice.create({
        data: {
          organisationId: req.auth.organisationId,
          projectId,
          invoiceNumber: invoiceNumber(project.code, sequence),
          periodStart,
          periodEnd,
          status: body.issueNow ? Status.SUBMITTED : Status.DRAFT,
          subtotalAmount,
          gstAmount,
          totalAmount,
          notes: body.notes?.trim() || undefined,
          createdById: req.auth.userId,
          issuedAt: body.issueNow ? new Date() : undefined,
          items: {
            create: dockets.flatMap(docket => docket.lines.map(line => ({
              docketId: docket.id,
              docketLineId: line.id,
              code: line.code,
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              unitRate: line.unitRateSnapshot,
              amount: line.lineAmount,
            }))),
          },
        },
        include: { items: true },
      });
      await tx.docket.updateMany({ where: { id: { in: dockets.map(docket => docket.id) }, invoiceId: null }, data: { invoiceId: created.id } });
      return created;
    });
    await audit(app, req, "CREATE", "DocketInvoice", invoice.id, { projectId, docketCount: dockets.length, totalAmount });
    return reply.code(201).send(invoice);
  });

  app.get("/rates/admin", { preHandler: commercialManagers }, async req => {
    const query = z.object({ projectId: z.string().uuid().optional(), docketType: docketType.optional(), active: z.coerce.boolean().optional() }).parse(req.query);
    if (query.projectId) await requireOrganisationProject(app, req, query.projectId);
    return app.prisma.docketRate.findMany({
      where: { organisationId: req.auth.organisationId, projectId: query.projectId, docketType: query.docketType, active: query.active },
      include: { project: { select: { id: true, code: true, name: true } } },
      orderBy: [{ active: "desc" }, { code: "asc" }],
    });
  });

  app.post("/rates/admin", { preHandler: commercialManagers }, async (req, reply) => {
    const body = z.object({
      projectId: z.string().uuid().nullable().optional(),
      code: z.string().min(1).max(60),
      description: z.string().min(2).max(500),
      docketType,
      basis: rateBasis.default(DocketRateBasis.MEASURED_WORK),
      unit: z.string().min(1).max(30),
      unitRate: z.number().nonnegative(),
      currency: z.string().length(3).default("AUD"),
      active: z.boolean().default(true),
      effectiveFrom: z.coerce.date().nullable().optional(),
      effectiveTo: z.coerce.date().nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
    }).parse(req.body);
    if (body.projectId) await requireOrganisationProject(app, req, body.projectId);
    const rate = await app.prisma.docketRate.create({
      data: {
        organisation: { connect: { id: req.auth.organisationId } },
        project: body.projectId ? { connect: { id: body.projectId } } : undefined,
        code: body.code,
        description: body.description,
        docketType: body.docketType,
        basis: body.basis,
        unit: body.unit,
        unitRate: body.unitRate,
        currency: body.currency.toUpperCase(),
        active: body.active,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo,
        notes: body.notes,
      },
    });
    await audit(app, req, "CREATE", "DocketRate", rate.id, rate);
    return reply.code(201).send(rate);
  });

  app.patch("/rates/admin/:id", { preHandler: commercialManagers }, async req => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      description: z.string().min(2).max(500).optional(),
      basis: rateBasis.optional(),
      unit: z.string().min(1).max(30).optional(),
      unitRate: z.number().nonnegative().optional(),
      currency: z.string().length(3).optional(),
      active: z.boolean().optional(),
      effectiveFrom: z.coerce.date().nullable().optional(),
      effectiveTo: z.coerce.date().nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
    }).parse(req.body);
    const existing = await app.prisma.docketRate.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId } });
    const rate = await app.prisma.docketRate.update({ where: { id: existing.id }, data: { ...body, currency: body.currency?.toUpperCase() } });
    await audit(app, req, "UPDATE", "DocketRate", rate.id, rate);
    return rate;
  });
};

export default routes;
