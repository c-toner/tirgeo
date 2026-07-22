import type { FastifyPluginAsync } from "fastify";
import bcrypt from "bcrypt";
import { z } from "zod";
import { authed } from "../lib/access.js";
import { effectiveSections } from "../lib/sections.js";

const toOrganisationSlug = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const routes: FastifyPluginAsync = async (app) => {
  app.post("/login", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const body = z.object({ organisationId: z.string().uuid().optional(), organisation: z.string().min(1).optional(), email: z.string().email(), password: z.string() }).refine(v => v.organisationId || v.organisation, "organisation or organisationId is required").parse(req.body);
    const organisation = body.organisationId
      ? await app.prisma.organisation.findUnique({ where: { id: body.organisationId }, select: { id: true, name: true, slug: true } })
      : await app.prisma.organisation.findUnique({ where: { slug: toOrganisationSlug(body.organisation!) }, select: { id: true, name: true, slug: true } });
    if (!organisation) return reply.code(401).send({ error: "Invalid credentials" });
    const user = await app.prisma.user.findUnique({ where: { organisationId_email: { organisationId: organisation.id, email: body.email.toLowerCase() } }, include: { sectionAccess: { select: { section: true, enabled: true } } } });
    if (!user?.active || !(await bcrypt.compare(body.password, user.passwordHash))) return reply.code(401).send({ error: "Invalid credentials" });
    const worker = await app.prisma.worker.findFirst({ where: { organisationId: user.organisationId, userId: user.id, terminationDate: null }, select: { id: true, employeeNumber: true, firstName: true, lastName: true } });
    return { token: app.jwt.sign({ sub: user.id, organisationId: user.organisationId, role: user.role }, { expiresIn: "12h" }), organisation, user: { id: user.id, name: user.name, role: user.role, sections: effectiveSections(user.role, user.sectionAccess), signaturePinRequired: !user.signaturePinHash, worker } };
  });
  app.put("/signature-pin", { preHandler: authed, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z.object({ pin: z.string().regex(/^\d{4}$/, "PIN must contain exactly four digits"), currentPin: z.string().regex(/^\d{4}$/).optional() }).parse(req.body);
    const user = await app.prisma.user.findFirstOrThrow({ where: { id: req.auth.userId, organisationId: req.auth.organisationId, active: true } });
    if (user.signaturePinHash && (!body.currentPin || !(await bcrypt.compare(body.currentPin, user.signaturePinHash)))) return reply.code(401).send({ error: "Current signing PIN is incorrect" });
    await app.prisma.user.update({ where: { id: user.id }, data: { signaturePinHash: await bcrypt.hash(body.pin, 12), signaturePinSetAt: new Date(), signaturePinFailedAttempts: 0, signaturePinLockedUntil: null } });
    return reply.code(204).send();
  });
  app.post("/signature-pin/reset", { preHandler: authed, config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const body = z.object({ password: z.string().min(1), pin: z.string().regex(/^\d{4}$/, "PIN must contain exactly four digits") }).parse(req.body);
    const user = await app.prisma.user.findFirstOrThrow({ where: { id: req.auth.userId, organisationId: req.auth.organisationId, active: true } });
    if (!(await bcrypt.compare(body.password, user.passwordHash))) return reply.code(403).send({ error: "Password is incorrect" });
    await app.prisma.user.update({ where: { id: user.id }, data: { signaturePinHash: await bcrypt.hash(body.pin, 12), signaturePinSetAt: new Date(), signaturePinFailedAttempts: 0, signaturePinLockedUntil: null } });
    return reply.code(204).send();
  });
};
export default routes;
