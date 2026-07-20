ALTER TYPE "AccountSection" ADD VALUE 'CHAINAGE';

CREATE TABLE "ChainageAlignment" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "roadRef" TEXT,
  "direction" TEXT,
  "startLabel" TEXT,
  "endLabel" TEXT,
  "startChainageM" DECIMAL(12,1) NOT NULL,
  "endChainageM" DECIMAL(12,1) NOT NULL,
  "geometry" JSONB,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChainageAlignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChainageObservation" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "alignmentId" TEXT NOT NULL,
  "chainageM" DECIMAL(12,1) NOT NULL,
  "side" TEXT NOT NULL DEFAULT 'CENTRE',
  "offsetM" DECIMAL(8,2),
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "gpsAccuracyM" DECIMAL(8,2),
  "category" TEXT NOT NULL DEFAULT 'ISSUE',
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "photoIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT NOT NULL,
  CONSTRAINT "ChainageObservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChainageAlignment_projectId_name_idx" ON "ChainageAlignment"("projectId", "name");
CREATE INDEX "ChainageObservation_projectId_observedAt_idx" ON "ChainageObservation"("projectId", "observedAt");
CREATE INDEX "ChainageObservation_alignmentId_chainageM_idx" ON "ChainageObservation"("alignmentId", "chainageM");
CREATE INDEX "ChainageObservation_status_idx" ON "ChainageObservation"("status");

ALTER TABLE "ChainageAlignment" ADD CONSTRAINT "ChainageAlignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChainageObservation" ADD CONSTRAINT "ChainageObservation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChainageObservation" ADD CONSTRAINT "ChainageObservation_alignmentId_fkey" FOREIGN KEY ("alignmentId") REFERENCES "ChainageAlignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChainageObservation" ADD CONSTRAINT "ChainageObservation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
