import { describe, expect, it } from "vitest";
import { timesheetContentHash, validateTimesheetEntries } from "../src/lib/timesheet.js";

const card = {
  id: "card-1", projectId: "project-1", workerId: "worker-1", weekEnding: new Date("2026-07-05T00:00:00Z"),
  entries: [{ id: "entry-1", costCodeId: null, workDate: new Date("2026-07-01T00:00:00Z"), startedAt: new Date("2026-07-01T07:00:00Z"), finishedAt: new Date("2026-07-01T15:30:00Z"), unpaidBreakMinutes: 30, ordinaryMinutes: 480, overtimeMinutes: 0, allowanceCodes: [], notes: null }],
};

describe("signed timecards", () => {
  it("has a stable content hash", () => expect(timesheetContentHash(card)).toBe(timesheetContentHash({ ...card, entries: [...card.entries] })));
  it("detects a change after employee signing", () => expect(timesheetContentHash(card)).not.toBe(timesheetContentHash({ ...card, entries: [{ ...card.entries[0]!, ordinaryMinutes: 540 }] })));
  it("rejects payroll minutes that do not reconcile to elapsed time", () => expect(validateTimesheetEntries([{ ...card.entries[0]!, ordinaryMinutes: 600 }], card.weekEnding)).toContain("entry-1: ordinary plus overtime minutes must equal worked minutes after breaks"));
  it("rejects overlapping shifts", () => {
    const second = { ...card.entries[0]!, id: "entry-2", startedAt: new Date("2026-07-01T15:00:00Z"), finishedAt: new Date("2026-07-01T16:00:00Z"), unpaidBreakMinutes: 0, ordinaryMinutes: 60 };
    expect(validateTimesheetEntries([card.entries[0]!, second], card.weekEnding)).toContain("entry-2: shift overlaps another entry");
  });
  it("uses the organisation timezone for Australian work dates", () => {
    const sydneyShift = { ...card.entries[0]!, workDate: new Date("2026-07-01T00:00:00Z"), startedAt: new Date("2026-06-30T21:00:00Z"), finishedAt: new Date("2026-07-01T05:30:00Z") };
    expect(validateTimesheetEntries([sydneyShift], card.weekEnding, "Australia/Sydney")).toEqual([]);
  });
});
