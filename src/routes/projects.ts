import type { FastifyPluginAsync } from "fastify";
import { ProjectStatus, Role } from "@prisma/client";
import { z } from "zod";
import { allow, authed } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { civilLocation } from "../lib/civil.js";
import { canTransitionProject } from "../lib/project.js";

const geofencePoint = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });
const createProject = z.object({ parentProjectId: z.string().uuid().optional(), code: z.string().min(1).max(30), name: z.string().min(2), clientName: z.string().optional(), description: z.string().optional(), jurisdiction: z.enum(["ACT","NSW","NT","QLD","SA","TAS","VIC","WA"]), address: z.string().optional(), alignment: z.array(civilLocation).optional(), geofence: z.array(geofencePoint).min(3).optional(), contractValue: z.coerce.number().nonnegative().optional(), startDate: z.coerce.date().optional(), endDate: z.coerce.date().optional() }).refine(v => !v.startDate || !v.endDate || v.endDate >= v.startDate, "endDate must be on or after startDate");
const projectManagers = [Role.OWNER, Role.ADMIN, Role.PROJECT_MANAGER, Role.OPERATIONS_MANAGER];
const routes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: authed }, async req => app.prisma.project.findMany({
    where: { organisationId: req.auth.organisationId },
    include: {
      currentWorkers: { where: { terminationDate: null }, select: { id: true, employeeNumber: true, firstName: true, lastName: true, employmentType: true, classification: true, currentProjectId: true, currentProjectAssignedAt: true } },
      currentPlant: { select: { id: true, assetNumber: true, type: true, make: true, model: true, status: true, currentProjectId: true, currentProjectAssignedAt: true } },
      parentProject: { select: { id: true, code: true, name: true } },
      subProjects: { select: { id: true, code: true, name: true, status: true }, orderBy: { code: "asc" } },
      dailyReports: { select: { id: true, reportDate: true, status: true, activities: true, submittedById: true }, orderBy: { reportDate: "desc" }, take: 5 },
      productionActuals: { select: { id: true, activity: true, quantity: true, unit: true, capturedAt: true }, orderBy: { capturedAt: "desc" }, take: 5 },
      dockets: { select: { id: true, docketType: true, docketDate: true, status: true, totalAmount: true, currency: true, description: true, lines: { select: { id: true, code: true, description: true, quantity: true, unit: true, lineAmount: true } } }, orderBy: { docketDate: "desc" }, take: 5 },
    },
    orderBy: { code: "asc" },
  }));
  app.post("/", { preHandler: allow(...projectManagers) }, async (req, reply) => {
    const body = createProject.parse(req.body);
    if (body.parentProjectId) await app.prisma.project.findFirstOrThrow({ where: { id: body.parentProjectId, organisationId: req.auth.organisationId } });
    const project = await app.prisma.project.create({ data: { ...body, contractValue: body.contractValue, organisationId: req.auth.organisationId } });
    await audit(app, req, "CREATE", "Project", project.id, project);
    return reply.code(201).send(project);
  });
  app.patch("/:id/status", { preHandler: allow(...projectManagers) }, async req => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params); const { status } = z.object({ status: z.nativeEnum(ProjectStatus) }).parse(req.body);
    const existing = await app.prisma.project.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId } });
    if (!canTransitionProject(existing.status, status)) throw Object.assign(new Error(`Cannot move project from ${existing.status} to ${status}`), { statusCode: 409 });
    const project = await app.prisma.project.update({ where: { id }, data: { status } });
    await audit(app, req, "STATUS_CHANGE", "Project", id, project); return project;
  });
  app.get("/:id/resources", { preHandler: authed }, async req => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return app.prisma.project.findFirstOrThrow({
      where: { id, organisationId: req.auth.organisationId },
      include: {
        currentWorkers: { where: { terminationDate: null }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }] },
        currentPlant: { orderBy: { assetNumber: "asc" } },
        parentProject: { select: { id: true, code: true, name: true } },
        subProjects: { orderBy: { code: "asc" } },
        dailyReports: { orderBy: { reportDate: "desc" }, take: 20 },
        productionActuals: { orderBy: { capturedAt: "desc" }, take: 20 },
        dockets: { include: { lines: true, worker: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } } }, orderBy: { docketDate: "desc" }, take: 20 },
      },
    });
  });
  app.patch("/:id/resources", { preHandler: allow(...projectManagers) }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ workerIds: z.array(z.string().uuid()).default([]), plantIds: z.array(z.string().uuid()).default([]) }).parse(req.body);
    await app.prisma.project.findFirstOrThrow({ where: { id, organisationId: req.auth.organisationId } });
    const workerIds = [...new Set(body.workerIds)];
    const plantIds = [...new Set(body.plantIds)];
    const [workerCount, plantCount] = await Promise.all([
      workerIds.length ? app.prisma.worker.count({ where: { id: { in: workerIds }, organisationId: req.auth.organisationId, terminationDate: null } }) : 0,
      plantIds.length ? app.prisma.plant.count({ where: { id: { in: plantIds }, organisationId: req.auth.organisationId } }) : 0,
    ]);
    if (workerCount !== workerIds.length) return reply.code(400).send({ error: "All workers must be active and belong to this organisation" });
    if (plantCount !== plantIds.length) return reply.code(400).send({ error: "All plant must belong to this organisation" });
    const assignedAt = new Date();
    const [unassignedWorkers, assignedWorkers, unassignedPlant, assignedPlant] = await app.prisma.$transaction([
      app.prisma.worker.updateMany({ where: { organisationId: req.auth.organisationId, currentProjectId: id, id: { notIn: workerIds } }, data: { currentProjectId: null, currentProjectAssignedAt: null } }),
      app.prisma.worker.updateMany({ where: { organisationId: req.auth.organisationId, id: { in: workerIds }, OR: [{ currentProjectId: null }, { currentProjectId: { not: id } }, { currentProjectAssignedAt: null }] }, data: { currentProjectId: id, currentProjectAssignedAt: assignedAt } }),
      app.prisma.plant.updateMany({ where: { organisationId: req.auth.organisationId, currentProjectId: id, id: { notIn: plantIds } }, data: { currentProjectId: null, currentProjectAssignedAt: null } }),
      app.prisma.plant.updateMany({ where: { organisationId: req.auth.organisationId, id: { in: plantIds }, OR: [{ currentProjectId: null }, { currentProjectId: { not: id } }, { currentProjectAssignedAt: null }] }, data: { currentProjectId: id, currentProjectAssignedAt: assignedAt } }),
    ]);
    await audit(app, req, "RESOURCE_ASSIGNMENT", "Project", id, { workerIds, plantIds, unassignedWorkers: unassignedWorkers.count, assignedWorkers: assignedWorkers.count, unassignedPlant: unassignedPlant.count, assignedPlant: assignedPlant.count });
    return app.prisma.project.findFirstOrThrow({
      where: { id, organisationId: req.auth.organisationId },
      include: { currentWorkers: true, currentPlant: true, subProjects: true, dailyReports: { orderBy: { reportDate: "desc" }, take: 20 }, productionActuals: { orderBy: { capturedAt: "desc" }, take: 20 }, dockets: { include: { lines: true }, orderBy: { docketDate: "desc" }, take: 20 } },
    });
  });
};
export default routes;
