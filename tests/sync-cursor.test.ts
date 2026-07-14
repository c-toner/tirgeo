import { describe, expect, it } from "vitest";
import { decodeSyncCursor, encodeSyncCursor } from "../src/lib/sync-cursor.js";

describe("sync cursor", () => {
  it("round-trips timestamp and tie-breaker ID", () => {
    const value = { occurredAt: new Date("2026-07-03T01:02:03.456Z"), id: "550e8400-e29b-41d4-a716-446655440000" };
    expect(decodeSyncCursor(encodeSyncCursor(value))).toEqual(value);
  });
  it("rejects malformed cursors", () => expect(() => decodeSyncCursor("not-a-cursor")).toThrow("Invalid sync cursor"));
});
