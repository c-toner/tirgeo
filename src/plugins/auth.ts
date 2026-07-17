import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import { config } from "../config.js";
import { effectiveSections } from "../lib/sections.js";

export default fp(async (app) => {
  await app.register(jwt, { secret: config.JWT_SECRET, sign: { iss: config.JWT_ISSUER, aud: config.JWT_AUDIENCE }, verify: { allowedIss: config.JWT_ISSUER, allowedAud: config.JWT_AUDIENCE } });
  app.decorate("authenticate", async (request) => {
    const token = await request.jwtVerify<{ sub: string; organisationId: string }>();
    const user = await app.prisma.user.findFirst({
      where: { id: token.sub, organisationId: token.organisationId, active: true },
      select: { id: true, organisationId: true, role: true, sectionAccess: { select: { section: true, enabled: true } } },
    });
    if (!user) throw Object.assign(new Error("Account is inactive or no longer authorised"), { statusCode: 401 });
    request.auth = { userId: user.id, organisationId: user.organisationId, role: user.role, sections: effectiveSections(user.role, user.sectionAccess) };
  });
});
