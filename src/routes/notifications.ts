import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authed } from "../lib/access.js";

const routes: FastifyPluginAsync = async app => {
  app.get("/", { preHandler: authed }, req => app.prisma.notification.findMany({ where: { userId: req.auth.userId }, orderBy: { createdAt: "desc" }, take: 100 }));
  app.post("/:id/read", { preHandler: authed }, async req => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const notification = await app.prisma.notification.findFirstOrThrow({ where: { id, userId: req.auth.userId } });
    return app.prisma.notification.update({ where: { id: notification.id }, data: { readAt: notification.readAt ?? new Date() } });
  });
  app.post("/read-all", { preHandler: authed }, async req => {
    await app.prisma.notification.updateMany({ where: { userId: req.auth.userId, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  });
};
export default routes;
