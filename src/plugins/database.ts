import fp from "fastify-plugin";
import { Prisma, PrismaClient } from "@prisma/client";

function isClosedConnection(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P1017";
}

export default fp(async (app) => {
  const prisma = new PrismaClient();
  await prisma.$connect();
  app.decorate("prisma", prisma);
  app.addHook("preHandler", async (req) => {
    if (!req.url.startsWith("/api/")) return;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      if (!isClosedConnection(error)) throw error;
      app.log.warn({ err: error }, "Prisma connection was closed; reconnecting before request");
      await prisma.$disconnect().catch(() => undefined);
      await prisma.$connect();
    }
  });
  app.addHook("onClose", async () => prisma.$disconnect());
});
