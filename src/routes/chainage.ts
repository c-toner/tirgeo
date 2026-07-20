import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { AccountSection } from "@prisma/client";
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

const observationBody = z.object({
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
}).superRefine((value, ctx) => {
  if ((value.latitude === undefined) !== (value.longitude === undefined)) ctx.addIssue({ code: "custom", message: "latitude and longitude must be supplied together" });
});

function requireChainage(req: FastifyRequest, reply: FastifyReply) {
  if (!req.auth.sections.includes(AccountSection.CHAINAGE)) return reply.code(403).send({ error: "Forbidden" });
  return null;
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
    const q = z.object({
      projectId: z.string().uuid().optional(),
      alignmentId: z.string().uuid().optional(),
      status: observationStatus.optional(),
      search: z.string().trim().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }).parse(req.query);
    if (q.projectId) await requireOrganisationProject(app, req, q.projectId);
    return app.prisma.chainageObservation.findMany({
      where: {
        project: { organisationId: req.auth.organisationId },
        projectId: q.projectId,
        alignmentId: q.alignmentId,
        status: q.status,
        ...(q.search ? { OR: [{ title: { contains: q.search, mode: "insensitive" } }, { description: { contains: q.search, mode: "insensitive" } }, { alignment: { name: { contains: q.search, mode: "insensitive" } } }] } : {}),
      },
      include: {
        project: { select: { id: true, code: true, name: true } },
        alignment: true,
        createdBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { observedAt: "desc" },
      take: q.limit,
    });
  });

  app.post("/observations", { preHandler: authed }, async (req, reply) => {
    const denied = requireChainage(req, reply); if (denied) return denied;
    const body = observationBody.parse(req.body);
    await requireOrganisationProject(app, req, body.projectId);
    const alignment = await app.prisma.chainageAlignment.findFirstOrThrow({ where: { id: body.alignmentId, projectId: body.projectId, project: { organisationId: req.auth.organisationId } } });
    if (body.chainageM < Number(alignment.startChainageM) || body.chainageM > Number(alignment.endChainageM)) return reply.code(409).send({ error: "Chainage must sit inside the selected road alignment range" });
    if (body.photoIds.length) {
      const photoCount = await app.prisma.fileAsset.count({ where: { id: { in: body.photoIds }, organisationId: req.auth.organisationId, deletedAt: null } });
      if (photoCount !== body.photoIds.length) return reply.code(400).send({ error: "Every chainage photo must belong to this organisation" });
    }
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

  app.patch("/observations/:id/status", { preHandler: authed }, async (req, reply) => {
    const denied = requireChainage(req, reply); if (denied) return denied;
    const { id } = uuidParam.parse(req.params);
    const body = z.object({ status: observationStatus }).parse(req.body);
    const observation = await app.prisma.chainageObservation.findFirstOrThrow({ where: { id, project: { organisationId: req.auth.organisationId } } });
    const updated = await app.prisma.chainageObservation.update({ where: { id: observation.id }, data: { status: body.status } });
    await audit(app, req, "STATUS_CHANGE", "ChainageObservation", id, { previousStatus: observation.status, status: body.status });
    return updated;
  });
};

export default routes;
