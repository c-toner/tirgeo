-- Repair migration for databases where the project resource migration was
-- recorded as applied but one or more physical columns were not created.
-- Every statement is guarded so this is safe on databases that already have
-- the expected schema.

ALTER TABLE "Worker" ADD COLUMN IF NOT EXISTS "currentProjectId" TEXT;
ALTER TABLE "Worker" ADD COLUMN IF NOT EXISTS "currentProjectAssignedAt" TIMESTAMP(3);

ALTER TABLE "Plant" ADD COLUMN IF NOT EXISTS "currentProjectAssignedAt" TIMESTAMP(3);

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "parentProjectId" TEXT;

CREATE INDEX IF NOT EXISTS "Worker_organisationId_currentProjectId_idx"
  ON "Worker"("organisationId", "currentProjectId");

CREATE INDEX IF NOT EXISTS "Project_organisationId_parentProjectId_idx"
  ON "Project"("organisationId", "parentProjectId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Worker_currentProjectId_fkey'
  ) THEN
    ALTER TABLE "Worker" ADD CONSTRAINT "Worker_currentProjectId_fkey"
      FOREIGN KEY ("currentProjectId") REFERENCES "Project"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Project_parentProjectId_fkey'
  ) THEN
    ALTER TABLE "Project" ADD CONSTRAINT "Project_parentProjectId_fkey"
      FOREIGN KEY ("parentProjectId") REFERENCES "Project"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
