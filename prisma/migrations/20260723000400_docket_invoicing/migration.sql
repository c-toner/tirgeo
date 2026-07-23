-- Invoice generation for project dockets. Dockets keep their submitted
-- quantities and snapped values, while invoices collect uninvoiced dockets.

ALTER TABLE "Docket" ADD COLUMN IF NOT EXISTS "invoiceId" TEXT;

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

CREATE UNIQUE INDEX IF NOT EXISTS "DocketInvoice_organisationId_invoiceNumber_key"
  ON "DocketInvoice"("organisationId", "invoiceNumber");

CREATE INDEX IF NOT EXISTS "Docket_projectId_invoiceId_idx"
  ON "Docket"("projectId", "invoiceId");

CREATE INDEX IF NOT EXISTS "DocketInvoice_projectId_createdAt_idx"
  ON "DocketInvoice"("projectId", "createdAt");

CREATE INDEX IF NOT EXISTS "DocketInvoice_organisationId_status_createdAt_idx"
  ON "DocketInvoice"("organisationId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "DocketInvoiceItem_invoiceId_idx"
  ON "DocketInvoiceItem"("invoiceId");

CREATE INDEX IF NOT EXISTS "DocketInvoiceItem_docketId_idx"
  ON "DocketInvoiceItem"("docketId");

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
