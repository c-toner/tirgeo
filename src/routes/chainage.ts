import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { AccountSection } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authed, requireOrganisationProject } from "../lib/access.js";
import { audit } from "../lib/audit.js";

const uuidParam = z.object({ id: z.string().uuid() });
const chainageSide = z.enum(["LEFT", "CENTRE", "RIGHT", "BOTH", "UNKNOWN"]);
const observationStatus = z.enum(["OPEN", "IN_REVIEW", "PRICED", "ACTIONED", "CLOSED"]);
const observationCategory = z.enum(["ISSUE", "DEFECT", "SCOPE", "QUOTE", "PHOTO_RECORD", "ACCESS", "UTILITY", "DRAINAGE"]);
const coordinate = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const geometry = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(coordinate).min(2),
}).optional();

const alignmentBody = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(2).max(160),
  roadRef: z.string().max(80).optional(),
  direction: z.string().max(80).optional(),
  startLabel: z.string().max(160).optional(),
  endLabel: z.string().max(160).optional(),
  startChainageM: z.number().nonnegative(),
  endChainageM: z.number().nonnegative(),
  geometry,
  notes: z.string().max(2000).optional(),
}).refine(value => value.endChainageM > value.startChainageM, "endChainageM must be greater than startChainageM");

const observationFields = z.object({
  projectId: z.string().uuid(),
  alignmentId: z.string().uuid(),
  chainageM: z.number().nonnegative(),
  side: chainageSide.default("CENTRE"),
  offsetM: z.number().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  gpsAccuracyM: z.number().nonnegative().optional(),
  category: observationCategory.default("ISSUE"),
  title: z.string().min(2).max(160),
  description: z.string().max(4000).optional(),
  status: observationStatus.default("OPEN"),
  photoIds: z.array(z.string().uuid()).max(30).default([]),
  observedAt: z.coerce.date().optional(),
});

const observationBody = observationFields.superRefine((value, ctx) => {
  if ((value.latitude === undefined) !== (value.longitude === undefined)) ctx.addIssue({ code: "custom", message: "latitude and longitude must be supplied together" });
});

const observationPatchBody = observationFields.omit({ projectId: true }).partial().superRefine((value, ctx) => {
  if ((value.latitude === undefined) !== (value.longitude === undefined)) ctx.addIssue({ code: "custom", message: "latitude and longitude must be supplied together" });
});

const observationQuery = z.object({
  projectId: z.string().uuid().optional(),
  alignmentId: z.string().uuid().optional(),
  status: observationStatus.optional(),
  category: observationCategory.optional(),
  side: chainageSide.optional(),
  search: z.string().trim().optional(),
  chainageFromM: z.coerce.number().nonnegative().optional(),
  chainageToM: z.coerce.number().nonnegative().optional(),
  observedFrom: z.coerce.date().optional(),
  observedTo: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
}).refine((value) => value.chainageFromM === undefined || value.chainageToM === undefined || value.chainageToM >= value.chainageFromM, "chainageToM must be greater than or equal to chainageFromM");

function requireChainage(req: FastifyRequest, reply: FastifyReply) {
  if (!req.auth.sections.includes(AccountSection.CHAINAGE)) return reply.code(403).send({ error: "Forbidden" });
  return null;
}

function observationWhere(req: FastifyRequest, q: z.infer<typeof observationQuery>): Prisma.ChainageObservationWhereInput {
  return {
    project: { organisationId: req.auth.organisationId },
    projectId: q.projectId,
    alignmentId: q.alignmentId,
    status: q.status,
    category: q.category,
    side: q.side,
    chainageM: q.chainageFromM !== undefined || q.chainageToM !== undefined ? { gte: q.chainageFromM, lte: q.chainageToM } : undefined,
    observedAt: q.observedFrom || q.observedTo ? { gte: q.observedFrom, lte: q.observedTo } : undefined,
    ...(q.search ? { OR: [{ title: { contains: q.search, mode: "insensitive" } }, { description: { contains: q.search, mode: "insensitive" } }, { alignment: { name: { contains: q.search, mode: "insensitive" } } }] } : {}),
  };
}

async function validateObservationUpdate(app: FastifyInstance, req: FastifyRequest, projectId: string, data: { alignmentId?: string; chainageM?: number; photoIds?: string[] }) {
  if (data.alignmentId || data.chainageM !== undefined) {
    const alignment = await app.prisma.chainageAlignment.findFirstOrThrow({
      where: { id: data.alignmentId, projectId, project: { organisationId: req.auth.organisationId } },
    });
    if (data.chainageM !== undefined && (data.chainageM < Number(alignment.startChainageM) || data.chainageM > Number(alignment.endChainageM))) {
      return "Chainage must sit inside the selected road alignment range";
    }
  }
  if (data.photoIds?.length) {
    const photoCount = await app.prisma.fileAsset.count({ where: { id: { in: data.photoIds }, organisationId: req.auth.organisationId, deletedAt: null } });
    if (photoCount !== data.photoIds.length) return "Every chainage photo must belong to this organisation";
  }
  return null;
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

const routes: FastifyPluginAsync = async app => {
  app.get("/alignments", { preHandler: authed }, async (req, reply) => {
    const denied = requireChainage(req, reply); if (denied) return denied;
    const q = z.object({ projectId: z.string().uuid().optional() }).parse(req.query);
    if (q.projectId) await requireOrganisationProject(app, req, q.projectId);
    return app.prisma.chainageAlignment.findMany({
      where: { project: { organisationId: req.auth.organisationId }, projectId: q.projectId },
      include: { project: { select: { id: true, code: true, name: true } }, _count: { select: { observations: true } } },
      orderBy: [{ project: { code: "asc" } }, { name: "asc" }],
    });
  });

  app.post("/alignments", { preHandler: authed }, async (req, reply) => {
    const denied = requireChainage(req, reply); if (denied) return denied;
    const body = alignmentBody.parse(req.body);
    await requireOrganisationProject(app, req, body.projectId);
    const alignment = await app.prisma.chainageAlignment.create({ data: body, include: { project: { select: { id: true, code: true, name: true } } } });
    await audit(app, req, "CREATE", "ChainageAlignment", alignment.id, alignment);
    return reply.code(201).send(alignment);
  });

  app.get("/observations", { preHandler: authed }, async (req, reply) => {
    const denied = requireChainage(req, reply); if (denied) return denied;
    const q = observationQuery.parse(req.query);
    if (q.projectId) await requireOrganisationProject(app, req, q.projectId);
    return app.prisma.chainageObservation.findMany({
      where: observationWhere(req, q),
      include: {
        project: { select: { id: true, code: true, name: true } },
        alignment: true,
        createdBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { observedAt: "desc" },
      take: q.limit,
    });
  });

  app.get("/observations/export.csv", { preHandler: authed }, async (req, reply) => {
    const denied = requireChainage(req, reply); if (denied) return denied;
    const q = observationQuery.parse(req.query);
    if (q.projectId) await requireOrganisationProject(app, req, q.projectId);
    const rows = await app.prisma.chainageObservation.findMany({
      where: observationWhere(req, q),
      include: { project: { select: { code: true, name: true } }, alignment: { select: { name: true, roadRef: true } }, createdBy: { select: { name: true } } },
      orderBy: [{ observedAt: "desc" }, { chainageM: "asc" }],
      take: q.limit,
    });
    const header = ["Project code", "Project", "Road", "Road ref", "Chainage m", "Side", "Offset m", "Category", "Status", "Title", "Description", "Latitude", "Longitude", "GPS accuracy m", "Observed at", "Recorded by", "Photos"];
    const csv = [
      header.map(csvCell).join(","),
      ...rows.map((row) => [
        row.project.code,
        row.project.name,
        row.alignment.name,
        row.alignment.roadRef,
        row.chainageM,
        row.side,
        row.offsetM,
        row.category,
        row.status,
        row.title,
        row.description,
        row.latitude,
        row.longitude,
        row.gpsAccuracyM,
        row.observedAt.toISOString(),
        row.createdBy.name,
        row.photoIds.length,
      ].map(csvCell).join(",")),
    ].join("\n");
    reply.header("Content-Disposition", `attachment; filename="chainage-observations-${new Date().toISOString().slice(0, 10)}.csv"`);
    reply.type("text/csv; charset=utf-8");
    return csv;
  });

  app.post("/observations", { preHandler: authed }, async (req, reply) => {
    const denied = requireChainage(req, reply); if (denied) return denied;
    const body = observationBody.parse(req.body);
    await requireOrganisationProject(app, req, body.projectId);
    const validationError = await validateObservationUpdate(app, req, body.projectId, body);
    if (validationError) return reply.code(validationError.startsWith("Chainage") ? 409 : 400).send({ error: validationError });
    const observation = await app.prisma.chainageObservation.create({
      data: { ...body, createdById: req.auth.userId },
      include: { project: { select: { id: true, code: true, name: true } }, alignment: true, createdBy: { select: { id: true, name: true, role: true } } },
    });
    await audit(app, req, "CREATE", "ChainageObservation", observation.id, observation);
    return reply.code(201).send(observation);
  });

  app.get("/observations/:id", { preHandler: authed }, async (req, reply) => {
    const denied = requireChainage(req, reply); if (denied) return denied;
    const { id } = uuidParam.parse(req.params);
    const observation = await app.prisma.chainageObservation.findFirstOrThrow({
      where: { id, project: { organisationId: req.auth.organisationId } },
      include: {
        project: { select: { id: true, code: true, name: true } },
        alignment: true,
        createdBy: { select: { id: true, name: true, role: true } },
      },
    });
    const photos = observation.photoIds.length
      ? await app.prisma.fileAsset.findMany({ where: { id: { in: observation.photoIds }, organisationId: req.auth.organisationId, deletedAt: null }, orderBy: { createdAt: "asc" } })
      : [];
    return { ...observation, photos };
  });

  app.patch("/observations/:id", { preHandler: authed }, async (req, reply) => {
    const denied = requireChainage(req, reply); if (denied) return denied;
    const { id } = uuidParam.parse(req.params);
    const body = observationPatchBody.parse(req.body);
    const observation = await app.prisma.chainageObservation.findFirstOrThrow({
      where: { id, project: { organisationId: req.auth.organisationId } },
    });
    const nextProjectId = observation.projectId;
    const validationError = await validateObservationUpdate(app, req, nextProjectId, {
      alignmentId: body.alignmentId ?? observation.alignmentId,
      chainageM: body.chainageM !== undefined ? body.chainageM : Number(observation.chainageM),
      photoIds: body.photoIds,
    });
    if (validationError) return reply.code(validationError.startsWith("Chainage") ? 409 : 400).send({ error: validationError });
    const updated = await app.prisma.chainageObservation.update({
      where: { id: observation.id },
      data: body,
      include: { project: { select: { id: true, code: true, name: true } }, alignment: true, createdBy: { select: { id: true, name: true, role: true } } },
    });
    await audit(app, req, "UPDATE", "ChainageObservation", id, { before: observation, after: updated });
    return updated;
  });

  app.patch("/observations/:id/status", { preHandler: authed }, async (req, reply) => {
    const denied = requireChainage(req, reply); if (denied) return denied;
    const { id } = uuidParam.parse(req.params);
    const body = z.object({ status: observationStatus }).parse(req.body);
    const observation = await app.prisma.chainageObservation.findFirstOrThrow({ where: { id, project: { organisationId: req.auth.organisationId } } });
    const updated = await app.prisma.chainageObservation.update({ where: { id: observation.id }, data: { status: body.status } });
    await audit(app, req, "STATUS_CHANGE", "ChainageObservation", id, { previousStatus: observation.status, status: body.status });
    return updated;
  });

  app.delete("/observations/:id", { preHandler: authed }, async (req, reply) => {
    const denied = requireChainage(req, reply); if (denied) return denied;
    const { id } = uuidParam.parse(req.params);
    const observation = await app.prisma.chainageObservation.findFirstOrThrow({ where: { id, project: { organisationId: req.auth.organisationId } } });
    await app.prisma.chainageObservation.delete({ where: { id: observation.id } });
    await audit(app, req, "DELETE", "ChainageObservation", id, observation);
    return reply.code(204).send();
  });
};

export default routes;
