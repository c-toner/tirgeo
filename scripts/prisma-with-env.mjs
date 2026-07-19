import { spawn } from "node:child_process";

const firstPostgresUrl = (...values) =>
  values.find(value => typeof value === "string" && /^postgres(?:ql)?:\/\//.test(value.trim()));

process.env.DATABASE_URL = firstPostgresUrl(
  process.env.DATABASE_URL,
  process.env.POSTGRES_PRISMA_URL,
  process.env.POSTGRES_URL,
  process.env.tirgeo_db_prod_POSTGRES_PRISMA_URL,
  process.env.tirgeo_db_prod_POSTGRES_URL,
  process.env.tirgeo_db_prod_DATABASE_URL,
) ?? "";

process.env.DIRECT_URL = firstPostgresUrl(
  process.env.DIRECT_URL,
  process.env.POSTGRES_URL_NON_POOLING,
  process.env.DATABASE_URL_UNPOOLED,
  process.env.tirgeo_db_prod_POSTGRES_URL_NON_POOLING,
  process.env.tirgeo_db_prod_DATABASE_URL_UNPOOLED,
) ?? process.env.DIRECT_URL ?? "";

const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage: node scripts/prisma-with-env.mjs <prisma args...>");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("No valid Postgres DATABASE_URL was found. Set DATABASE_URL, POSTGRES_PRISMA_URL, POSTGRES_URL, or the tirgeo_db_prod_* equivalent before running Prisma migrations.");
  process.exit(1);
}

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(executable, ["prisma", ...args], { env: process.env, stdio: "inherit" });
child.on("exit", code => process.exit(code ?? 1));
