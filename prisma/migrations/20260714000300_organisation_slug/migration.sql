ALTER TABLE "Organisation" ADD COLUMN "slug" TEXT;

WITH normalised AS (
  SELECT
    "id",
    lower(trim(regexp_replace(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'))) AS base_slug,
    row_number() OVER (
      PARTITION BY lower(trim(regexp_replace(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')))
      ORDER BY "createdAt", "id"
    ) AS duplicate_index
  FROM "Organisation"
)
UPDATE "Organisation" o
SET "slug" = CASE
  WHEN normalised.base_slug IS NULL OR normalised.base_slug = '' THEN 'organisation-' || substr(o."id", 1, 8)
  WHEN normalised.duplicate_index = 1 THEN normalised.base_slug
  ELSE normalised.base_slug || '-' || normalised.duplicate_index::text
END
FROM normalised
WHERE o."id" = normalised."id";

ALTER TABLE "Organisation" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Organisation_slug_key" ON "Organisation"("slug");
