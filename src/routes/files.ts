import type { FastifyPluginAsync } from "fastify";
import { FileAccess, FileStorageProvider, Role } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { z } from "zod";
import { allow, authed, requireOrganisationProject } from "../lib/access.js";
import { audit } from "../lib/audit.js";

const uuidParam = z.object({ id: z.string().uuid() });

const entityRef = z.object({
  projectId: z.string().uuid().optional(),
  entityType: z.string().min(1).max(80).optional(),
  entityId: z.string().uuid().optional(),
  description: z.string().max(2000).optional(),
  metadata: z.record(z.any()).optional(),
});

const safePathPart = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 120) || "file";

const entityPath = (body: z.infer<typeof entityRef>) => {
  if (body.projectId && body.entityType && body.entityId) return `projects/${body.projectId}/${safePathPart(body.entityType)}/${body.entityId}`;
  if (body.projectId) return `projects/${body.projectId}/files`;
  if (body.entityType && body.entityId) return `entities/${safePathPart(body.entityType)}/${body.entityId}`;
  return "files";
};

const buildPathname = (organisationId: string, body: z.infer<typeof entityRef>, originalName: string) =>
  `organisations/${organisationId}/${entityPath(body)}/${randomUUID()}-${safePathPart(originalName)}`;

const routes: FastifyPluginAsync = async app => {
  app.get("/", { preHandler: authed }, async req => {
    const q = z.object({
      projectId: z.string().uuid().optional(),
      entityType: z.string().optional(),
      entityId: z.string().uuid().optional(),
      includeDeleted: z.coerce.boolean().default(false),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }).parse(req.query);
    if (q.projectId) await requireOrganisationProject(app, req, q.projectId);
    return app.prisma.fileAsset.findMany({
      where: { organisationId: req.auth.organisationId, projectId: q.projectId, entityType: q.entityType, entityId: q.entityId, deletedAt: q.includeDeleted ? undefined : null },
      orderBy: { createdAt: "desc" },
      take: q.limit,
    });
  });

  app.post("/", { preHandler: authed }, async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: "A file is required" });
    const fields = Object.fromEntries(Object.entries(data.fields).map(([key, value]) => {
      const field = (Array.isArray(value) ? value[0] : value) as { value?: unknown } | undefined;
      return [key, field?.value];
    }));
    const body = entityRef.extend({ access: z.nativeEnum(FileAccess).default(FileAccess.PRIVATE) }).parse({
      ...fields,
      metadata: typeof fields.metadata === "string" ? JSON.parse(fields.metadata) : undefined,
    });
    if (body.projectId) await requireOrganisationProject(app, req, body.projectId);
    const buffer = await data.toBuffer();
    const pathname = buildPathname(req.auth.organisationId, body, data.filename);
    const blob = await import("@vercel/blob");
    const uploaded = await blob.put(pathname, buffer, {
      access: body.access.toLowerCase() as "private" | "public",
      contentType: data.mimetype,
      addRandomSuffix: false,
    });
    const asset = await app.prisma.fileAsset.create({
      data: {
        organisationId: req.auth.organisationId,
        projectId: body.projectId,
        uploadedById: req.auth.userId,
        entityType: body.entityType,
        entityId: body.entityId,
        provider: FileStorageProvider.VERCEL_BLOB,
        access: body.access,
        pathname,
        url: uploaded.url,
        downloadUrl: "downloadUrl" in uploaded ? uploaded.downloadUrl : undefined,
        mimeType: data.mimetype,
        sizeBytes: buffer.length,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        originalName: data.filename,
        description: body.description,
        metadata: body.metadata,
      },
    });
    await audit(app, req, "UPLOAD", "FileAsset", asset.id, { id: asset.id, pathname: asset.pathname, entityType: asset.entityType, entityId: asset.entityId });
    return reply.code(201).send(asset);
  });

  app.post("/register", { preHandler: authed }, async (req, reply) => {
    const body = entityRef.extend({
      access: z.nativeEnum(FileAccess).default(FileAccess.PRIVATE),
      pathname: z.string().min(1),
      url: z.string().url(),
      downloadUrl: z.string().url().optional(),
      mimeType: z.string().min(1),
      sizeBytes: z.number().int().positive(),
      sha256: z.string().optional(),
      originalName: z.string().min(1),
    }).parse(req.body);
    if (!body.pathname.startsWith(`organisations/${req.auth.organisationId}/`)) return reply.code(400).send({ error: "Blob pathname must be prefixed with this organisation" });
    if (body.projectId) await requireOrganisationProject(app, req, body.projectId);
    const asset = await app.prisma.fileAsset.create({
      data: {
        organisationId: req.auth.organisationId,
        projectId: body.projectId,
        uploadedById: req.auth.userId,
        entityType: body.entityType,
        entityId: body.entityId,
        provider: FileStorageProvider.VERCEL_BLOB,
        access: body.access,
        pathname: body.pathname,
        url: body.url,
        downloadUrl: body.downloadUrl,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
        originalName: body.originalName,
        description: body.description,
        metadata: body.metadata,
      },
    });
    await audit(app, req, "REGISTER", "FileAsset", asset.id, { id: asset.id, pathname: asset.pathname, entityType: asset.entityType, entityId: asset.entityId });
    return reply.code(201).send(asset);
  });

  app.post("/client-upload-token", { preHandler: authed }, async (req, reply) => {
    const body = entityRef.extend({
      access: z.nativeEnum(FileAccess).default(FileAccess.PRIVATE),
      originalName: z.string().min(1),
      contentType: z.string().min(1),
      maximumSizeInBytes: z.number().int().positive().max(100 * 1024 * 1024).default(25 * 1024 * 1024),
    }).parse(req.body);
    if (body.projectId) await requireOrganisationProject(app, req, body.projectId);
    const pathname = buildPathname(req.auth.organisationId, body, body.originalName);
    const blobClient = await import("@vercel/blob/client");
    const clientToken = await blobClient.generateClientTokenFromReadWriteToken({
      pathname,
      allowedContentTypes: [body.contentType],
      maximumSizeInBytes: body.maximumSizeInBytes,
      validUntil: Date.now() + 15 * 60 * 1000,
    });
    return reply.code(201).send({ pathname, clientToken, access: body.access, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() });
  });

  app.get("/:id", { preHandler: authed }, async req => {
    const { id } = uuidParam.parse(req.params);
    return app.prisma.fileAsset.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId, deletedAt: null } });
  });

  app.get("/:id/download", { preHandler: authed }, async (req, reply) => {
    const { id } = uuidParam.parse(req.params);
    const asset = await app.prisma.fileAsset.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId, deletedAt: null } });
    if (asset.access === FileAccess.PUBLIC) return reply.redirect(asset.url);
    const blob = await import("@vercel/blob");
    const result = await blob.get(asset.pathname, { access: asset.access.toLowerCase() as "private" | "public" });
    if (!result?.stream) return reply.code(404).send({ error: "Blob not found" });
    reply.header("content-type", asset.mimeType);
    reply.header("content-disposition", `inline; filename="${asset.originalName.replace(/"/g, "")}"`);
    return reply.send(Readable.fromWeb(result.stream as NodeReadableStream));
  });

  app.delete("/:id", { preHandler: allow(Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER, Role.SUPERVISOR, Role.SITE_SUPERVISOR, Role.SITE_ENGINEER, Role.SAFETY_MANAGER) }, async req => {
    const { id } = uuidParam.parse(req.params);
    const asset = await app.prisma.fileAsset.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId, deletedAt: null } });
    const blob = await import("@vercel/blob");
    await blob.del(asset.pathname);
    const deleted = await app.prisma.fileAsset.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(app, req, "DELETE", "FileAsset", id, { id, pathname: asset.pathname });
    return deleted;
  });
};

export default routes;
