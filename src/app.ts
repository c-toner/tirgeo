import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import multipart from "@fastify/multipart";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import database from "./plugins/database.js";
import auth from "./plugins/auth.js";
import authRoutes from "./routes/auth.js";
import projectRoutes from "./routes/projects.js";
import timesheetRoutes from "./routes/timesheets.js";
import plantRoutes from "./routes/plant.js";
import safetyRoutes from "./routes/safety.js";
import fieldRoutes from "./routes/field.js";
import commercialRoutes from "./routes/commercial.js";
import syncRoutes from "./routes/sync.js";
import payrollRoutes from "./routes/payroll.js";
import notificationRoutes from "./routes/notifications.js";
import fileRoutes from "./routes/files.js";
import workerRoutes from "./routes/workers.js";
import accountRoutes from "./routes/account.js";
import { Prisma } from "@prisma/client";
import { config, corsOrigins } from "./config.js";

const frontendDistDir = path.resolve(process.env.FRONTEND_DIST_DIR ?? path.join(process.cwd(), "frontend", "dist"));
const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

async function fileExists(filePath: string) {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

export async function buildApp() {
  const app = Fastify({ logger: { redact: ["req.headers.authorization", "body.password", "body.pin", "body.currentPin", "body.payrollDetails", "body.payrollDetailsEncrypted"] }, trustProxy: config.TRUST_PROXY });
  await app.register(helmet);
  await app.register(cors, { origin: corsOrigins.length ? corsOrigins : false });
  await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  await app.register(swagger, { openapi: { info: { title: "TirGeo API", version: "0.1.0", description: "Offline-capable Australian civil construction operations API" } } });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  await app.register(database); await app.register(auth);
  app.get("/health", async () => ({ status: "ok", service: "tirgeo-backend" }));
  app.get("/ready", async (_req, reply) => {
    try { await app.prisma.$queryRaw`SELECT 1`; return { status: "ready", service: "tirgeo-backend" }; }
    catch { return reply.code(503).send({ status: "not_ready", service: "tirgeo-backend" }); }
  });
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(projectRoutes, { prefix: "/api/v1/projects" });
  await app.register(timesheetRoutes, { prefix: "/api/v1/timesheets" });
  await app.register(plantRoutes, { prefix: "/api/v1/plant" });
  await app.register(safetyRoutes, { prefix: "/api/v1/safety" });
  await app.register(fieldRoutes, { prefix: "/api/v1/field" });
  await app.register(commercialRoutes, { prefix: "/api/v1/commercial" });
  await app.register(syncRoutes, { prefix: "/api/v1/sync" });
  await app.register(payrollRoutes, { prefix: "/api/v1/payroll" });
  await app.register(notificationRoutes, { prefix: "/api/v1/notifications" });
  await app.register(fileRoutes, { prefix: "/api/v1/files" });
  await app.register(workerRoutes, { prefix: "/api/v1/workers" });
  await app.register(accountRoutes, { prefix: "/api/v1/account" });
  app.get("/*", async (req, reply) => {
    const requestPath = new URL(req.raw.url ?? "/", "http://localhost").pathname;
    if (requestPath.startsWith("/api/")) return reply.code(404).send({ error: "Route not found", code: "NOT_FOUND" });

    const decodedPath = decodeURIComponent(requestPath);
    const candidate = path.resolve(frontendDistDir, decodedPath === "/" ? "index.html" : decodedPath.slice(1));
    const safeCandidate = candidate === frontendDistDir || candidate.startsWith(`${frontendDistDir}${path.sep}`);
    const filePath = safeCandidate && await fileExists(candidate) ? candidate : path.join(frontendDistDir, "index.html");

    if (!await fileExists(filePath)) return reply.code(404).send({ error: "Frontend build not found", code: "FRONTEND_NOT_BUILT" });
    reply.type(mimeTypes[path.extname(filePath)] ?? "application/octet-stream");
    return reply.send(createReadStream(filePath));
  });
  app.setErrorHandler((error, _req, reply) => {
    const err = error as Error & { statusCode?: number };
    if (err.name === "ZodError") return reply.code(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: JSON.parse(err.message) });
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") return reply.code(404).send({ error: "Record not found", code: "NOT_FOUND" });
      if (error.code === "P2002") return reply.code(409).send({ error: "A record with these values already exists", code: "CONFLICT" });
      if (error.code === "P2003") return reply.code(400).send({ error: "Referenced record is invalid", code: "INVALID_REFERENCE" });
      if (error.code === "P2034") return reply.code(409).send({ error: "Concurrent update conflict; retry the request", code: "CONCURRENT_CONFLICT" });
    }
    app.log.error(err); return reply.code(err.statusCode ?? 500).send({ error: err.statusCode ? err.message : "Internal server error" });
  });
  return app;
}

let appPromise: ReturnType<typeof buildApp> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  appPromise ??= buildApp().then(async app => {
    await app.ready();
    return app;
  });
  const app = await appPromise;
  app.server.emit("request", req, res);
}
