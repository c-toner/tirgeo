import type { AccountingProvider } from "@prisma/client";

export type PayrollLine = {
  date: string;
  ordinaryHours: number;
  overtimeHours: number;
  allowances: string[];
  costCode?: string;
};

export type PayrollTimesheet = {
  localTimesheetId: string;
  externalEmployeeId: string;
  periodEnd: string;
  lines: PayrollLine[];
};

export function buildProviderPayload(provider: AccountingProvider, timesheets: PayrollTimesheet[]) {
  // Keep a stable TirGeo envelope. The live connector translates this into the
  // provider's current API shape and supplies mapped earnings/pay-item IDs.
  return { schemaVersion: 1, provider, generatedAt: new Date().toISOString(), timesheets };
}

const transitions: Record<string, string[]> = { READY: ["SENT", "FAILED"], SENDING: ["SENT", "FAILED"], SENT: ["RECONCILED", "FAILED"] };
export const canTransitionPayrollExport = (from: string, to: string) => transitions[from]?.includes(to) ?? false;
