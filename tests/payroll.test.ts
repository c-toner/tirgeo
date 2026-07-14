import { describe, expect, it } from "vitest";
import { buildProviderPayload, canTransitionPayrollExport } from "../src/lib/payroll.js";

describe("payroll export workflow", () => {
  it("builds a provider-neutral export without changing hour precision", () => {
    const payload = buildProviderPayload("XERO", [{
      localTimesheetId: "ts-1", externalEmployeeId: "employee-7", periodEnd: "2026-07-05",
      lines: [{ date: "2026-07-01", ordinaryHours: 7.5, overtimeHours: 1.25, allowances: ["MEAL"], costCode: "EARTHWORKS" }],
    }]);
    expect(payload.provider).toBe("XERO");
    expect(payload.timesheets[0]?.lines[0]).toMatchObject({ ordinaryHours: 7.5, overtimeHours: 1.25, costCode: "EARTHWORKS" });
  });

  it("only permits forward, auditable export transitions", () => {
    expect(canTransitionPayrollExport("READY", "SENT")).toBe(true);
    expect(canTransitionPayrollExport("SENT", "RECONCILED")).toBe(true);
    expect(canTransitionPayrollExport("RECONCILED", "READY")).toBe(false);
    expect(canTransitionPayrollExport("READY", "RECONCILED")).toBe(false);
  });
});
