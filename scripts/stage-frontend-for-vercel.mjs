import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const frontendDist = resolve("frontend", "dist");
const publicDir = resolve("public");

await rm(publicDir, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });
await cp(frontendDist, publicDir, { recursive: true });
