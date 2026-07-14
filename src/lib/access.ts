import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@prisma/client";

export const allow = (...roles: Role[]) => async (request: FastifyRequest, reply: FastifyReply) => {
  await request.server.authenticate(request);
  if (!roles.includes(request.auth.role)) return reply.code(403).send({ error: "Forbidden" });
};

export const authed = async (request: FastifyRequest) => request.server.authenticate(request);

export async function requireOrganisationProject(app: FastifyInstance, request: FastifyRequest, projectId: string) {
  return app.prisma.project.findFirstOrThrow({ where: { id: projectId, organisationId: request.auth.organisationId } });
}
