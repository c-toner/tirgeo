import type { IncomingMessage, ServerResponse } from "node:http";
import { buildApp } from "./app.js";

const appPromise = buildApp().then(async app => {
  await app.ready();
  return app;
});

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await appPromise;
  app.server.emit("request", req, res);
}
