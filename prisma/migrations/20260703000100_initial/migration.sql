-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'PROJECT_MANAGER', 'SUPERVISOR', 'FOREMAN', 'SAFETY_MANAGER', 'PAYROLL', 'WORKER', 'SUBCONTRACTOR', 'CLIENT_AUDITOR');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ACTIVE', 'INACTIVE', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('TENDER', 'AWARDED', 'MOBILISING', 'ACTIVE', 'ON_HOLD', 'PRACTICAL_COMPLETION', 'DEFECTS_LIABILITY', 'CLOSED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'EXTREME');

-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PASS', 'DEFECT', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "AccountingProvider" AS ENUM ('XERO', 'MYOB');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('DISCONNECTED', 'CONFIGURED', 'CONNECTED', 'NEEDS_ATTENTION');

-- CreateEnum
CREATE TYPE "PayrollExportStatus" AS ENUM ('QUEUED', 'READY', 'SENDING', 'SENT', 'RECONCILED', 'FAILED');

-- CreateEnum
CREATE TYPE "TimesheetSignatureType" AS ENUM ('EMPLOYEE', 'APPROVER');

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abn" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Australia/Sydney',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingConnection" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "provider" "AccountingProvider" NOT NULL,
    "externalTenantId" TEXT NOT NULL,
    "displayName" TEXT,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "connectedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "settings" JSONB,

    CONSTRAINT "AccountingConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollEmployeeMapping" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "externalEmployeeId" TEXT NOT NULL,

    CONSTRAINT "PayrollEmployeeMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPayItemMapping" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "localCode" TEXT NOT NULL,
    "externalPayItemId" TEXT NOT NULL,

    CONSTRAINT "PayrollPayItemMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollExport" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "PayrollExportStatus" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB,
    "externalReference" TEXT,
    "failureReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),

    CONSTRAINT "PayrollExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollExportItem" (
    "id" TEXT NOT NULL,
    "payrollExportId" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "externalReference" TEXT,

    CONSTRAINT "PayrollExportItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPulledCursor" TIMESTAMP(3),
    "lastPulledEventId" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Device_pkey" PRIMARY KEY ("organisationId","id")
);

-- CreateTable
CREATE TABLE "MutationReceipt" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "response" JSONB NOT NULL,

    CONSTRAINT "MutationReceipt_pkey" PRIMARY KEY ("organisationId","id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signaturePinHash" TEXT,
    "signaturePinSetAt" TIMESTAMP(3),
    "signaturePinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
    "signaturePinLockedUntil" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT,
    "employeeNumber" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "employmentType" TEXT NOT NULL,
    "classification" TEXT,
    "awardCode" TEXT,
    "baseHourlyRate" DECIMAL(12,2),
    "commencementDate" TIMESTAMP(3) NOT NULL,
    "terminationDate" TIMESTAMP(3),
    "emergencyContact" JSONB,
    "payrollDetailsEncrypted" TEXT,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competency" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "identifier" TEXT,
    "issuer" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "documentId" TEXT,

    CONSTRAINT "Competency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientName" TEXT,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'TENDER',
    "jurisdiction" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "contractValue" DECIMAL(16,2),
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostCode" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "budgetLabour" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "budgetPlant" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "budgetMaterials" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "CostCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timesheet" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "weekEnding" TIMESTAMP(3) NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "correctionReason" TEXT,
    "contentHash" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "parentTimesheetId" TEXT,

    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetSignature" (
    "id" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "signerUserId" TEXT NOT NULL,
    "type" "TimesheetSignatureType" NOT NULL,
    "signedName" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "signatureMethod" TEXT NOT NULL DEFAULT 'DRAWN',
    "timesheetContentHash" TEXT NOT NULL,
    "consentText" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetApprovalRequest" (
    "id" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "approverUserId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,

    CONSTRAINT "TimesheetApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "costCodeId" TEXT,
    "workDate" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "unpaidBreakMinutes" INTEGER NOT NULL DEFAULT 0,
    "ordinaryMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "allowanceCodes" TEXT[],
    "notes" TEXT,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayRun" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'DRAFT',
    "gross" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "superannuation" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "exportFormat" TEXT,
    "exportReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plant" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "assetNumber" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "registration" TEXT,
    "hourMeter" DECIMAL(12,1),
    "odometerKm" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "nextServiceAt" TIMESTAMP(3),
    "nextServiceHours" DECIMAL(12,1),

    CONSTRAINT "Plant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlantClearance" (
    "id" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "clearedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceDocumentId" TEXT,
    "previousStatus" TEXT NOT NULL,
    "clearedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlantClearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlantPreStart" (
    "id" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "projectId" TEXT,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hourMeter" DECIMAL(12,1),
    "odometerKm" INTEGER,
    "checklistVersion" TEXT NOT NULL,
    "checklistTemplateId" TEXT,
    "answers" JSONB NOT NULL,
    "result" "InspectionResult" NOT NULL,
    "defects" JSONB,
    "signature" TEXT,

    CONSTRAINT "PlantPreStart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreStartTemplate" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plantType" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sections" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "PreStartTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyDocument" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "Status" NOT NULL DEFAULT 'DRAFT',
    "riskLevel" "RiskLevel",
    "activities" JSONB,
    "hazards" JSONB,
    "controls" JSONB,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reviewDueAt" TIMESTAMP(3),
    "supersedesId" TEXT,
    "contentHash" TEXT,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "SafetyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyAssignment" (
    "id" TEXT NOT NULL,
    "safetyDocumentId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),

    CONSTRAINT "SafetyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyAcknowledgement" (
    "id" TEXT NOT NULL,
    "safetyDocumentId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signature" TEXT,
    "signedName" TEXT,
    "signatureMethod" TEXT NOT NULL DEFAULT 'DRAWN',
    "documentContentHash" TEXT,
    "consentText" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "SafetyAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "severity" "RiskLevel" NOT NULL,
    "description" TEXT NOT NULL,
    "immediateActions" TEXT,
    "notifiableAssessment" JSONB,
    "regulatorNotifiedAt" TIMESTAMP(3),
    "investigation" JSONB,
    "status" "Status" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectiveAction" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT,
    "projectId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "evidenceDocumentId" TEXT,

    CONSTRAINT "CorrectiveAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Induction" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "score" INTEGER,
    "signature" TEXT,

    CONSTRAINT "Induction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "weather" JSONB,
    "personnel" JSONB NOT NULL,
    "plant" JSONB NOT NULL,
    "activities" JSONB NOT NULL,
    "quantities" JSONB,
    "delays" JSONB,
    "visitors" JSONB,
    "safetyNotes" TEXT,
    "photos" JSONB,
    "submittedById" TEXT NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tender" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'DRAFT',
    "scope" TEXT,
    "estimate" JSONB,
    "risks" JSONB,
    "clarifications" JSONB,
    "submissionChecklist" JSONB,
    "submittedAt" TIMESTAMP(3),
    "outcome" TEXT,

    CONSTRAINT "Tender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderDocument" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "processingStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "processingError" TEXT,
    "pageCount" INTEGER,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenderDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderRequirement" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DECIMAL(4,3) NOT NULL,
    "sourcePage" INTEGER,
    "sourceSheet" TEXT,
    "sourceExcerpt" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'SUGGESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenderRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderChecklistItem" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "requirementId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "ownerId" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TenderChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressClaim" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "claimNumber" INTEGER NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "claimedAmount" DECIMAL(16,2) NOT NULL,
    "certifiedAmount" DECIMAL(16,2),
    "retentionAmount" DECIMAL(16,2),
    "submittedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "status" "Status" NOT NULL DEFAULT 'DRAFT',
    "breakdown" JSONB NOT NULL,

    CONSTRAINT "ProgressClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cause" TEXT,
    "noticeDate" TIMESTAMP(3),
    "quotedAmount" DECIMAL(16,2),
    "approvedAmount" DECIMAL(16,2),
    "extensionDays" INTEGER,
    "status" "Status" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "Variation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retentionUntil" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ipAddress" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_abn_key" ON "Organisation"("abn");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingConnection_organisationId_provider_key" ON "AccountingConnection"("organisationId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEmployeeMapping_connectionId_workerId_key" ON "PayrollEmployeeMapping"("connectionId", "workerId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEmployeeMapping_connectionId_externalEmployeeId_key" ON "PayrollEmployeeMapping"("connectionId", "externalEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPayItemMapping_connectionId_localCode_key" ON "PayrollPayItemMapping"("connectionId", "localCode");

-- CreateIndex
CREATE INDEX "PayrollExport_organisationId_createdAt_idx" ON "PayrollExport"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "PayrollExportItem_timesheetId_idx" ON "PayrollExportItem"("timesheetId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollExportItem_payrollExportId_timesheetId_key" ON "PayrollExportItem"("payrollExportId", "timesheetId");

-- CreateIndex
CREATE INDEX "Device_organisationId_userId_idx" ON "Device"("organisationId", "userId");

-- CreateIndex
CREATE INDEX "MutationReceipt_organisationId_deviceId_appliedAt_idx" ON "MutationReceipt"("organisationId", "deviceId", "appliedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_organisationId_email_key" ON "User"("organisationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Worker_userId_key" ON "Worker"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Worker_organisationId_employeeNumber_key" ON "Worker"("organisationId", "employeeNumber");

-- CreateIndex
CREATE INDEX "Competency_workerId_expiresAt_idx" ON "Competency"("workerId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_organisationId_code_key" ON "Project"("organisationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CostCode_projectId_code_key" ON "CostCode"("projectId", "code");

-- CreateIndex
CREATE INDEX "Timesheet_parentTimesheetId_idx" ON "Timesheet"("parentTimesheetId");

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_projectId_workerId_weekEnding_revision_key" ON "Timesheet"("projectId", "workerId", "weekEnding", "revision");

-- CreateIndex
CREATE INDEX "TimesheetSignature_signerUserId_signedAt_idx" ON "TimesheetSignature"("signerUserId", "signedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetSignature_timesheetId_type_key" ON "TimesheetSignature"("timesheetId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetApprovalRequest_timesheetId_key" ON "TimesheetApprovalRequest"("timesheetId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "PayRun_organisationId_paymentDate_idx" ON "PayRun"("organisationId", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "Plant_organisationId_assetNumber_key" ON "Plant"("organisationId", "assetNumber");

-- CreateIndex
CREATE INDEX "PlantClearance_plantId_clearedAt_idx" ON "PlantClearance"("plantId", "clearedAt");

-- CreateIndex
CREATE INDEX "PlantPreStart_plantId_inspectedAt_idx" ON "PlantPreStart"("plantId", "inspectedAt");

-- CreateIndex
CREATE INDEX "PreStartTemplate_organisationId_plantType_status_idx" ON "PreStartTemplate"("organisationId", "plantType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PreStartTemplate_organisationId_name_version_key" ON "PreStartTemplate"("organisationId", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyDocument_projectId_title_version_key" ON "SafetyDocument"("projectId", "title", "version");

-- CreateIndex
CREATE INDEX "SafetyAssignment_workerId_dueAt_idx" ON "SafetyAssignment"("workerId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyAssignment_safetyDocumentId_workerId_key" ON "SafetyAssignment"("safetyDocumentId", "workerId");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyAcknowledgement_assignmentId_key" ON "SafetyAcknowledgement"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyAcknowledgement_safetyDocumentId_workerId_key" ON "SafetyAcknowledgement"("safetyDocumentId", "workerId");

-- CreateIndex
CREATE UNIQUE INDEX "Induction_projectId_workerId_type_version_key" ON "Induction"("projectId", "workerId", "type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_projectId_reportDate_key" ON "DailyReport"("projectId", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "Tender_organisationId_reference_key" ON "Tender"("organisationId", "reference");

-- CreateIndex
CREATE INDEX "TenderDocument_tenderId_uploadedAt_idx" ON "TenderDocument"("tenderId", "uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TenderDocument_tenderId_sha256_key" ON "TenderDocument"("tenderId", "sha256");

-- CreateIndex
CREATE INDEX "TenderRequirement_tenderId_category_idx" ON "TenderRequirement"("tenderId", "category");

-- CreateIndex
CREATE INDEX "TenderChecklistItem_tenderId_status_idx" ON "TenderChecklistItem"("tenderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProgressClaim_projectId_claimNumber_key" ON "ProgressClaim"("projectId", "claimNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Variation_projectId_reference_key" ON "Variation"("projectId", "reference");

-- CreateIndex
CREATE INDEX "Document_projectId_category_idx" ON "Document"("projectId", "category");

-- CreateIndex
CREATE INDEX "AuditEvent_organisationId_entityType_entityId_occurredAt_idx" ON "AuditEvent"("organisationId", "entityType", "entityId", "occurredAt");

-- AddForeignKey
ALTER TABLE "AccountingConnection" ADD CONSTRAINT "AccountingConnection_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEmployeeMapping" ADD CONSTRAINT "PayrollEmployeeMapping_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AccountingConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEmployeeMapping" ADD CONSTRAINT "PayrollEmployeeMapping_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayItemMapping" ADD CONSTRAINT "PayrollPayItemMapping_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AccountingConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollExport" ADD CONSTRAINT "PayrollExport_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollExport" ADD CONSTRAINT "PayrollExport_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AccountingConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollExportItem" ADD CONSTRAINT "PayrollExportItem_payrollExportId_fkey" FOREIGN KEY ("payrollExportId") REFERENCES "PayrollExport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollExportItem" ADD CONSTRAINT "PayrollExportItem_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MutationReceipt" ADD CONSTRAINT "MutationReceipt_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competency" ADD CONSTRAINT "Competency_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCode" ADD CONSTRAINT "CostCode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_parentTimesheetId_fkey" FOREIGN KEY ("parentTimesheetId") REFERENCES "Timesheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetSignature" ADD CONSTRAINT "TimesheetSignature_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetApprovalRequest" ADD CONSTRAINT "TimesheetApprovalRequest_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetApprovalRequest" ADD CONSTRAINT "TimesheetApprovalRequest_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plant" ADD CONSTRAINT "Plant_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlantClearance" ADD CONSTRAINT "PlantClearance_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlantPreStart" ADD CONSTRAINT "PlantPreStart_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlantPreStart" ADD CONSTRAINT "PlantPreStart_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlantPreStart" ADD CONSTRAINT "PlantPreStart_checklistTemplateId_fkey" FOREIGN KEY ("checklistTemplateId") REFERENCES "PreStartTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreStartTemplate" ADD CONSTRAINT "PreStartTemplate_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyDocument" ADD CONSTRAINT "SafetyDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyAssignment" ADD CONSTRAINT "SafetyAssignment_safetyDocumentId_fkey" FOREIGN KEY ("safetyDocumentId") REFERENCES "SafetyDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyAssignment" ADD CONSTRAINT "SafetyAssignment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyAcknowledgement" ADD CONSTRAINT "SafetyAcknowledgement_safetyDocumentId_fkey" FOREIGN KEY ("safetyDocumentId") REFERENCES "SafetyDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyAcknowledgement" ADD CONSTRAINT "SafetyAcknowledgement_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyAcknowledgement" ADD CONSTRAINT "SafetyAcknowledgement_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "SafetyAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Induction" ADD CONSTRAINT "Induction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Induction" ADD CONSTRAINT "Induction_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tender" ADD CONSTRAINT "Tender_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderDocument" ADD CONSTRAINT "TenderDocument_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderRequirement" ADD CONSTRAINT "TenderRequirement_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderRequirement" ADD CONSTRAINT "TenderRequirement_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "TenderDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderChecklistItem" ADD CONSTRAINT "TenderChecklistItem_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderChecklistItem" ADD CONSTRAINT "TenderChecklistItem_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "TenderRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressClaim" ADD CONSTRAINT "ProgressClaim_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variation" ADD CONSTRAINT "Variation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain integrity constraints that Prisma cannot currently express.
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_finish_after_start" CHECK ("finishedAt" > "startedAt");
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_nonnegative_minutes" CHECK ("unpaidBreakMinutes" >= 0 AND "ordinaryMinutes" >= 0 AND "overtimeMinutes" >= 0);
ALTER TABLE "Project" ADD CONSTRAINT "Project_valid_date_range" CHECK ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "PayrollExport" ADD CONSTRAINT "PayrollExport_valid_period" CHECK ("periodEnd" >= "periodStart");
ALTER TABLE "PayRun" ADD CONSTRAINT "PayRun_valid_period" CHECK ("periodEnd" >= "periodStart");
ALTER TABLE "Plant" ADD CONSTRAINT "Plant_nonnegative_meters" CHECK (("hourMeter" IS NULL OR "hourMeter" >= 0) AND ("odometerKm" IS NULL OR "odometerKm" >= 0));
ALTER TABLE "PlantPreStart" ADD CONSTRAINT "PlantPreStart_nonnegative_meters" CHECK (("hourMeter" IS NULL OR "hourMeter" >= 0) AND ("odometerKm" IS NULL OR "odometerKm" >= 0));
