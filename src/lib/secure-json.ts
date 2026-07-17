import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";

const key = createHash("sha256").update(config.JWT_SECRET).update(":tirgeo-payroll-details:v1").digest();

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  });
}

export function decryptJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  const envelope = JSON.parse(value) as { v: number; iv: string; tag: string; data: string };
  if (envelope.v !== 1) throw Object.assign(new Error("Unsupported encrypted payload version"), { statusCode: 500 });
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}
