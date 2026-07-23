-- Evidence and attachment metadata for costs posted from daily resource drafts
-- and supplier/subcontractor invoices.

SET search_path TO public;

ALTER TABLE "CostEntry"
  ADD COLUMN IF NOT EXISTS "sourceId" TEXT,
  ADD COLUMN IF NOT EXISTS "evidence" JSONB,
  ADD COLUMN IF NOT EXISTS "attachmentFileAssetId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CostEntry_source_sourceId_key"
  ON "CostEntry"("source", "sourceId");

CREATE INDEX IF NOT EXISTS "CostEntry_attachmentFileAssetId_idx"
  ON "CostEntry"("attachmentFileAssetId");
