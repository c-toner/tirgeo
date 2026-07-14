CREATE TYPE "HseqDomain" AS ENUM ('HEALTH', 'SAFETY', 'ENVIRONMENT', 'QUALITY');
CREATE TYPE "HazardStatus" AS ENUM ('IDENTIFIED', 'ASSESSED', 'CONTROLLED', 'CLOSED');
CREATE TYPE "ControlType" AS ENUM ('ELIMINATION', 'SUBSTITUTION', 'ISOLATION', 'ENGINEERING', 'ADMINISTRATIVE', 'PPE');
CREATE TYPE "HseqInspectionType" AS ENUM ('SITE_WALK', 'PRE_START', 'ENVIRONMENTAL', 'QUALITY_AUDIT', 'HSEQ_AUDIT', 'PLANT');
CREATE TYPE "SafetyObservationType" AS ENUM ('HAZARD', 'NEAR_MISS', 'UNSAFE_ACT', 'POSITIVE_BEHAVIOUR', 'ENVIRONMENTAL', 'QUALITY');
CREATE TYPE "PermitType" AS ENUM ('HOT_WORK', 'CONFINED_SPACE', 'EXCAVATION', 'WORKING_AT_HEIGHT', 'LIFTING', 'ELECTRICAL_ISOLATION', 'TRAFFIC_CONTROL', 'ENVIRONMENTAL', 'OTHER');
CREATE TYPE "PermitStatus" AS ENUM ('DRAFT', 'REQUESTED', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'CANCELLED');

ALTER TABLE "CorrectiveAction"
  ADD COLUMN "priority" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "status" "Status" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "source" TEXT,
  ADD COLUMN "completionNotes" TEXT,
  ADD COLUMN "hazardId" TEXT,
  ADD COLUMN "observationId" TEXT,
  ADD COLUMN "inspectionId" TEXT,
  ADD COLUMN "permitId" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "HazardRegisterItem" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "domain" "HseqDomain" NOT NULL DEFAULT 'SAFETY',
  "activity" TEXT,
  "location" TEXT,
  "riskLevel" "RiskLevel" NOT NULL,
  "residualRiskLevel" "RiskLevel",
  "status" "HazardStatus" NOT NULL DEFAULT 'IDENTIFIED',
  "legalReference" TEXT,
  "reviewDueAt" TIMESTAMP(3),
  "identifiedById" TEXT NOT NULL,
  "identifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "HazardRegisterItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ControlMeasure" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "hazardId" TEXT,
  "type" "ControlType" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "ownerId" TEXT,
  "verificationMethod" TEXT,
  "implementedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "verifiedById" TEXT,
  "reviewDueAt" TIMESTAMP(3),
  "effectiveness" TEXT,
  "evidenceDocumentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ControlMeasure_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SafetyObservation" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "type" "SafetyObservationType" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "location" TEXT,
  "riskLevel" "RiskLevel",
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reportedById" TEXT NOT NULL,
  "photos" JSONB,
  "immediateAction" TEXT,
  "status" "Status" NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "SafetyObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HseqInspection" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "type" "HseqInspectionType" NOT NULL,
  "title" TEXT NOT NULL,
  "location" TEXT,
  "scheduledAt" TIMESTAMP(3),
  "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "inspectedById" TEXT NOT NULL,
  "score" INTEGER,
  "result" "InspectionResult",
  "status" "Status" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "photos" JSONB,
  CONSTRAINT "HseqInspection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HseqInspectionItem" (
  "id" TEXT NOT NULL,
  "inspectionId" TEXT NOT NULL,
  "section" TEXT,
  "question" TEXT NOT NULL,
  "result" "InspectionResult" NOT NULL,
  "notes" TEXT,
  "hazardId" TEXT,
  "correctiveActionRequired" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "HseqInspectionItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PermitToWork" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "type" "PermitType" NOT NULL,
  "title" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "approvedById" TEXT,
  "status" "PermitStatus" NOT NULL DEFAULT 'DRAFT',
  "startsAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "isolationDetails" JSONB,
  "hazards" JSONB,
  "controls" JSONB,
  "signOns" JSONB,
  "attachments" JSONB,
  CONSTRAINT "PermitToWork_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CorrectiveAction_projectId_status_dueAt_idx" ON "CorrectiveAction"("projectId", "status", "dueAt");
CREATE INDEX "CorrectiveAction_ownerId_status_dueAt_idx" ON "CorrectiveAction"("ownerId", "status", "dueAt");
CREATE INDEX "HazardRegisterItem_organisationId_status_riskLevel_idx" ON "HazardRegisterItem"("organisationId", "status", "riskLevel");
CREATE INDEX "HazardRegisterItem_projectId_status_reviewDueAt_idx" ON "HazardRegisterItem"("projectId", "status", "reviewDueAt");
CREATE INDEX "ControlMeasure_organisationId_type_reviewDueAt_idx" ON "ControlMeasure"("organisationId", "type", "reviewDueAt");
CREATE INDEX "ControlMeasure_projectId_hazardId_idx" ON "ControlMeasure"("projectId", "hazardId");
CREATE INDEX "SafetyObservation_organisationId_type_status_observedAt_idx" ON "SafetyObservation"("organisationId", "type", "status", "observedAt");
CREATE INDEX "SafetyObservation_projectId_observedAt_idx" ON "SafetyObservation"("projectId", "observedAt");
CREATE INDEX "HseqInspection_organisationId_type_status_inspectedAt_idx" ON "HseqInspection"("organisationId", "type", "status", "inspectedAt");
CREATE INDEX "HseqInspection_projectId_inspectedAt_idx" ON "HseqInspection"("projectId", "inspectedAt");
CREATE INDEX "HseqInspectionItem_inspectionId_result_idx" ON "HseqInspectionItem"("inspectionId", "result");
CREATE INDEX "PermitToWork_organisationId_type_status_startsAt_idx" ON "PermitToWork"("organisationId", "type", "status", "startsAt");
CREATE INDEX "PermitToWork_projectId_status_expiresAt_idx" ON "PermitToWork"("projectId", "status", "expiresAt");

ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_hazardId_fkey" FOREIGN KEY ("hazardId") REFERENCES "HazardRegisterItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "SafetyObservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "HseqInspection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_permitId_fkey" FOREIGN KEY ("permitId") REFERENCES "PermitToWork"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HazardRegisterItem" ADD CONSTRAINT "HazardRegisterItem_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HazardRegisterItem" ADD CONSTRAINT "HazardRegisterItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ControlMeasure" ADD CONSTRAINT "ControlMeasure_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ControlMeasure" ADD CONSTRAINT "ControlMeasure_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ControlMeasure" ADD CONSTRAINT "ControlMeasure_hazardId_fkey" FOREIGN KEY ("hazardId") REFERENCES "HazardRegisterItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SafetyObservation" ADD CONSTRAINT "SafetyObservation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SafetyObservation" ADD CONSTRAINT "SafetyObservation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HseqInspection" ADD CONSTRAINT "HseqInspection_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HseqInspection" ADD CONSTRAINT "HseqInspection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HseqInspectionItem" ADD CONSTRAINT "HseqInspectionItem_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "HseqInspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PermitToWork" ADD CONSTRAINT "PermitToWork_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PermitToWork" ADD CONSTRAINT "PermitToWork_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
