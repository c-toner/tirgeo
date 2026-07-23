-- Consolidate accidental Prisma schema drift back to public.
--
-- Run this manually against production only after taking a backup/snapshot.
-- It handles the bad schemas we have seen in this project: publicnpx and
-- npxpublic. The script is deliberately conservative:
--   - moves drift tables into public only when public does not already have
--     that table
--   - drops duplicate drift tables only when they are empty
--   - stops with an error if a duplicate drift table contains rows
--   - rewrites known docket enum columns to public enum types
--   - drops the drift schema only when it is empty

SET search_path TO public;
SET lock_timeout = '10s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'DocketType'
  ) THEN
    CREATE TYPE public."DocketType" AS ENUM ('DAYWORKS', 'SCHEDULE_OF_RATES');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'DocketRateBasis'
  ) THEN
    CREATE TYPE public."DocketRateBasis" AS ENUM ('LABOUR', 'PLANT', 'MATERIAL', 'SUBCONTRACTOR', 'MEASURED_WORK', 'OTHER');
  END IF;
END $$;

DO $$
DECLARE
  drift_schema text;
  drift_table record;
  row_count bigint;
BEGIN
  FOREACH drift_schema IN ARRAY ARRAY['publicnpx', 'npxpublic'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = drift_schema) THEN
      CONTINUE;
    END IF;

    FOR drift_table IN
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = drift_schema
      ORDER BY tablename
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename = drift_table.tablename
      ) THEN
        EXECUTE format('ALTER TABLE %I.%I SET SCHEMA public', drift_schema, drift_table.tablename);
      ELSE
        EXECUTE format('SELECT count(*) FROM %I.%I', drift_schema, drift_table.tablename) INTO row_count;
        IF drift_table.tablename = '_prisma_migrations' THEN
          EXECUTE format(
            'CREATE TABLE IF NOT EXISTS public."_prisma_migrations_drift_archive" AS SELECT %L::text AS "driftSchema", now() AS "archivedAt", m.* FROM %I.%I m WHERE false',
            drift_schema,
            drift_schema,
            drift_table.tablename
          );
          EXECUTE format(
            'INSERT INTO public."_prisma_migrations_drift_archive" SELECT %L::text AS "driftSchema", now() AS "archivedAt", m.* FROM %I.%I m WHERE NOT EXISTS (SELECT 1 FROM public."_prisma_migrations_drift_archive" a WHERE a."driftSchema" = %L AND a.id = m.id)',
            drift_schema,
            drift_schema,
            drift_table.tablename,
            drift_schema
          );
          EXECUTE format('DROP TABLE %I.%I', drift_schema, drift_table.tablename);
          CONTINUE;
        END IF;
        IF row_count > 0 THEN
          RAISE EXCEPTION 'Refusing to drop %.% because public.% exists and drift table has % rows',
            drift_schema, drift_table.tablename, drift_table.tablename, row_count;
        END IF;
        EXECUTE format('DROP TABLE %I.%I CASCADE', drift_schema, drift_table.tablename);
      END IF;
    END LOOP;
  END LOOP;
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

DO $$
DECLARE
  enum_column record;
  default_label text;
BEGIN
  FOR enum_column IN
    SELECT
      c.table_schema,
      c.table_name,
      c.column_name,
      c.udt_schema,
      c.udt_name,
      c.column_default
    FROM information_schema.columns c
    JOIN pg_type drift_type ON drift_type.typname = c.udt_name
    JOIN pg_namespace drift_ns ON drift_ns.oid = drift_type.typnamespace AND drift_ns.nspname = c.udt_schema
    JOIN pg_type public_type ON public_type.typname = c.udt_name
    JOIN pg_namespace public_ns ON public_ns.oid = public_type.typnamespace AND public_ns.nspname = 'public'
    WHERE c.table_schema = 'public'
      AND c.udt_schema IN ('publicnpx', 'npxpublic')
      AND drift_type.typtype = 'e'
      AND public_type.typtype = 'e'
    ORDER BY c.table_name, c.column_name
  LOOP
    default_label := NULL;
    IF enum_column.column_default IS NOT NULL THEN
      default_label := substring(enum_column.column_default FROM '^''((?:''''|[^''])*)''');
      IF default_label IS NOT NULL THEN
        default_label := replace(default_label, '''''', '''');
      END IF;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I DROP DEFAULT',
      enum_column.table_schema,
      enum_column.table_name,
      enum_column.column_name
    );

    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I TYPE public.%I USING %I::text::public.%I',
      enum_column.table_schema,
      enum_column.table_name,
      enum_column.column_name,
      enum_column.udt_name,
      enum_column.column_name,
      enum_column.udt_name
    );

    IF default_label IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT %L::public.%I',
        enum_column.table_schema,
        enum_column.table_name,
        enum_column.column_name,
        default_label,
        enum_column.udt_name
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  drift_schema text;
  drift_type record;
BEGIN
  FOREACH drift_schema IN ARRAY ARRAY['publicnpx', 'npxpublic'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = drift_schema) THEN
      CONTINUE;
    END IF;

    FOR drift_type IN
      SELECT t.typname
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = drift_schema
        AND t.typtype = 'e'
      ORDER BY t.typname
    LOOP
      IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typname = drift_type.typname
      ) THEN
        BEGIN
          EXECUTE format('DROP TYPE %I.%I', drift_schema, drift_type.typname);
        EXCEPTION
          WHEN dependent_objects_still_exist THEN
            RAISE EXCEPTION 'Refusing to drop %.% because something still depends on it. Recast those columns to public.% first.',
              drift_schema, drift_type.typname, drift_type.typname;
        END;
      ELSE
        EXECUTE format('ALTER TYPE %I.%I SET SCHEMA public', drift_schema, drift_type.typname);
      END IF;
    END LOOP;
  END LOOP;
END $$;

DO $$
DECLARE
  drift_schema text;
  object_count integer;
BEGIN
  FOREACH drift_schema IN ARRAY ARRAY['publicnpx', 'npxpublic'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = drift_schema) THEN
      CONTINUE;
    END IF;

    SELECT count(*) INTO object_count
    FROM (
      SELECT c.oid
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = drift_schema
      UNION ALL
      SELECT t.oid
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = drift_schema
        AND t.typtype <> 'b'
    ) remaining;

    IF object_count = 0 THEN
      EXECUTE format('DROP SCHEMA %I', drift_schema);
    ELSE
      RAISE NOTICE 'Schema % still has % objects; inspect before dropping it.', drift_schema, object_count;
    END IF;
  END LOOP;
END $$;

SELECT schema_name
FROM information_schema.schemata
WHERE schema_name IN ('public', 'publicnpx', 'npxpublic')
ORDER BY schema_name;

SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema IN ('public', 'publicnpx', 'npxpublic')
ORDER BY table_schema, table_name;

SELECT n.nspname AS schema, t.typname AS type_name
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname IN ('public', 'publicnpx', 'npxpublic')
  AND t.typtype = 'e'
ORDER BY schema, type_name;
