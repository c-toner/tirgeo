CREATE INDEX IF NOT EXISTS "Project_organisationId_status_idx"
  ON public."Project"("organisationId", "status");

CREATE INDEX IF NOT EXISTS "Timesheet_workerId_weekEnding_idx"
  ON public."Timesheet"("workerId", "weekEnding");

CREATE INDEX IF NOT EXISTS "TimesheetApprovalRequest_approverUserId_status_requestedAt_idx"
  ON public."TimesheetApprovalRequest"("approverUserId", "status", "requestedAt");

CREATE INDEX IF NOT EXISTS "TimeEntry_timesheetId_workDate_idx"
  ON public."TimeEntry"("timesheetId", "workDate");
