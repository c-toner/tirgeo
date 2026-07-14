import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcrypt";
import { genericPreStartSections } from "../src/lib/prestart.js";

const prisma = new PrismaClient();
const passwordHash = await bcrypt.hash("ChangeMe123!", 12);
const toOrganisationSlug = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const organisationName = "TirGeo Demo Civil";
const organisationSlug = toOrganisationSlug(organisationName);
const organisation = await prisma.organisation.upsert({ where: { abn: "00000000000" }, update: { slug: organisationSlug }, create: { name: organisationName, slug: organisationSlug, abn: "00000000000" } });
const admin = await prisma.user.upsert({ where: { organisationId_email: { organisationId: organisation.id, email: "admin@tirgeo.local" } }, update: {}, create: { organisationId: organisation.id, email: "admin@tirgeo.local", name: "TirGeo Admin", role: Role.OWNER, passwordHash } });
await prisma.preStartTemplate.upsert({
  where: { organisationId_name_version: { organisationId: organisation.id, name: "Generic Plant Pre-Start", version: 1 } },
  update: {},
  create: { organisationId: organisation.id, name: "Generic Plant Pre-Start", version: 1, status: "PUBLISHED", sections: genericPreStartSections as any, createdById: admin.id, publishedAt: new Date() },
});
console.log({ organisationId: organisation.id, organisation: organisation.slug, email: "admin@tirgeo.local", password: "ChangeMe123!" });
await prisma.$disconnect();
