CREATE TYPE "AccountSection" AS ENUM (
  'DASHBOARD',
  'PROJECTS',
  'DAILY_REPORT',
  'HAZARDS',
  'OBSERVATIONS',
  'INSPECTIONS',
  'PERMITS',
  'CORRECTIVE_ACTIONS',
  'SAFETY_DOCUMENTS',
  'MY_SAFETY',
  'PLANT',
  'TIMESHEETS',
  'PAYROLL',
  'COMMERCIAL',
  'WORKER_DIRECTORY',
  'USER_ADMIN',
  'SETTINGS'
);

ALTER TABLE "User" ADD COLUMN "phone" TEXT;
ALTER TABLE "User" ADD COLUMN "address" JSONB;

CREATE TABLE "UserSectionAccess" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "section" "AccountSection" NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "grantedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserSectionAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserSectionAccess_userId_section_key" ON "UserSectionAccess"("userId", "section");
CREATE INDEX "UserSectionAccess_section_enabled_idx" ON "UserSectionAccess"("section", "enabled");

ALTER TABLE "UserSectionAccess" ADD CONSTRAINT "UserSectionAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSectionAccess" ADD CONSTRAINT "UserSectionAccess_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
