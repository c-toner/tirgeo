import type { FastifyPluginAsync } from "fastify";
import { AccountSection } from "@prisma/client";
import { z } from "zod";
import { requireOrganisationProject, requireSection } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { civilLocation, materialDocket, productionQuantity } from "../lib/civil.js";

const routes: FastifyPluginAsync = async app => {
  app.post("/daily-reports", { preHandler: requireSection(AccountSection.DAILY_REPORT) }, async (req, reply) => {
    const b = z.object({
      projectId: z.string().uuid(),
      reportDate: z.coerce.date(),
      weather: z.record(z.any()).optional(),
      personnel: z.array(z.any()),
      plant: z.array(z.any()),
      activities: z.array(z.any()),
      quantities: z.array(z.any()).optional(),
      productionActuals: z.array(productionQuantity).optional(),
      locationReferences: z.array(civilLocation).optional(),
      materialDockets: z.array(materialDocket).optional(),
      voiceTranscript: z.string().max(50_000).optional(),
      delays: z.array(z.any()).optional(),
      visitors: z.array(z.any()).optional(),
      safetyNotes: z.string().optional(),
      photos: z.array(z.string()).optional(),
    }).parse(req.body);
    await requireOrganisationProject(app, req, b.projectId);
    if (b.productionActuals?.some(actual => actual.costCodeId)) {
      const costCodeIds = [...new Set(b.productionActuals.flatMap(actual => actual.costCodeId ? [actual.costCodeId] : []))];
      const count = await app.prisma.costCode.count({ where: { id: { in: costCodeIds }, projectId: b.projectId } });
      if (count !== costCodeIds.length) return reply.code(400).send({ error: "Every production actual cost code must belong to the project" });
    }
    const { productionActuals, ...reportBody } = b;
    const report = await app.prisma.$transaction(async tx => {
      const dailyReport = await tx.dailyReport.create({ data: { ...reportBody, submittedById: req.auth.userId } });
      if (productionActuals?.length) await tx.productionActual.createMany({ data: productionActuals.map(actual => ({
        projectId: b.projectId,
        dailyReportId: dailyReport.id,
        costCodeId: actual.costCodeId,
        activity: actual.activity,
        quantity: actual.quantity,
        unit: actual.unit,
        workHours: actual.workHours,
        plantHours: actual.plantHours,
        location: actual.location,
        materialType: actual.materialType,
        groundCondition: actual.groundCondition,
        createdById: req.auth.userId,
      })) });
      return tx.dailyReport.findUniqueOrThrow({ where: { id: dailyReport.id }, include: { productionActuals: true } });
    });
    await audit(app, req, "CREATE", "DailyReport", report.id, report); return reply.code(201).send(report);
  });

  app.get("/projects/:projectId/production-actuals", { preHandler: requireSection(AccountSection.DAILY_REPORT) }, async req => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(req.params);
    const q = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), costCodeId: z.string().uuid().optional() }).parse(req.query);
    await requireOrganisationProject(app, req, projectId);
    return app.prisma.productionActual.findMany({
      where: { projectId, costCodeId: q.costCodeId, capturedAt: { gte: q.from, lte: q.to } },
      include: { costCode: true },
      orderBy: { capturedAt: "desc" },
    });
  });
};
export default routes;
