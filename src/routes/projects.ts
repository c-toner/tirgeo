import type { FastifyPluginAsync } from "fastify";
import { ProjectStatus, Role } from "@prisma/client";
import { z } from "zod";
import { allow, authed } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { civilLocation } from "../lib/civil.js";
import { canTransitionProject } from "../lib/project.js";

const geofencePoint = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });
const createProject = z.object({ code: z.string().min(1).max(30), name: z.string().min(2), clientName: z.string().optional(), description: z.string().optional(), jurisdiction: z.enum(["ACT","NSW","NT","QLD","SA","TAS","VIC","WA"]), address: z.string().optional(), alignment: z.array(civilLocation).optional(), geofence: z.array(geofencePoint).min(3).optional(), contractValue: z.coerce.number().nonnegative().optional(), startDate: z.coerce.date().optional(), endDate: z.coerce.date().optional() }).refine(v => !v.startDate || !v.endDate || v.endDate >= v.startDate, "endDate must be on or after startDate");
const routes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: authed }, async req => app.prisma.project.findMany({ where: { organisationId: req.auth.organisationId }, orderBy: { code: "asc" } }));
  app.post("/", { preHandler: allow(Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER) }, async (req, reply) => {
    const body = createProject.parse(req.body);
    const project = await app.prisma.project.create({ data: { ...body, contractValue: body.contractValue, organisationId: req.auth.organisationId } });
    await audit(app, req, "CREATE", "Project", project.id, project);
    return reply.code(201).send(project);
  });
  app.patch("/:id/status", { preHandler: allow(Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER) }, async req => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params); const { status } = z.object({ status: z.nativeEnum(ProjectStatus) }).parse(req.body);
    const existing = await app.prisma.project.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId } });
    if (!canTransitionProject(existing.status, status)) throw Object.assign(new Error(`Cannot move project from ${existing.status} to ${status}`), { statusCode: 409 });
    const project = await app.prisma.project.update({ where: { id }, data: { status } });
    await audit(app, req, "STATUS_CHANGE", "Project", id, project); return project;
  });
};
export default routes;
