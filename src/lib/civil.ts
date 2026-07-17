import { z } from "zod";

export const civilLocation = z.object({
  alignment: z.string().min(1).max(120).optional(),
  chainageStartM: z.number().nonnegative().optional(),
  chainageEndM: z.number().nonnegative().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  description: z.string().max(500).optional(),
}).superRefine((value, ctx) => {
  if (value.chainageStartM !== undefined && value.chainageEndM !== undefined && value.chainageEndM < value.chainageStartM) {
    ctx.addIssue({ code: "custom", message: "chainageEndM must be greater than or equal to chainageStartM", path: ["chainageEndM"] });
  }
  const hasChainage = value.chainageStartM !== undefined || value.chainageEndM !== undefined;
  const hasGpsPair = value.latitude !== undefined && value.longitude !== undefined;
  const hasGpsPartial = value.latitude !== undefined || value.longitude !== undefined;
  if (hasGpsPartial && !hasGpsPair) ctx.addIssue({ code: "custom", message: "latitude and longitude must be supplied together" });
  if (!hasChainage && !hasGpsPair && !value.description) ctx.addIssue({ code: "custom", message: "Provide chainage, GPS coordinates, or a description" });
});

export const productionQuantity = z.object({
  costCodeId: z.string().uuid().optional(),
  activity: z.string().min(1).max(160),
  quantity: z.number().nonnegative(),
  unit: z.string().min(1).max(30),
  workHours: z.number().nonnegative().optional(),
  plantHours: z.number().nonnegative().optional(),
  location: civilLocation.optional(),
  materialType: z.string().min(1).max(120).optional(),
  groundCondition: z.string().min(1).max(120).optional(),
});

export const materialDocket = z.object({
  docketNumber: z.string().min(1).max(100).optional(),
  supplier: z.string().min(1).max(160).optional(),
  materialType: z.string().min(1).max(120),
  massTonnes: z.number().nonnegative().optional(),
  volumeM3: z.number().nonnegative().optional(),
  photoFileId: z.string().uuid().optional(),
  rawText: z.string().max(10_000).optional(),
  confidence: z.number().min(0).max(1).optional(),
}).refine(value => value.massTonnes !== undefined || value.volumeM3 !== undefined || value.rawText, "Provide mass, volume, or OCR text");

export const plantTelemetryReading = z.object({
  projectId: z.string().uuid().optional(),
  source: z.string().min(1).max(80),
  externalMachineId: z.string().max(160).optional(),
  capturedAt: z.coerce.date(),
  engineHours: z.number().nonnegative().optional(),
  idleHours: z.number().nonnegative().optional(),
  fuelLitres: z.number().nonnegative().optional(),
  odometerKm: z.number().int().nonnegative().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  payload: z.record(z.any()).optional(),
}).superRefine((value, ctx) => {
  if ((value.latitude === undefined) !== (value.longitude === undefined)) ctx.addIssue({ code: "custom", message: "latitude and longitude must be supplied together" });
  if (value.engineHours === undefined && value.idleHours === undefined && value.fuelLitres === undefined && value.odometerKm === undefined) {
    ctx.addIssue({ code: "custom", message: "Provide at least one telemetry measurement" });
  }
});
