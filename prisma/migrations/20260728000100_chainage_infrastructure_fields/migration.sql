ALTER TABLE "ChainageObservation"
ADD COLUMN "assetType" TEXT,
ADD COLUMN "severity" TEXT,
ADD COLUMN "defectCause" TEXT,
ADD COLUMN "recommendedAction" TEXT;

CREATE INDEX "ChainageObservation_assetType_idx" ON "ChainageObservation"("assetType");
CREATE INDEX "ChainageObservation_severity_idx" ON "ChainageObservation"("severity");
