-- Track where workers are currently assigned, matching plant current project assignment.
SET search_path TO public;

ALTER TABLE "Worker" ADD COLUMN IF NOT EXISTS "currentProjectId" TEXT;
ALTER TABLE "Worker" ADD COLUMN IF NOT EXISTS "currentProjectAssignedAt" TIMESTAMP(3);

-- Track how long plant has been assigned to its current project.
ALTER TABLE "Plant" ADD COLUMN IF NOT EXISTS "currentProjectAssignedAt" TIMESTAMP(3);

-- Support parent projects and sub-projects/work packages.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "parentProjectId" TEXT;

CREATE INDEX IF NOT EXISTS "Worker_organisationId_currentProjectId_idx" ON "Worker"("organisationId", "currentProjectId");
CREATE INDEX IF NOT EXISTS "Project_organisationId_parentProjectId_idx" ON "Project"("organisationId", "parentProjectId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE c.conname = 'Worker_currentProjectId_fkey'
      AND n.nspname = 'public'
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
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE c.conname = 'Project_parentProjectId_fkey'
      AND n.nspname = 'public'
  ) THEN
    ALTER TABLE "Project" ADD CONSTRAINT "Project_parentProjectId_fkey"
      FOREIGN KEY ("parentProjectId") REFERENCES "Project"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
