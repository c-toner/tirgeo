import type { FastifyPluginAsync } from "fastify";
import { AccountSection } from "@prisma/client";
import { z } from "zod";
import { authed } from "../lib/access.js";

const routes: FastifyPluginAsync = async app => {
  app.get("/", { preHandler: authed }, async req => {
    const q = z.object({ search: z.string().trim().min(1).max(80).optional(), includeInactive: z.coerce.boolean().optional() }).parse(req.query);
    const search = q.search;
    const workers = await app.prisma.worker.findMany({
      where: {
        organisationId: req.auth.organisationId,
        userId: req.auth.sections.includes(AccountSection.WORKER_DIRECTORY) ? undefined : req.auth.userId,
        terminationDate: q.includeInactive ? undefined : null,
        OR: search
          ? [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { employeeNumber: { contains: search, mode: "insensitive" } },
              { classification: { contains: search, mode: "insensitive" } },
            ]
          : undefined,
      },
      select: {
        id: true,
        userId: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        employmentType: true,
        classification: true,
        terminationDate: true,
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { employeeNumber: "asc" }],
      take: 100,
    });
    return workers
      .map(worker => ({ ...worker, isCurrentUser: worker.userId === req.auth.userId }))
      .sort((a, b) => Number(b.isCurrentUser) - Number(a.isCurrentUser) || `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
  });

  app.get("/me", { preHandler: authed }, async req => {
    const worker = await app.prisma.worker.findFirst({
      where: { organisationId: req.auth.organisationId, userId: req.auth.userId, terminationDate: null },
      select: {
        id: true,
        userId: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        employmentType: true,
        classification: true,
        terminationDate: true,
      },
    });
    return worker ? { ...worker, isCurrentUser: true } : null;
  });
};

export default routes;
