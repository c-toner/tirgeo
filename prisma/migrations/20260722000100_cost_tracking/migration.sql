-- Add cost tracking and margin management for commercial project controls.

CREATE TYPE "CostEntryType" AS ENUM (
  'LABOUR',
  'PLANT',
  'MATERIALS',
  'SUBCONTRACTOR',
  'HIRE',
  'DISPOSAL',
  'TRAFFIC_MANAGEMENT',
  'SURVEYING',
  'OVERHEAD',
  'OTHER'
);

CREATE TYPE "CostEntryStatus" AS ENUM (
  'COMMITTED',
  'ACCRUED',
  'INVOICED',
  'APPROVED',
  'PAID',
  'DISPUTED'
);

CREATE TYPE "ForecastConfidence" AS ENUM (
  'LOW',
  'MEDIUM',
  'HIGH'
);

ALTER TYPE "AccountSection" ADD VALUE 'COST_TRACKING';

CREATE TABLE "ProjectCostPlan" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "contractBudget" DECIMAL(16,2),
  "contingencyAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "targetMarginPercent" DECIMAL(6,2),
  "notes" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectCostPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostEntry" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "costCodeId" TEXT,
  "type" "CostEntryType" NOT NULL,
  "status" "CostEntryStatus" NOT NULL DEFAULT 'ACCRUED',
  "supplier" TEXT,
  "description" TEXT NOT NULL,
  "incurredAt" TIMESTAMP(3) NOT NULL,
  "invoiceNumber" TEXT,
  "quantity" DECIMAL(14,3),
  "unit" TEXT,
  "unitRate" DECIMAL(14,2),
  "amount" DECIMAL(16,2) NOT NULL,
  "gstAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "committed" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CostEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostForecast" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "costCodeId" TEXT,
  "type" "CostEntryType" NOT NULL,
  "description" TEXT NOT NULL,
  "amount" DECIMAL(16,2) NOT NULL,
  "confidence" "ForecastConfidence" NOT NULL DEFAULT 'MEDIUM',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),

  CONSTRAINT "CostForecast_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectCostPlan_projectId_key" ON "ProjectCostPlan"("projectId");
CREATE INDEX "CostEntry_projectId_incurredAt_idx" ON "CostEntry"("projectId", "incurredAt");
CREATE INDEX "CostEntry_projectId_type_idx" ON "CostEntry"("projectId", "type");
CREATE INDEX "CostEntry_costCodeId_idx" ON "CostEntry"("costCodeId");
CREATE INDEX "CostForecast_projectId_resolvedAt_idx" ON "CostForecast"("projectId", "resolvedAt");
CREATE INDEX "CostForecast_costCodeId_idx" ON "CostForecast"("costCodeId");

ALTER TABLE "ProjectCostPlan" ADD CONSTRAINT "ProjectCostPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CostForecast" ADD CONSTRAINT "CostForecast_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CostForecast" ADD CONSTRAINT "CostForecast_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
