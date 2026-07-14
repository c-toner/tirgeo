import type { FastifyInstance, FastifyRequest } from "fastify";

export async function audit(app: FastifyInstance, req: FastifyRequest, action: string, entityType: string, entityId: string, after?: unknown, reason?: string) {
  await app.prisma.auditEvent.create({ data: auditData(req, action, entityType, entityId, after, reason) });
}

export function auditData(req: FastifyRequest, action: string, entityType: string, entityId: string, after?: unknown, reason?: string) {
  return { organisationId: req.auth.organisationId, actorId: req.auth.userId, action, entityType, entityId, after: after as any, reason, ipAddress: req.ip };
}
