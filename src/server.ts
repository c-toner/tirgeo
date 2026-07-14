import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = await buildApp();
await app.listen({ port: config.PORT, host: config.HOST });

let closing = false;
const shutdown = async (signal: string) => {
  if (closing) return; closing = true;
  app.log.info({ signal }, "Shutting down");
  await app.close();
};
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
