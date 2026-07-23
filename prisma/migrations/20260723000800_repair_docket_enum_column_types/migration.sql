-- Repair docket enum columns that were created against a non-public schema
-- such as publicnpx. Prisma writes public enum values, so the column types
-- must also be public enum types.

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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'DocketRate'
      AND column_name = 'docketType'
      AND udt_schema <> 'public'
  ) THEN
    ALTER TABLE public."DocketRate"
      ALTER COLUMN "docketType" TYPE public."DocketType"
      USING "docketType"::text::public."DocketType";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'DocketRate'
      AND column_name = 'basis'
      AND udt_schema <> 'public'
  ) THEN
    ALTER TABLE public."DocketRate"
      ALTER COLUMN "basis" DROP DEFAULT,
      ALTER COLUMN "basis" TYPE public."DocketRateBasis"
      USING "basis"::text::public."DocketRateBasis",
      ALTER COLUMN "basis" SET DEFAULT 'MEASURED_WORK';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Docket'
      AND column_name = 'docketType'
      AND udt_schema <> 'public'
  ) THEN
    ALTER TABLE public."Docket"
      ALTER COLUMN "docketType" TYPE public."DocketType"
      USING "docketType"::text::public."DocketType";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'DocketLine'
      AND column_name = 'basis'
      AND udt_schema <> 'public'
  ) THEN
    ALTER TABLE public."DocketLine"
      ALTER COLUMN "basis" TYPE public."DocketRateBasis"
      USING "basis"::text::public."DocketRateBasis";
  END IF;
END $$;
