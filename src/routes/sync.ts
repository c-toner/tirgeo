import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authed } from "../lib/access.js";
import { decodeSyncCursor, encodeSyncCursor } from "../lib/sync-cursor.js";

const routes: FastifyPluginAsync = async app => {
  app.post("/register", { preHandler: authed }, async req => {
    const b = z.object({ deviceId: z.string().uuid(), platform: z.enum(["ios","android","web"]), appVersion: z.string() }).parse(req.body);
    const key = { organisationId_id: { organisationId: req.auth.organisationId, id: b.deviceId } };
    const existing = await app.prisma.device.findUnique({ where: key });
    if (existing?.revokedAt) throw Object.assign(new Error("Device has been revoked"), { statusCode: 403 });
    if (existing && existing.userId !== req.auth.userId) throw Object.assign(new Error("Device is registered to another user"), { statusCode: 409 });
    return app.prisma.device.upsert({ where: key, create: { id: b.deviceId, organisationId: req.auth.organisationId, userId: req.auth.userId, platform: b.platform, appVersion: b.appVersion }, update: { appVersion: b.appVersion, lastSeenAt: new Date() } });
  });
  app.get("/pull", { preHandler: authed }, async req => {
    const q = z.object({ deviceId: z.string().uuid(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(1000).default(500) }).parse(req.query);
    const device = await app.prisma.device.findFirstOrThrow({ where: { organisationId: req.auth.organisationId, id: q.deviceId, userId: req.auth.userId, revokedAt: null } });
    const cursor = decodeSyncCursor(q.cursor);
    const rows = await app.prisma.auditEvent.findMany({ where: { organisationId: req.auth.organisationId, OR: cursor ? [{ occurredAt: { gt: cursor.occurredAt } }, { occurredAt: cursor.occurredAt, id: { gt: cursor.id } }] : undefined }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: q.limit + 1, select: { id: true, action: true, entityType: true, entityId: true, reason: true, occurredAt: true } });
    const hasMore = rows.length > q.limit; const changes = rows.slice(0, q.limit); const last = changes.at(-1);
    if (last) await app.prisma.device.update({ where: { organisationId_id: { organisationId: device.organisationId, id: device.id } }, data: { lastPulledCursor: last.occurredAt, lastPulledEventId: last.id, lastSeenAt: new Date() } });
    return { changes, cursor: last ? encodeSyncCursor(last) : q.cursor, hasMore };
  });
  app.post("/receipt", { preHandler: authed }, async req => {
    const b = z.object({ mutationId: z.string().uuid(), deviceId: z.string().uuid(), entityType: z.string(), entityId: z.string(), response: z.record(z.any()) }).parse(req.body);
    await app.prisma.device.findFirstOrThrow({ where: { organisationId: req.auth.organisationId, id: b.deviceId, userId: req.auth.userId, revokedAt: null } });
    return app.prisma.mutationReceipt.upsert({ where: { organisationId_id: { organisationId: req.auth.organisationId, id: b.mutationId } }, create: { id: b.mutationId, organisationId: req.auth.organisationId, deviceId: b.deviceId, entityType: b.entityType, entityId: b.entityId, response: b.response }, update: {} });
  });
};
export default routes;
