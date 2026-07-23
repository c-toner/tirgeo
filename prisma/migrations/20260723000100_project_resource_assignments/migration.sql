-- Track where workers are currently assigned, matching plant current project assignment.
ALTER TABLE "Worker" ADD COLUMN "currentProjectId" TEXT;
ALTER TABLE "Worker" ADD COLUMN "currentProjectAssignedAt" TIMESTAMP(3);

-- Track how long plant has been assigned to its current project.
ALTER TABLE "Plant" ADD COLUMN "currentProjectAssignedAt" TIMESTAMP(3);

-- Support parent projects and sub-projects/work packages.
ALTER TABLE "Project" ADD COLUMN "parentProjectId" TEXT;

CREATE INDEX "Worker_organisationId_currentProjectId_idx" ON "Worker"("organisationId", "currentProjectId");
CREATE INDEX "Project_organisationId_parentProjectId_idx" ON "Project"("organisationId", "parentProjectId");

ALTER TABLE "Worker" ADD CONSTRAINT "Worker_currentProjectId_fkey"
  FOREIGN KEY ("currentProjectId") REFERENCES "Project"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Project" ADD CONSTRAINT "Project_parentProjectId_fkey"
  FOREIGN KEY ("parentProjectId") REFERENCES "Project"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
