ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OPERATIONS_MANAGER';

ALTER TABLE "Plant" ADD COLUMN "currentProjectId" TEXT;

ALTER TABLE "Plant"
  ADD CONSTRAINT "Plant_currentProjectId_fkey"
  FOREIGN KEY ("currentProjectId") REFERENCES "Project"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Plant_organisationId_currentProjectId_idx" ON "Plant"("organisationId", "currentProjectId");
