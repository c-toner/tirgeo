DROP INDEX IF EXISTS "Timesheet_projectId_workerId_weekEnding_revision_key";
CREATE INDEX IF NOT EXISTS "Timesheet_projectId_workerId_weekEnding_idx" ON "Timesheet"("projectId", "workerId", "weekEnding");

ALTER TABLE "PlantPreStart" ADD COLUMN "photoIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
