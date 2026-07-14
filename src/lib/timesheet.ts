import { createHash } from "node:crypto";

export type HashableTimesheet = {
  id: string;
  projectId: string;
  workerId: string;
  weekEnding: Date;
  entries: Array<{ id: string; costCodeId: string | null; workDate: Date; startedAt: Date; finishedAt: Date; unpaidBreakMinutes: number; ordinaryMinutes: number; overtimeMinutes: number; allowanceCodes: string[]; notes: string | null }>;
};

export function timesheetContentHash(timesheet: HashableTimesheet) {
  const stable = {
    id: timesheet.id, projectId: timesheet.projectId, workerId: timesheet.workerId, weekEnding: timesheet.weekEnding.toISOString(),
    entries: [...timesheet.entries].sort((a, b) => a.id.localeCompare(b.id)).map(e => ({ ...e, workDate: e.workDate.toISOString(), startedAt: e.startedAt.toISOString(), finishedAt: e.finishedAt.toISOString() })),
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

type ValidatableEntry = HashableTimesheet["entries"][number];
export function validateTimesheetEntries(entries: ValidatableEntry[], weekEnding: Date, timezone = "UTC") {
  const issues: string[] = []; const weekEndKey = weekEnding.toISOString().slice(0, 10); const weekStartKey = new Date(`${weekEndKey}T00:00:00.000Z`); weekStartKey.setUTCDate(weekStartKey.getUTCDate() - 6); const startKey = weekStartKey.toISOString().slice(0, 10);
  const localDate = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const localDateKey = (date: Date) => { const parts = Object.fromEntries(localDate.formatToParts(date).map(p => [p.type, p.value])); return `${parts.year}-${parts.month}-${parts.day}`; };
  const sorted = [...entries].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  for (const e of sorted) {
    const duration = (e.finishedAt.getTime() - e.startedAt.getTime()) / 60000;
    const workDay = e.workDate.toISOString().slice(0, 10); const startDay = localDateKey(e.startedAt);
    if (!Number.isInteger(duration) || duration <= 0 || duration > 24 * 60) issues.push(`${e.id}: shift duration must be between 1 minute and 24 hours`);
    if (e.unpaidBreakMinutes > duration) issues.push(`${e.id}: unpaid break exceeds shift duration`);
    if (e.ordinaryMinutes + e.overtimeMinutes !== duration - e.unpaidBreakMinutes) issues.push(`${e.id}: ordinary plus overtime minutes must equal worked minutes after breaks`);
    if (workDay !== startDay) issues.push(`${e.id}: workDate must match the shift start date in ${timezone}`);
    if (startDay < startKey || startDay > weekEndKey) issues.push(`${e.id}: shift is outside the selected week`);
  }
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.startedAt < sorted[i - 1]!.finishedAt) issues.push(`${sorted[i]!.id}: shift overlaps another entry`);
  return issues;
}
