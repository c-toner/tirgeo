import "fastify";
import type { AccountSection, PrismaClient, Role } from "@prisma/client";

declare module "fastify" {
  interface FastifyInstance { prisma: PrismaClient; authenticate: (request: FastifyRequest) => Promise<void>; }
  interface FastifyRequest { auth: { userId: string; organisationId: string; role: Role; sections: AccountSection[] }; }
}
