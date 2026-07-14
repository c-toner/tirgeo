CREATE TYPE "FileStorageProvider" AS ENUM ('VERCEL_BLOB');
CREATE TYPE "FileAccess" AS ENUM ('PRIVATE', 'PUBLIC');

CREATE TABLE "FileAsset" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "projectId" TEXT,
  "uploadedById" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "provider" "FileStorageProvider" NOT NULL DEFAULT 'VERCEL_BLOB',
  "access" "FileAccess" NOT NULL DEFAULT 'PRIVATE',
  "pathname" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "downloadUrl" TEXT,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT,
  "originalName" TEXT NOT NULL,
  "description" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "FileAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FileAsset_organisationId_pathname_key" ON "FileAsset"("organisationId", "pathname");
CREATE INDEX "FileAsset_organisationId_entityType_entityId_idx" ON "FileAsset"("organisationId", "entityType", "entityId");
CREATE INDEX "FileAsset_organisationId_projectId_createdAt_idx" ON "FileAsset"("organisationId", "projectId", "createdAt");
CREATE INDEX "FileAsset_uploadedById_createdAt_idx" ON "FileAsset"("uploadedById", "createdAt");

ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
