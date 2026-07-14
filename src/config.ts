import { z } from "zod";

process.env.DATABASE_URL ??= process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;

export const config = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  STORAGE_PATH: z.string().default("./data/uploads"),
  CORS_ORIGINS: z.string().default(""),
  TRUST_PROXY: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  JWT_ISSUER: z.string().default("tirgeo-backend"),
  JWT_AUDIENCE: z.string().default("tirgeo-app"),
}).parse(process.env);

export const corsOrigins = config.CORS_ORIGINS.split(",").map(v => v.trim()).filter(Boolean);
