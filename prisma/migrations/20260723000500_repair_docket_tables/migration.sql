-- Repair migration for databases where the docket migrations are marked as
-- applied but the physical docket tables are missing. All statements are
-- guarded so this can safely run on databases where the tables already exist.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocketType') THEN
    CREATE TYPE "DocketType" AS ENUM ('DAYWORKS', 'SCHEDULE_OF_RATES');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocketRateBasis') THEN
    CREATE TYPE "DocketRateBasis" AS ENUM ('LABOUR', 'PLANT', 'MATERIAL', 'SUBCONTRACTOR', 'MEASURED_WORK', 'OTHER');
  END IF;
END $$;

ALTER TYPE "AccountSection" ADD VALUE IF NOT EXISTS 'DOCKETS';

CREATE TABLE IF NOT EXISTS "DocketRate" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "projectId" TEXT,
  "code" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "docketType" "DocketType" NOT NULL,
  "basis" "DocketRateBasis" NOT NULL DEFAULT 'MEASURED_WORK',
  "unit" TEXT NOT NULL,
  "unitRate" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'AUD',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "effectiveFrom" TIMESTAMP(3),
  "effectiveTo" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocketRate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Docket" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "workerId" TEXT,
  "createdById" TEXT NOT NULL,
  "docketType" "DocketType" NOT NULL,
  "docketDate" TIMESTAMP(3) NOT NULL,
  "reference" TEXT,
  "location" TEXT,
  "chainageFrom" DECIMAL(12,1),
  "chainageTo" DECIMAL(12,1),
  "description" TEXT,
  "status" "Status" NOT NULL DEFAULT 'SUBMITTED',
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "invoiceId" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "notes" TEXT,
  "totalAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "gstAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'AUD',
  CONSTRAINT "Docket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DocketLine" (
  "id" TEXT NOT NULL,
  "docketId" TEXT NOT NULL,
  "rateId" TEXT,
  "code" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "basis" "DocketRateBasis" NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL,
  "unit" TEXT NOT NULL,
  "unitRateSnapshot" DECIMAL(14,2) NOT NULL,
  "lineAmount" DECIMAL(16,2) NOT NULL,
  "notes" TEXT,
  CONSTRAINT "DocketLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DocketInvoice" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "status" "Status" NOT NULL DEFAULT 'DRAFT',
  "subtotalAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "gstAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'AUD',
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuedAt" TIMESTAMP(3),
  CONSTRAINT "DocketInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DocketInvoiceItem" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "docketId" TEXT NOT NULL,
  "docketLineId" TEXT,
  "code" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL,
  "unit" TEXT NOT NULL,
  "unitRate" DECIMAL(14,2) NOT NULL,
  "amount" DECIMAL(16,2) NOT NULL,
  CONSTRAINT "DocketInvoiceItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Docket" ADD COLUMN IF NOT EXISTS "invoiceId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "DocketRate_organisationId_projectId_code_key"
  ON "DocketRate"("organisationId", "projectId", "code");
CREATE INDEX IF NOT EXISTS "DocketRate_organisationId_docketType_active_idx"
  ON "DocketRate"("organisationId", "docketType", "active");
CREATE INDEX IF NOT EXISTS "DocketRate_projectId_active_idx"
  ON "DocketRate"("projectId", "active");
CREATE INDEX IF NOT EXISTS "Docket_organisationId_docketDate_idx"
  ON "Docket"("organisationId", "docketDate");
CREATE INDEX IF NOT EXISTS "Docket_projectId_docketDate_idx"
  ON "Docket"("projectId", "docketDate");
CREATE INDEX IF NOT EXISTS "Docket_projectId_invoiceId_idx"
  ON "Docket"("projectId", "invoiceId");
CREATE INDEX IF NOT EXISTS "Docket_workerId_docketDate_idx"
  ON "Docket"("workerId", "docketDate");
CREATE INDEX IF NOT EXISTS "Docket_status_docketType_idx"
  ON "Docket"("status", "docketType");
CREATE UNIQUE INDEX IF NOT EXISTS "DocketInvoice_organisationId_invoiceNumber_key"
  ON "DocketInvoice"("organisationId", "invoiceNumber");
CREATE INDEX IF NOT EXISTS "DocketInvoice_projectId_createdAt_idx"
  ON "DocketInvoice"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "DocketInvoice_organisationId_status_createdAt_idx"
  ON "DocketInvoice"("organisationId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "DocketInvoiceItem_invoiceId_idx"
  ON "DocketInvoiceItem"("invoiceId");
CREATE INDEX IF NOT EXISTS "DocketInvoiceItem_docketId_idx"
  ON "DocketInvoiceItem"("docketId");
CREATE INDEX IF NOT EXISTS "DocketLine_docketId_idx"
  ON "DocketLine"("docketId");
CREATE INDEX IF NOT EXISTS "DocketLine_rateId_idx"
  ON "DocketLine"("rateId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocketRate_organisationId_fkey') THEN
    ALTER TABLE "DocketRate" ADD CONSTRAINT "DocketRate_organisationId_fkey"
      FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocketRate_projectId_fkey') THEN
    ALTER TABLE "DocketRate" ADD CONSTRAINT "DocketRate_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Docket_organisationId_fkey') THEN
    ALTER TABLE "Docket" ADD CONSTRAINT "Docket_organisationId_fkey"
      FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Docket_projectId_fkey') THEN
    ALTER TABLE "Docket" ADD CONSTRAINT "Docket_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Docket_workerId_fkey') THEN
    ALTER TABLE "Docket" ADD CONSTRAINT "Docket_workerId_fkey"
      FOREIGN KEY ("workerId") REFERENCES "Worker"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Docket_createdById_fkey') THEN
    ALTER TABLE "Docket" ADD CONSTRAINT "Docket_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Docket_invoiceId_fkey') THEN
    ALTER TABLE "Docket" ADD CONSTRAINT "Docket_invoiceId_fkey"
      FOREIGN KEY ("invoiceId") REFERENCES "DocketInvoice"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocketInvoice_organisationId_fkey') THEN
    ALTER TABLE "DocketInvoice" ADD CONSTRAINT "DocketInvoice_organisationId_fkey"
      FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocketInvoice_projectId_fkey') THEN
    ALTER TABLE "DocketInvoice" ADD CONSTRAINT "DocketInvoice_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocketInvoice_createdById_fkey') THEN
    ALTER TABLE "DocketInvoice" ADD CONSTRAINT "DocketInvoice_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocketInvoiceItem_invoiceId_fkey') THEN
    ALTER TABLE "DocketInvoiceItem" ADD CONSTRAINT "DocketInvoiceItem_invoiceId_fkey"
      FOREIGN KEY ("invoiceId") REFERENCES "DocketInvoice"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocketLine_docketId_fkey') THEN
    ALTER TABLE "DocketLine" ADD CONSTRAINT "DocketLine_docketId_fkey"
      FOREIGN KEY ("docketId") REFERENCES "Docket"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocketLine_rateId_fkey') THEN
    ALTER TABLE "DocketLine" ADD CONSTRAINT "DocketLine_rateId_fkey"
      FOREIGN KEY ("rateId") REFERENCES "DocketRate"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
