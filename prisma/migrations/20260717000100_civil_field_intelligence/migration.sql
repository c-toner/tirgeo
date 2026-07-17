ALTER TABLE "Project" ADD COLUMN "alignment" JSONB;
ALTER TABLE "Project" ADD COLUMN "geofence" JSONB;

ALTER TABLE "DailyReport" ADD COLUMN "locationReferences" JSONB;
ALTER TABLE "DailyReport" ADD COLUMN "materialDockets" JSONB;
ALTER TABLE "DailyReport" ADD COLUMN "voiceTranscript" TEXT;

CREATE TABLE "ProductionActual" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "dailyReportId" TEXT,
  "costCodeId" TEXT,
  "activity" TEXT NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL,
  "unit" TEXT NOT NULL,
  "workHours" DECIMAL(10,2),
  "plantHours" DECIMAL(10,2),
  "location" JSONB,
  "materialType" TEXT,
  "groundCondition" TEXT,
  "source" TEXT NOT NULL DEFAULT 'DAILY_REPORT',
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT NOT NULL,

  CONSTRAINT "ProductionActual_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlantTelemetryReading" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "plantId" TEXT NOT NULL,
  "projectId" TEXT,
  "source" TEXT NOT NULL,
  "externalMachineId" TEXT,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "engineHours" DECIMAL(12,2),
  "idleHours" DECIMAL(12,2),
  "fuelLitres" DECIMAL(12,2),
  "odometerKm" INTEGER,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "payload" JSONB,

  CONSTRAINT "PlantTelemetryReading_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductionActual_projectId_capturedAt_idx" ON "ProductionActual"("projectId", "capturedAt");
CREATE INDEX "ProductionActual_costCodeId_capturedAt_idx" ON "ProductionActual"("costCodeId", "capturedAt");
CREATE INDEX "ProductionActual_dailyReportId_idx" ON "ProductionActual"("dailyReportId");

CREATE INDEX "PlantTelemetryReading_organisationId_source_capturedAt_idx" ON "PlantTelemetryReading"("organisationId", "source", "capturedAt");
CREATE INDEX "PlantTelemetryReading_plantId_capturedAt_idx" ON "PlantTelemetryReading"("plantId", "capturedAt");
CREATE INDEX "PlantTelemetryReading_projectId_capturedAt_idx" ON "PlantTelemetryReading"("projectId", "capturedAt");

ALTER TABLE "ProductionActual" ADD CONSTRAINT "ProductionActual_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionActual" ADD CONSTRAINT "ProductionActual_dailyReportId_fkey" FOREIGN KEY ("dailyReportId") REFERENCES "DailyReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductionActual" ADD CONSTRAINT "ProductionActual_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlantTelemetryReading" ADD CONSTRAINT "PlantTelemetryReading_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlantTelemetryReading" ADD CONSTRAINT "PlantTelemetryReading_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlantTelemetryReading" ADD CONSTRAINT "PlantTelemetryReading_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
