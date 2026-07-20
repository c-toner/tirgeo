import type { FastifyPluginAsync } from "fastify";
import { AccountSection, Prisma, Role } from "@prisma/client";
import bcrypt from "bcrypt";
import { z } from "zod";
import { allow, authed, requireSection } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { canManageUserAccess, canViewPayrollDetails, effectiveSections } from "../lib/sections.js";
import { decryptJson, encryptJson } from "../lib/secure-json.js";

const payrollDetails = z.object({
  paymentMethod: z.enum(["BANK_ACCOUNT", "BPAY"]).default("BANK_ACCOUNT"),
  accountName: z.string().trim().min(2).max(120).optional(),
  bsb: z.string().trim().regex(/^\d{3}-?\d{3}$/).optional(),
  accountNumber: z.string().trim().min(4).max(20).optional(),
  bpayBillerCode: z.string().trim().min(3).max(20).optional(),
  bpayCustomerReference: z.string().trim().min(3).max(30).optional(),
}).superRefine((value, ctx) => {
  if (value.paymentMethod === "BANK_ACCOUNT" && (!value.accountName || !value.bsb || !value.accountNumber)) {
    ctx.addIssue({ code: "custom", message: "accountName, bsb and accountNumber are required for bank account payroll details" });
  }
  if (value.paymentMethod === "BPAY" && (!value.bpayBillerCode || !value.bpayCustomerReference)) {
    ctx.addIssue({ code: "custom", message: "bpayBillerCode and bpayCustomerReference are required for BPAY payroll details" });
  }
});

const address = z.object({
  line1: z.string().trim().max(160).optional(),
  line2: z.string().trim().max(160).optional(),
  suburb: z.string().trim().max(80).optional(),
  state: z.string().trim().max(40).optional(),
  postcode: z.string().trim().max(12).optional(),
  country: z.string().trim().max(80).default("Australia"),
}).partial();

const accountUpdate = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(6).max(40).nullable().optional(),
  address: address.nullable().optional(),
  payrollDetails: payrollDetails.nullable().optional(),
});

const accessOverride = z.object({
  section: z.nativeEnum(AccountSection),
  enabled: z.boolean(),
});

const createUser = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email(),
  password: z.string().min(10).max(200),
  role: z.nativeEnum(Role).default(Role.WORKER),
  phone: z.string().trim().min(6).max(40).nullable().optional(),
  address: address.nullable().optional(),
  worker: z.object({
    employeeNumber: z.string().trim().min(1).max(40),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    employmentType: z.string().trim().min(1).max(80).default("Employee"),
    classification: z.string().trim().max(120).optional(),
    awardCode: z.string().trim().max(80).optional(),
    commencementDate: z.coerce.date().optional(),
  }).optional(),
  sectionOverrides: z.array(accessOverride).optional(),
});

const managerCreatableRoles = new Set<Role>([
  Role.SUPERVISOR,
  Role.SITE_SUPERVISOR,
  Role.SITE_ENGINEER,
  Role.FOREMAN,
  Role.SAFETY_MANAGER,
  Role.WORKER,
  Role.SUBCONTRACTOR,
  Role.CLIENT_AUDITOR,
]);

function safeUser(user: {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  address: Prisma.JsonValue | null;
  role: Role;
  active: boolean;
  sectionAccess: { section: AccountSection; enabled: boolean; updatedAt?: Date }[];
  worker?: { id: string; employeeNumber: string; firstName: string; lastName: string; employmentType: string; classification: string | null; payrollDetailsEncrypted: string | null } | null;
}, includePayrollDetails: boolean) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    address: user.address,
    role: user.role,
    active: user.active,
    sections: effectiveSections(user.role, user.sectionAccess),
    sectionOverrides: user.sectionAccess,
    worker: user.worker
      ? {
          id: user.worker.id,
          employeeNumber: user.worker.employeeNumber,
          firstName: user.worker.firstName,
          lastName: user.worker.lastName,
          employmentType: user.worker.employmentType,
          classification: user.worker.classification,
        }
      : null,
    payrollDetails: includePayrollDetails ? decryptJson(user.worker?.payrollDetailsEncrypted) : undefined,
  };
}

async function findAccountUser(app: Parameters<FastifyPluginAsync>[0], organisationId: string, userId: string) {
  return app.prisma.user.findFirstOrThrow({
    where: { id: userId, organisationId },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      address: true,
      role: true,
      active: true,
      sectionAccess: { select: { section: true, enabled: true, updatedAt: true }, orderBy: { section: "asc" } },
      worker: { select: { id: true, employeeNumber: true, firstName: true, lastName: true, employmentType: true, classification: true, payrollDetailsEncrypted: true } },
    },
  });
}

const routes: FastifyPluginAsync = async app => {
  app.get("/sections", { preHandler: authed }, async req => ({
    sections: Object.values(AccountSection),
    defaults: Object.fromEntries(Object.values(Role).map(role => [role, effectiveSections(role)])),
    current: req.auth.sections,
  }));

  app.get("/me", { preHandler: authed }, async req => {
    const user = await findAccountUser(app, req.auth.organisationId, req.auth.userId);
    return safeUser(user, true);
  });

  app.post("/users", { preHandler: allow(Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER, Role.OPERATIONS_MANAGER, Role.SITE_SUPERVISOR) }, async (req, reply) => {
    const body = createUser.parse(req.body);
    if ((req.auth.role === Role.PROJECT_MANAGER || req.auth.role === Role.OPERATIONS_MANAGER || req.auth.role === Role.SITE_SUPERVISOR) && !managerCreatableRoles.has(body.role)) {
      return reply.code(403).send({ error: "Managers can only create crew and field-support accounts" });
    }
    const userId = await app.prisma.$transaction(async tx => {
      const created = await tx.user.create({
        data: {
          organisationId: req.auth.organisationId,
          email: body.email.toLowerCase(),
          name: body.name,
          phone: body.phone,
          address: body.address === undefined ? undefined : body.address as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
          role: body.role,
          passwordHash: await bcrypt.hash(body.password, 12),
          sectionAccess: body.sectionOverrides
            ? { create: body.sectionOverrides.map(override => ({ section: override.section, enabled: override.enabled, grantedById: req.auth.userId })) }
            : undefined,
        },
        select: { id: true },
      });
      if (body.worker) {
        await tx.worker.create({
          data: {
            organisationId: req.auth.organisationId,
            userId: created.id,
            employeeNumber: body.worker.employeeNumber,
            firstName: body.worker.firstName,
            lastName: body.worker.lastName,
            employmentType: body.worker.employmentType,
            classification: body.worker.classification,
            awardCode: body.worker.awardCode,
            commencementDate: body.worker.commencementDate ?? new Date(),
          },
        });
      }
      return created.id;
    });
    const user = await findAccountUser(app, req.auth.organisationId, userId);
    await audit(app, req, "CREATE", "User", user.id, { role: body.role, workerCreated: !!body.worker, sectionOverrides: body.sectionOverrides });
    return reply.code(201).send(safeUser(user, canViewPayrollDetails(req.auth.role)));
  });

  app.put("/me", { preHandler: authed }, async (req, reply) => {
    const body = accountUpdate.parse(req.body);
    const userId = await app.prisma.$transaction(async tx => {
      const current = await tx.user.findFirstOrThrow({ where: { id: req.auth.userId, organisationId: req.auth.organisationId }, select: { id: true, worker: { select: { id: true } } } });
      await tx.user.update({
        where: { id: current.id },
        data: {
          name: body.name,
          email: body.email?.toLowerCase(),
          phone: body.phone,
          address: body.address === undefined ? undefined : body.address as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
        },
      });
      if (body.payrollDetails !== undefined) {
        if (!current.worker) throw Object.assign(new Error("A linked worker record is required before payroll details can be saved"), { statusCode: 409 });
        await tx.worker.update({
          where: { id: current.worker.id },
          data: { payrollDetailsEncrypted: body.payrollDetails === null ? null : encryptJson(body.payrollDetails) },
        });
      }
      return current.id;
    });
    const user = await findAccountUser(app, req.auth.organisationId, userId);
    await audit(app, req, "UPDATE", "User", req.auth.userId, { fields: Object.keys(body).filter(key => key !== "payrollDetails"), payrollDetailsUpdated: body.payrollDetails !== undefined });
    return reply.send(safeUser(user, true));
  });

  app.get("/users", { preHandler: requireSection(AccountSection.USER_ADMIN) }, async req => {
    if (!canManageUserAccess(req.auth.role)) throw Object.assign(new Error("Only owners and admins can manage user access"), { statusCode: 403 });
    const users = await app.prisma.user.findMany({
      where: { organisationId: req.auth.organisationId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        address: true,
        role: true,
        active: true,
        sectionAccess: { select: { section: true, enabled: true, updatedAt: true }, orderBy: { section: "asc" } },
        worker: { select: { id: true, employeeNumber: true, firstName: true, lastName: true, employmentType: true, classification: true, payrollDetailsEncrypted: true } },
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return users.map(user => safeUser(user, canViewPayrollDetails(req.auth.role)));
  });

  app.get("/users/:id", { preHandler: requireSection(AccountSection.USER_ADMIN) }, async req => {
    if (!canManageUserAccess(req.auth.role)) throw Object.assign(new Error("Only owners and admins can manage user access"), { statusCode: 403 });
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const user = await findAccountUser(app, req.auth.organisationId, id);
    return safeUser(user, canViewPayrollDetails(req.auth.role));
  });

  app.patch("/users/:id", { preHandler: allow(Role.OWNER, Role.ADMIN) }, async req => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = accountUpdate.extend({
      role: z.nativeEnum(Role).optional(),
      active: z.boolean().optional(),
      sectionOverrides: z.array(accessOverride).optional(),
    }).parse(req.body);
    const current = await app.prisma.user.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId }, select: { id: true, worker: { select: { id: true } } } });
    await app.prisma.user.update({
      where: { id: current.id },
      data: {
        name: body.name,
        email: body.email?.toLowerCase(),
        phone: body.phone,
        address: body.address === undefined ? undefined : body.address as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
        role: body.role,
        active: body.active,
      },
    });
    if (body.payrollDetails !== undefined) {
      if (!current.worker) throw Object.assign(new Error("A linked worker record is required before payroll details can be saved"), { statusCode: 409 });
      await app.prisma.worker.update({ where: { id: current.worker.id }, data: { payrollDetailsEncrypted: body.payrollDetails === null ? null : encryptJson(body.payrollDetails) } });
    }
    if (body.sectionOverrides?.length) {
      await app.prisma.$transaction(body.sectionOverrides.map(override =>
        app.prisma.userSectionAccess.upsert({
          where: { userId_section: { userId: current.id, section: override.section } },
          create: { userId: current.id, section: override.section, enabled: override.enabled, grantedById: req.auth.userId },
          update: { enabled: override.enabled, grantedById: req.auth.userId },
        }),
      ));
    }
    const user = await findAccountUser(app, req.auth.organisationId, current.id);
    await audit(app, req, "UPDATE_ACCESS", "User", id, { role: body.role, active: body.active, sectionOverrides: body.sectionOverrides, payrollDetailsUpdated: body.payrollDetails !== undefined });
    return safeUser(user, canViewPayrollDetails(req.auth.role));
  });

  app.get("/directory", { preHandler: requireSection(AccountSection.WORKER_DIRECTORY) }, async req => {
    const q = z.object({ search: z.string().trim().min(1).max(80).optional() }).parse(req.query);
    return app.prisma.user.findMany({
      where: {
        organisationId: req.auth.organisationId,
        active: true,
        OR: q.search ? [
          { name: { contains: q.search, mode: "insensitive" } },
          { email: { contains: q.search, mode: "insensitive" } },
          { phone: { contains: q.search, mode: "insensitive" } },
          { worker: { firstName: { contains: q.search, mode: "insensitive" } } },
          { worker: { lastName: { contains: q.search, mode: "insensitive" } } },
        ] : undefined,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        role: true,
        worker: { select: { id: true, employeeNumber: true, firstName: true, lastName: true, classification: true } },
      },
      orderBy: { name: "asc" },
      take: 100,
    });
  });
};

export default routes;
