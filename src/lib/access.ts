import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AccountSection, Role } from "@prisma/client";

export const allow = (...roles: Role[]) => async (request: FastifyRequest, reply: FastifyReply) => {
  await request.server.authenticate(request);
  if (!roles.includes(request.auth.role)) return reply.code(403).send({ error: "Forbidden" });
};

export const authed = async (request: FastifyRequest) => request.server.authenticate(request);

export const requireSection = (section: AccountSection) => async (request: FastifyRequest, reply: FastifyReply) => {
  await request.server.authenticate(request);
  if (!request.auth.sections.includes(section)) return reply.code(403).send({ error: "Section is not enabled for this account" });
};

export const allowSection = (section: AccountSection, ...roles: Role[]) => async (request: FastifyRequest, reply: FastifyReply) => {
  await request.server.authenticate(request);
  if (!request.auth.sections.includes(section) && !roles.includes(request.auth.role)) return reply.code(403).send({ error: "Forbidden" });
};

export const allowRolesWithSection = (section: AccountSection, ...roles: Role[]) => async (request: FastifyRequest, reply: FastifyReply) => {
  await request.server.authenticate(request);
  if (!roles.includes(request.auth.role) || !request.auth.sections.includes(section)) return reply.code(403).send({ error: "Forbidden" });
};

export async function requireOrganisationProject(app: FastifyInstance, request: FastifyRequest, projectId: string) {
  return app.prisma.project.findFirstOrThrow({ where: { id: projectId, organisationId: request.auth.organisationId } });
}
