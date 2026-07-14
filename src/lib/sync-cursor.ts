import { z } from "zod";

const cursorValue = z.object({ occurredAt: z.string().datetime(), id: z.string().uuid() });
export type SyncCursor = { occurredAt: Date; id: string };

export function encodeSyncCursor(value: SyncCursor) {
  return Buffer.from(JSON.stringify({ occurredAt: value.occurredAt.toISOString(), id: value.id }), "utf8").toString("base64url");
}

export function decodeSyncCursor(value?: string): SyncCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = cursorValue.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return { occurredAt: new Date(parsed.occurredAt), id: parsed.id };
  } catch { throw Object.assign(new Error("Invalid sync cursor"), { statusCode: 400 }); }
}
