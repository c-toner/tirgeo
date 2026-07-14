import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import multipart from "@fastify/multipart";
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
import { Prisma } from "@prisma/client";
import { config, corsOrigins } from "./config.js";

export async function buildApp() {
  const app = Fastify({ logger: { redact: ["req.headers.authorization", "body.password", "body.pin", "body.currentPin", "body.payrollDetailsEncrypted"] }, trustProxy: config.TRUST_PROXY });
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
