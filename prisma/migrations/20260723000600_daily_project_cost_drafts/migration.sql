-- Draft daily project costs generated from submitted timecards and plant
-- pre-starts. Admins can edit hours/rates before posting final actual costs.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS "DailyProjectCostDraft" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "costDate" TIMESTAMP(3) NOT NULL,
  "status" "Status" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyProjectCostDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DailyProjectCostLine" (
  "id" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "costCodeId" TEXT,
  "type" "CostEntryType" NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "sourceId" TEXT,
  "workerId" TEXT,
  "plantId" TEXT,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "unit" TEXT NOT NULL DEFAULT 'hr',
  "unitRate" DECIMAL(14,2),
  "amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyProjectCostLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DailyProjectCostDraft_projectId_costDate_key"
  ON "DailyProjectCostDraft"("projectId", "costDate");

CREATE INDEX IF NOT EXISTS "DailyProjectCostDraft_organisationId_costDate_idx"
  ON "DailyProjectCostDraft"("organisationId", "costDate");

CREATE INDEX IF NOT EXISTS "DailyProjectCostDraft_projectId_status_costDate_idx"
  ON "DailyProjectCostDraft"("projectId", "status", "costDate");

CREATE UNIQUE INDEX IF NOT EXISTS "DailyProjectCostLine_draftId_source_sourceId_key"
  ON "DailyProjectCostLine"("draftId", "source", "sourceId");

CREATE INDEX IF NOT EXISTS "DailyProjectCostLine_draftId_type_idx"
  ON "DailyProjectCostLine"("draftId", "type");

CREATE INDEX IF NOT EXISTS "DailyProjectCostLine_workerId_idx"
  ON "DailyProjectCostLine"("workerId");

CREATE INDEX IF NOT EXISTS "DailyProjectCostLine_plantId_idx"
  ON "DailyProjectCostLine"("plantId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE c.conname = 'DailyProjectCostDraft_organisationId_fkey'
      AND n.nspname = 'public'
  ) THEN
    ALTER TABLE "DailyProjectCostDraft" ADD CONSTRAINT "DailyProjectCostDraft_organisationId_fkey"
      FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE c.conname = 'DailyProjectCostDraft_projectId_fkey'
      AND n.nspname = 'public'
  ) THEN
    ALTER TABLE "DailyProjectCostDraft" ADD CONSTRAINT "DailyProjectCostDraft_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE c.conname = 'DailyProjectCostLine_draftId_fkey'
      AND n.nspname = 'public'
  ) THEN
    ALTER TABLE "DailyProjectCostLine" ADD CONSTRAINT "DailyProjectCostLine_draftId_fkey"
      FOREIGN KEY ("draftId") REFERENCES "DailyProjectCostDraft"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE c.conname = 'DailyProjectCostLine_workerId_fkey'
      AND n.nspname = 'public'
  ) THEN
    ALTER TABLE "DailyProjectCostLine" ADD CONSTRAINT "DailyProjectCostLine_workerId_fkey"
      FOREIGN KEY ("workerId") REFERENCES "Worker"("id")
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
    WHERE c.conname = 'DailyProjectCostLine_plantId_fkey'
      AND n.nspname = 'public'
  ) THEN
    ALTER TABLE "DailyProjectCostLine" ADD CONSTRAINT "DailyProjectCostLine_plantId_fkey"
      FOREIGN KEY ("plantId") REFERENCES "Plant"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
