import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcrypt";
import { genericPreStartSections } from "../src/lib/prestart.js";

const prisma = new PrismaClient();

const toOrganisationSlug = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const required = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const organisationName = required("SEED_COMPANY_NAME", "Progress Civil");
const organisationSlug = process.env.SEED_COMPANY_SLUG ?? toOrganisationSlug(organisationName);
const userEmail = required("SEED_USER_EMAIL", "conortoner30@gmail.com").toLowerCase();
const userPassword = required("SEED_USER_PASSWORD", "TestTirgeo1!");
const userName = required("SEED_USER_NAME", "Conor Toner");
const role = (process.env.SEED_USER_ROLE ?? Role.OWNER) as Role;
const createWorker = (process.env.SEED_CREATE_WORKER ?? "true") === "true";

const passwordHash = await bcrypt.hash(userPassword, 12);

const organisation = await prisma.organisation.upsert({
  where: { slug: organisationSlug },
  update: { name: organisationName },
  create: { name: organisationName, slug: organisationSlug },
});

const user = await prisma.user.upsert({
  where: { organisationId_email: { organisationId: organisation.id, email: userEmail } },
  update: { name: userName, role, active: true, passwordHash },
  create: { organisationId: organisation.id, email: userEmail, name: userName, role, passwordHash },
});

let workerId: string | undefined;
if (createWorker) {
  const [firstName, ...lastNameParts] = userName.split(/\s+/);
  const worker = await prisma.worker.upsert({
    where: { organisationId_employeeNumber: { organisationId: organisation.id, employeeNumber: process.env.SEED_WORKER_NUMBER ?? "EMP-001" } },
    update: { userId: user.id, firstName: firstName || userName, lastName: lastNameParts.join(" ") || "User" },
    create: {
      organisationId: organisation.id,
      userId: user.id,
      employeeNumber: process.env.SEED_WORKER_NUMBER ?? "EMP-001",
      firstName: firstName || userName,
      lastName: lastNameParts.join(" ") || "User",
      employmentType: process.env.SEED_EMPLOYMENT_TYPE ?? "FULL_TIME",
      commencementDate: new Date(),
    },
  });
  workerId = worker.id;
}

const templateAdmin = role === Role.OWNER || role === Role.ADMIN ? user : await prisma.user.findFirst({ where: { organisationId: organisation.id, role: { in: [Role.OWNER, Role.ADMIN] }, active: true } });
if (templateAdmin) {
  await prisma.preStartTemplate.upsert({
    where: { organisationId_name_version: { organisationId: organisation.id, name: "Generic Plant Pre-Start", version: 1 } },
    update: {},
    create: { organisationId: organisation.id, name: "Generic Plant Pre-Start", version: 1, status: "PUBLISHED", sections: genericPreStartSections as any, createdById: templateAdmin.id, publishedAt: new Date() },
  });
}

console.log({ organisationId: organisation.id, organisation: organisation.slug, email: user.email, password: userPassword, role: user.role, workerId });
await prisma.$disconnect();
