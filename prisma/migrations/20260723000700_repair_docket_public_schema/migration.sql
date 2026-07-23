-- Repair docket objects in the public schema. Earlier guarded migrations checked
-- enum names without schema qualification, so a stray publicnpx enum could make
-- them skip the public enum Prisma expects.

SET search_path TO public;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'DocketType'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public."DocketType" AS ENUM ('DAYWORKS', 'SCHEDULE_OF_RATES');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'DocketRateBasis'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public."DocketRateBasis" AS ENUM ('LABOUR', 'PLANT', 'MATERIAL', 'SUBCONTRACTOR', 'MEASURED_WORK', 'OTHER');
  END IF;
END $$;

ALTER TYPE public."AccountSection" ADD VALUE IF NOT EXISTS 'DOCKETS';

CREATE TABLE IF NOT EXISTS public."DocketRate" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "projectId" TEXT,
  "code" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "docketType" public."DocketType" NOT NULL,
  "basis" public."DocketRateBasis" NOT NULL DEFAULT 'MEASURED_WORK',
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

CREATE TABLE IF NOT EXISTS public."Docket" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "workerId" TEXT,
  "createdById" TEXT NOT NULL,
  "docketType" public."DocketType" NOT NULL,
  "docketDate" TIMESTAMP(3) NOT NULL,
  "reference" TEXT,
  "location" TEXT,
  "chainageFrom" DECIMAL(12,1),
  "chainageTo" DECIMAL(12,1),
  "description" TEXT,
  "status" public."Status" NOT NULL DEFAULT 'SUBMITTED',
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

CREATE TABLE IF NOT EXISTS public."DocketLine" (
  "id" TEXT NOT NULL,
  "docketId" TEXT NOT NULL,
  "rateId" TEXT,
  "code" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "basis" public."DocketRateBasis" NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL,
  "unit" TEXT NOT NULL,
  "unitRateSnapshot" DECIMAL(14,2) NOT NULL,
  "lineAmount" DECIMAL(16,2) NOT NULL,
  "notes" TEXT,
  CONSTRAINT "DocketLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."DocketInvoice" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "status" public."Status" NOT NULL DEFAULT 'DRAFT',
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

CREATE TABLE IF NOT EXISTS public."DocketInvoiceItem" (
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

ALTER TABLE public."Docket" ADD COLUMN IF NOT EXISTS "invoiceId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "DocketRate_organisationId_projectId_code_key"
  ON public."DocketRate"("organisationId", "projectId", "code");
CREATE INDEX IF NOT EXISTS "DocketRate_organisationId_docketType_active_idx"
  ON public."DocketRate"("organisationId", "docketType", "active");
CREATE INDEX IF NOT EXISTS "DocketRate_projectId_active_idx"
  ON public."DocketRate"("projectId", "active");
CREATE INDEX IF NOT EXISTS "Docket_organisationId_docketDate_idx"
  ON public."Docket"("organisationId", "docketDate");
CREATE INDEX IF NOT EXISTS "Docket_projectId_docketDate_idx"
  ON public."Docket"("projectId", "docketDate");
CREATE INDEX IF NOT EXISTS "Docket_projectId_invoiceId_idx"
  ON public."Docket"("projectId", "invoiceId");
CREATE INDEX IF NOT EXISTS "Docket_workerId_docketDate_idx"
  ON public."Docket"("workerId", "docketDate");
CREATE INDEX IF NOT EXISTS "Docket_status_docketType_idx"
  ON public."Docket"("status", "docketType");
CREATE UNIQUE INDEX IF NOT EXISTS "DocketInvoice_organisationId_invoiceNumber_key"
  ON public."DocketInvoice"("organisationId", "invoiceNumber");
CREATE INDEX IF NOT EXISTS "DocketInvoice_projectId_createdAt_idx"
  ON public."DocketInvoice"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "DocketInvoice_organisationId_status_createdAt_idx"
  ON public."DocketInvoice"("organisationId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "DocketInvoiceItem_invoiceId_idx"
  ON public."DocketInvoiceItem"("invoiceId");
CREATE INDEX IF NOT EXISTS "DocketInvoiceItem_docketId_idx"
  ON public."DocketInvoiceItem"("docketId");
CREATE INDEX IF NOT EXISTS "DocketLine_docketId_idx"
  ON public."DocketLine"("docketId");
CREATE INDEX IF NOT EXISTS "DocketLine_rateId_idx"
  ON public."DocketLine"("rateId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocketRate_organisationId_fkey') THEN
    ALTER TABLE public."DocketRate" ADD CONSTRAINT "DocketRate_organisationId_fkey"
      FOREIGN KEY ("organisationId") REFERENCES public."Organisation"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocketRate_projectId_fkey') THEN
    ALTER TABLE public."DocketRate" ADD CONSTRAINT "DocketRate_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES public."Project"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Docket_organisationId_fkey') THEN
    ALTER TABLE public."Docket" ADD CONSTRAINT "Docket_organisationId_fkey"
      FOREIGN KEY ("organisationId") REFERENCES public."Organisation"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Docket_projectId_fkey') THEN
    ALTER TABLE public."Docket" ADD CONSTRAINT "Docket_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES public."Project"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Docket_workerId_fkey') THEN
    ALTER TABLE public."Docket" ADD CONSTRAINT "Docket_workerId_fkey"
      FOREIGN KEY ("workerId") REFERENCES public."Worker"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Docket_createdById_fkey') THEN
    ALTER TABLE public."Docket" ADD CONSTRAINT "Docket_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES public."User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Docket_invoiceId_fkey') THEN
    ALTER TABLE public."Docket" ADD CONSTRAINT "Docket_invoiceId_fkey"
      FOREIGN KEY ("invoiceId") REFERENCES public."DocketInvoice"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocketInvoice_organisationId_fkey') THEN
    ALTER TABLE public."DocketInvoice" ADD CONSTRAINT "DocketInvoice_organisationId_fkey"
      FOREIGN KEY ("organisationId") REFERENCES public."Organisation"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocketInvoice_projectId_fkey') THEN
    ALTER TABLE public."DocketInvoice" ADD CONSTRAINT "DocketInvoice_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES public."Project"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocketInvoice_createdById_fkey') THEN
    ALTER TABLE public."DocketInvoice" ADD CONSTRAINT "DocketInvoice_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES public."User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocketInvoiceItem_invoiceId_fkey') THEN
    ALTER TABLE public."DocketInvoiceItem" ADD CONSTRAINT "DocketInvoiceItem_invoiceId_fkey"
      FOREIGN KEY ("invoiceId") REFERENCES public."DocketInvoice"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocketLine_docketId_fkey') THEN
    ALTER TABLE public."DocketLine" ADD CONSTRAINT "DocketLine_docketId_fkey"
      FOREIGN KEY ("docketId") REFERENCES public."Docket"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocketLine_rateId_fkey') THEN
    ALTER TABLE public."DocketLine" ADD CONSTRAINT "DocketLine_rateId_fkey"
      FOREIGN KEY ("rateId") REFERENCES public."DocketRate"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
