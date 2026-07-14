import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authed, requireOrganisationProject } from "../lib/access.js";
import { audit } from "../lib/audit.js";

const routes: FastifyPluginAsync = async app => {
  app.post("/daily-reports", { preHandler: authed }, async (req, reply) => {
    const b = z.object({ projectId: z.string().uuid(), reportDate: z.coerce.date(), weather: z.record(z.any()).optional(), personnel: z.array(z.any()), plant: z.array(z.any()), activities: z.array(z.any()), quantities: z.array(z.any()).optional(), delays: z.array(z.any()).optional(), visitors: z.array(z.any()).optional(), safetyNotes: z.string().optional(), photos: z.array(z.string()).optional() }).parse(req.body);
    await requireOrganisationProject(app, req, b.projectId);
    const report = await app.prisma.dailyReport.create({ data: { ...b, submittedById: req.auth.userId } }); await audit(app, req, "CREATE", "DailyReport", report.id, report); return reply.code(201).send(report);
  });
};
export default routes;
