import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import { Prisma } from "@prisma/client";
import { config } from "../config.js";
import { effectiveSections } from "../lib/sections.js";

function isClosedConnection(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P1017";
}

export default fp(async (app) => {
  await app.register(jwt, { secret: config.JWT_SECRET, sign: { iss: config.JWT_ISSUER, aud: config.JWT_AUDIENCE }, verify: { allowedIss: config.JWT_ISSUER, allowedAud: config.JWT_AUDIENCE } });
  app.decorate("authenticate", async (request) => {
    const token = await request.jwtVerify<{ sub: string; organisationId: string }>();
    const lookupUser = () => app.prisma.user.findFirst({
      where: { id: token.sub, organisationId: token.organisationId, active: true },
      select: { id: true, organisationId: true, role: true, sectionAccess: { select: { section: true, enabled: true } } },
    });
    let user;
    try {
      user = await lookupUser();
    } catch (error) {
      if (!isClosedConnection(error)) throw error;
      request.log.warn({ err: error }, "Prisma connection was closed during authentication; reconnecting and retrying");
      await app.prisma.$disconnect().catch(() => undefined);
      await app.prisma.$connect();
      user = await lookupUser();
    }
    if (!user) throw Object.assign(new Error("Account is inactive or no longer authorised"), { statusCode: 401 });
    request.auth = { userId: user.id, organisationId: user.organisationId, role: user.role, sections: effectiveSections(user.role, user.sectionAccess) };
  });
});
