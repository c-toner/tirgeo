import type { FastifyPluginAsync } from "fastify";
import bcrypt from "bcrypt";
import { z } from "zod";
import { authed } from "../lib/access.js";

const routes: FastifyPluginAsync = async (app) => {
  app.post("/login", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const body = z.object({ organisationId: z.string().uuid(), email: z.string().email(), password: z.string() }).parse(req.body);
    const user = await app.prisma.user.findUnique({ where: { organisationId_email: { organisationId: body.organisationId, email: body.email.toLowerCase() } } });
    if (!user?.active || !(await bcrypt.compare(body.password, user.passwordHash))) return reply.code(401).send({ error: "Invalid credentials" });
    return { token: app.jwt.sign({ sub: user.id, organisationId: user.organisationId, role: user.role }, { expiresIn: "12h" }), user: { id: user.id, name: user.name, role: user.role, signaturePinRequired: !user.signaturePinHash } };
  });
  app.put("/signature-pin", { preHandler: authed, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z.object({ pin: z.string().regex(/^\d{4}$/, "PIN must contain exactly four digits"), currentPin: z.string().regex(/^\d{4}$/).optional() }).parse(req.body);
    const user = await app.prisma.user.findFirstOrThrow({ where: { id: req.auth.userId, organisationId: req.auth.organisationId, active: true } });
    if (user.signaturePinHash && (!body.currentPin || !(await bcrypt.compare(body.currentPin, user.signaturePinHash)))) return reply.code(401).send({ error: "Current signing PIN is incorrect" });
    await app.prisma.user.update({ where: { id: user.id }, data: { signaturePinHash: await bcrypt.hash(body.pin, 12), signaturePinSetAt: new Date(), signaturePinFailedAttempts: 0, signaturePinLockedUntil: null } });
    return reply.code(204).send();
  });
};
export default routes;
