import type { FastifyInstance } from "fastify";
import { CostEntryType, Prisma } from "@prisma/client";

function dateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") return value.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function missingDailyCostSchema(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2021" || error.code === "P2022") && String(error.message).includes("DailyProjectCost");
}

async function draftForDate(app: FastifyInstance, organisationId: string, projectId: string, costDate: Date) {
  return app.prisma.dailyProjectCostDraft.upsert({
    where: { projectId_costDate: { projectId, costDate: dateOnly(costDate) } },
    create: { organisationId, projectId, costDate: dateOnly(costDate) },
    update: {},
  });
}

export async function syncTimeEntryDailyCost(app: FastifyInstance, organisationId: string, projectId: string, worker: { id: string; firstName: string; lastName: string; baseHourlyRate?: unknown }, entry: { id: string; workDate: Date; ordinaryMinutes: number; overtimeMinutes: number; costCodeId?: string | null }) {
  try {
    const draft = await draftForDate(app, organisationId, projectId, entry.workDate);
    const hours = Number(((entry.ordinaryMinutes + entry.overtimeMinutes) / 60).toFixed(2));
    const unitRate = toNumber(worker.baseHourlyRate);
    await app.prisma.dailyProjectCostLine.upsert({
      where: { draftId_source_sourceId: { draftId: draft.id, source: "TIMESHEET", sourceId: entry.id } },
      create: {
        draftId: draft.id,
        costCodeId: entry.costCodeId ?? undefined,
        type: CostEntryType.LABOUR,
        source: "TIMESHEET",
        sourceId: entry.id,
        workerId: worker.id,
        description: `${worker.firstName} ${worker.lastName}`,
        quantity: hours,
        unit: "hr",
        unitRate: unitRate || undefined,
        amount: Number((hours * unitRate).toFixed(2)),
      },
      update: {
        costCodeId: entry.costCodeId ?? undefined,
        workerId: worker.id,
        description: `${worker.firstName} ${worker.lastName}`,
        quantity: hours,
        unitRate: unitRate || undefined,
        amount: Number((hours * unitRate).toFixed(2)),
      },
    });
  } catch (error) {
    if (missingDailyCostSchema(error)) {
      app.log.warn({ err: error }, "Daily cost draft tables missing; skipped timecard cost sync");
      return;
    }
    throw error;
  }
}

export async function syncPreStartDailyCost(app: FastifyInstance, organisationId: string, projectId: string, plant: { id: string; assetNumber: string; type: string }, preStart: { id: string; inspectedAt: Date }) {
  try {
    const draft = await draftForDate(app, organisationId, projectId, preStart.inspectedAt);
    await app.prisma.dailyProjectCostLine.upsert({
      where: { draftId_source_sourceId: { draftId: draft.id, source: "PRESTART", sourceId: preStart.id } },
      create: {
        draftId: draft.id,
        type: CostEntryType.PLANT,
        source: "PRESTART",
        sourceId: preStart.id,
        plantId: plant.id,
        description: `${plant.assetNumber} - ${plant.type}`,
        quantity: 0,
        unit: "hr",
        amount: 0,
      },
      update: {
        plantId: plant.id,
        description: `${plant.assetNumber} - ${plant.type}`,
      },
    });
  } catch (error) {
    if (missingDailyCostSchema(error)) {
      app.log.warn({ err: error }, "Daily cost draft tables missing; skipped pre-start cost sync");
      return;
    }
    throw error;
  }
}
