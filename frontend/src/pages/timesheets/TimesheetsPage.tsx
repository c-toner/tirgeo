import { useMemo, useState } from "react";
import { Layout } from "../../components/Layout.tsx";
import { ProjectSelect } from "../../components/ProjectSelect.tsx";
import {
  EmptyState,
  ErrorAlert,
  Field,
  Icon,
  Loading,
  Modal,
  Select,
  StatusBadge,
  TextArea,
  TextInput,
  useToast,
} from "../../components/ui.tsx";
import { SignaturePad } from "../../components/SignaturePad.tsx";
import type { SignatureValue } from "../../components/SignaturePad.tsx";
import { WorkerSelect } from "../../components/WorkerSelect.tsx";
import { api } from "../../lib/api.ts";
import { TIMESHEET_APPROVERS, useAuth } from "../../lib/auth.tsx";
import { formatDate, minutesToHours, titleCase, uuid } from "../../lib/format.ts";
import { usePath } from "../../lib/router.tsx";
import type { ApproverSummary, Timesheet } from "../../lib/types.ts";
import { useApiQuery, useMutation } from "../../lib/useApi.ts";

interface EntryDraft {
  id: string;
  workDate: string;
  start: string;
  finish: string;
  breakMinutes: string;
  overtimeMinutes: string;
  allowances: string;
  notes: string;
}

function localDate(value = new Date()): string {
  const offset = value.getTimezoneOffset() * 60000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

function yesterday(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return localDate(date);
}

function newEntry(date?: string): EntryDraft {
  return {
    id: uuid(),
    workDate: date ?? localDate(),
    start: "07:00",
    finish: "15:30",
    breakMinutes: "30",
    overtimeMinutes: "0",
    allowances: "",
    notes: "",
  };
}

function entryMinutes(entry: EntryDraft): { elapsed: number; ordinary: number; overtime: number } {
  if (!entry.workDate || !entry.start || !entry.finish) return { elapsed: 0, ordinary: 0, overtime: 0 };
  const start = new Date(`${entry.workDate}T${entry.start}`);
  const finish = new Date(`${entry.workDate}T${entry.finish}`);
  const elapsed = Math.max(0, Math.round((finish.getTime() - start.getTime()) / 60000)) - (Number(entry.breakMinutes) || 0);
  const overtime = Math.min(Number(entry.overtimeMinutes) || 0, Math.max(elapsed, 0));
  return { elapsed: Math.max(elapsed, 0), ordinary: Math.max(elapsed - overtime, 0), overtime };
}

/** Sunday on/after the latest entered work date, used for payroll grouping. */
function weekEndingForEntries(entries: EntryDraft[]): string {
  const dates = entries.map(entry => entry.workDate).filter(Boolean).sort();
  const base = dates.length ? new Date(`${dates[dates.length - 1]}T00:00:00`) : new Date();
  base.setDate(base.getDate() + ((7 - base.getDay()) % 7));
  return localDate(base);
}

function timecardLabel(timesheet: Timesheet): string {
  const dates = [...new Set(timesheet.entries.map(entry => formatDate(entry.workDate)))];
  if (dates.length === 1) return dates[0]!;
  return `${dates.length} days to ${formatDate(timesheet.weekEnding)}`;
}

function DraftTimesheetModal({ onClose, onCreated }: { onClose: () => void; onCreated: (timesheet: Timesheet) => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const { data: approvers } = useApiQuery<ApproverSummary[]>("/api/v1/timesheets/approvers");
  const [projectId, setProjectId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [entries, setEntries] = useState<EntryDraft[]>([newEntry()]);
  const [signedName, setSignedName] = useState(user?.name ?? "");
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [consent, setConsent] = useState(false);
  const [lodgedTimesheet, setLodgedTimesheet] = useState<Timesheet | null>(null);
  const [approvalMode, setApprovalMode] = useState<"request" | "onsite" | null>(null);
  const [approverUserId, setApproverUserId] = useState("");
  const [pin, setPin] = useState("");
  const [approverName, setApproverName] = useState("");
  const [approverSignature, setApproverSignature] = useState<SignatureValue | null>(null);
  const weekEnding = weekEndingForEntries(entries);

  const patch = (index: number, changes: Partial<EntryDraft>) =>
    setEntries((list) => list.map((entry, i) => (i === index ? { ...entry, ...changes } : entry)));

  const totals = useMemo(() => {
    const sums = entries.map(entryMinutes);
    return {
      ordinary: sums.reduce((sum, e) => sum + e.ordinary, 0),
      overtime: sums.reduce((sum, e) => sum + e.overtime, 0),
    };
  }, [entries]);

  const createPayload = () => ({
    projectId,
    workerId: workerId.trim(),
    weekEnding: new Date(weekEnding + "T00:00:00.000Z").toISOString(),
    entries: entries
      .filter((entry) => entry.workDate)
      .map((entry) => {
        const minutes = entryMinutes(entry);
        return {
          id: entry.id,
          workDate: new Date(entry.workDate + "T00:00:00.000Z").toISOString(),
          startedAt: new Date(`${entry.workDate}T${entry.start}`).toISOString(),
          finishedAt: new Date(`${entry.workDate}T${entry.finish}`).toISOString(),
          unpaidBreakMinutes: Number(entry.breakMinutes) || 0,
          ordinaryMinutes: minutes.ordinary,
          overtimeMinutes: minutes.overtime,
          allowanceCodes: entry.allowances
            .split(",")
            .map((code) => code.trim())
            .filter(Boolean),
          notes: entry.notes.trim() || undefined,
        };
      }),
  });

  const lodgeMutation = useMutation(
    () =>
      api<Timesheet>("/api/v1/timesheets/lodge", {
        method: "POST",
        body: {
          ...createPayload(),
          signedName: signedName.trim(),
          signature: signature!.signature,
          signatureMethod: signature!.signatureMethod,
          consent: true,
        },
      }),
    ["/api/v1/timesheets"],
  );
  const requestMutation = useMutation(
    () => api(`/api/v1/timesheets/${lodgedTimesheet!.id}/request-approval`, { method: "POST", body: { approverUserId } }),
    ["/api/v1/notifications", "/api/v1/timesheets"],
  );
  const onsiteMutation = useMutation(
    () =>
      api<Timesheet>(`/api/v1/timesheets/${lodgedTimesheet!.id}/onsite-approve`, {
        method: "POST",
        body: {
          approverUserId,
          pin,
          signedName: approverName.trim(),
          signature: approverSignature!.signature,
          signatureMethod: approverSignature!.signatureMethod,
          consent: true,
        },
      }),
    ["/api/v1/notifications", "/api/v1/timesheets"],
  );

  const error = lodgeMutation.error || requestMutation.error || onsiteMutation.error;
  const issues = (lodgeMutation.error?.body as { issues?: Array<{ message?: string; entryId?: string }> } | undefined)?.issues;
  const canLodge = Boolean(
    !lodgedTimesheet &&
    projectId &&
    workerId.trim() &&
    weekEnding &&
    entries.some((entry) => entry.workDate) &&
    signedName.trim().length >= 2 &&
    signature &&
    consent,
  );

  return (
    <Modal
      title="New timecard"
      large
      onClose={onClose}
      footer={
        <>
          <div className="row" style={{ marginRight: "auto" }}>
            <span className="muted">
              Ordinary <b>{minutesToHours(totals.ordinary)}h</b> · Overtime <b>{minutesToHours(totals.overtime)}h</b>
            </span>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>
            {lodgedTimesheet ? "Done" : "Cancel"}
          </button>
          {!lodgedTimesheet && (
            <button
              className="btn btn-primary"
              disabled={lodgeMutation.running || !canLodge}
              onClick={() =>
                lodgeMutation.run({
                  onSuccess: (timesheet) => {
                    setLodgedTimesheet(timesheet);
                    toast.push("Timecard lodged");
                    onCreated(timesheet);
                  },
                })
              }
            >
              {lodgeMutation.running ? "Lodging..." : "Sign timecard"}
            </button>
          )}
          {lodgedTimesheet && approvalMode === "request" && (
            <button
              className="btn btn-primary"
              disabled={requestMutation.running || !approverUserId}
              onClick={() =>
                requestMutation.run({
                  onSuccess: () => {
                    toast.push("Signature requested");
                    onClose();
                  },
                })
              }
            >
              {requestMutation.running ? "Requesting..." : "Request signature"}
            </button>
          )}
          {lodgedTimesheet && approvalMode === "onsite" && (
            <button
              className="btn btn-primary"
              disabled={onsiteMutation.running || !approverUserId || !/^\d{4}$/.test(pin) || !approverSignature || approverName.trim().length < 2}
              onClick={() =>
                onsiteMutation.run({
                  onSuccess: () => {
                    toast.push("Timecard approved on site");
                    onClose();
                  },
                })
              }
            >
              {onsiteMutation.running ? "Signing..." : "Add signature & approve"}
            </button>
          )}
        </>
      }
    >
      <ErrorAlert error={error} onDismiss={() => { lodgeMutation.reset(); requestMutation.reset(); onsiteMutation.reset(); }} />
      {issues && issues.length > 0 && (
        <div className="alert alert-warning">
          <div>
            <b>Entry validation issues</b>
            {issues.map((issue, index) => (
              <div key={index} style={{ fontWeight: 400 }}>
                • {issue.message}
              </div>
            ))}
          </div>
        </div>
      )}
      {!lodgedTimesheet ? (
        <>
          <div className="form-grid">
            <Field label="Project" required>
              <ProjectSelect value={projectId} onChange={setProjectId} allowEmpty emptyLabel="— Select project —" activeOnly />
            </Field>
            <Field label="Worker" required span2 hint="Your linked worker is selected by default. Workers can only lodge their own timecards.">
              <WorkerSelect value={workerId} onChange={setWorkerId} />
            </Field>
          </div>

          <div className="row-between">
            <div>
              <h3>Daily timecards</h3>
              <span className="tiny">Do today, yesterday, or add several days for the week in one go.</span>
            </div>
            <div className="row">
              <button className="btn btn-ghost btn-sm" onClick={() => setEntries((list) => [...list, newEntry(localDate())])}>
                Today
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEntries((list) => [...list, newEntry(yesterday())])}>
                Yesterday
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEntries((list) => [...list, newEntry()])}>
                <Icon name="plus" size={13} /> Add day
              </button>
            </div>
          </div>

          {entries.map((entry, index) => {
            const minutes = entryMinutes(entry);
            return (
              <div key={entry.id} className="card card-pad stack" style={{ boxShadow: "none", gap: 10 }}>
                <div className="row" style={{ alignItems: "flex-end" }}>
                  <Field label="Work date" required>
                    <TextInput value={entry.workDate} onChange={(value) => patch(index, { workDate: value })} type="date" />
                  </Field>
                  <Field label="Start">
                    <TextInput value={entry.start} onChange={(value) => patch(index, { start: value })} type="time" />
                  </Field>
                  <Field label="Finish">
                    <TextInput value={entry.finish} onChange={(value) => patch(index, { finish: value })} type="time" />
                  </Field>
                  <Field label="Break (min)">
                    <TextInput value={entry.breakMinutes} onChange={(value) => patch(index, { breakMinutes: value })} type="number" min={0} inputMode="numeric" />
                  </Field>
                  <Field label="Overtime (min)">
                    <TextInput value={entry.overtimeMinutes} onChange={(value) => patch(index, { overtimeMinutes: value })} type="number" min={0} inputMode="numeric" />
                  </Field>
                  <button className="btn-icon" style={{ marginBottom: 4 }} aria-label="Remove shift" onClick={() => setEntries((list) => list.filter((_, i) => i !== index))} disabled={entries.length === 1}>
                    <Icon name="x" size={14} />
                  </button>
                </div>
                <div className="row">
                  <Field label="Allowance codes (comma-separated)">
                    <TextInput value={entry.allowances} onChange={(value) => patch(index, { allowances: value })} placeholder="e.g. TRAVEL, MEAL" />
                  </Field>
                  <Field label="Notes">
                    <TextInput value={entry.notes} onChange={(value) => patch(index, { notes: value })} />
                  </Field>
                </div>
                <span className="tiny">
                  Worked {minutesToHours(minutes.elapsed)}h → ordinary {minutesToHours(minutes.ordinary)}h + overtime {minutesToHours(minutes.overtime)}h
                </span>
              </div>
            );
          })}

          <div className="stack">
            <h3>Sign</h3>
            <SignaturePad signedName={signedName} onNameChange={setSignedName} onChange={setSignature} />
            <label className="row" style={{ gap: 8, alignItems: "flex-start", fontSize: 13 }}>
              <input type="checkbox" checked={consent} onChange={(e: { target: { checked: boolean } }) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
              <span>I confirm this timecard is a complete and accurate record of the hours I worked.</span>
            </label>
          </div>
        </>
      ) : (
        <div className="stack">
          <div className="alert alert-info">
            Timecard lodged. Pick how the manager or supervisor will countersign it.
          </div>
          <div className="seg" style={{ width: "fit-content" }}>
            <button type="button" className={approvalMode === "onsite" ? "on-pass" : ""} onClick={() => setApprovalMode("onsite")}>
              Add signature + PIN
            </button>
            <button type="button" className={approvalMode === "request" ? "on-pass" : ""} onClick={() => setApprovalMode("request")}>
              Request signature
            </button>
          </div>
          {approvalMode && (
            <Field label="Approver" required hint="Owner, admin, PM, supervisor or foreman.">
              <Select
                value={approverUserId}
                onChange={setApproverUserId}
                allowEmpty
                emptyLabel="— Select approver —"
                options={(approvers ?? []).map((approver) => ({
                  value: approver.id,
                  label: `${approver.name} (${titleCase(approver.role)})`,
                }))}
              />
            </Field>
          )}
          {approvalMode === "onsite" && (
            <>
              <Field label="Approver PIN" required hint="The approver enters their 4-digit signing PIN.">
                <TextInput value={pin} onChange={setPin} type="password" inputMode="numeric" maxLength={4} placeholder="0000" />
              </Field>
              <SignaturePad signedName={approverName} onNameChange={setApproverName} onChange={setApproverSignature} nameLabel="Approver name" />
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function SubmitModal({ timesheetId, onClose }: { timesheetId: string; onClose: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const { data: approvers } = useApiQuery<ApproverSummary[]>("/api/v1/timesheets/approvers");
  const [lodged, setLodged] = useState(false);
  const [approvalMode, setApprovalMode] = useState<"request" | "onsite" | null>(null);
  const [approverUserId, setApproverUserId] = useState("");
  const [signedName, setSignedName] = useState(user?.name ?? "");
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [pin, setPin] = useState("");
  const [approverName, setApproverName] = useState("");
  const [approverSignature, setApproverSignature] = useState<SignatureValue | null>(null);
  const [consent, setConsent] = useState(false);

  const signMutation = useMutation(
    () =>
      api<Timesheet>(`/api/v1/timesheets/${timesheetId}/submit`, {
        method: "POST",
        body: {
          signedName: signedName.trim(),
          signature: signature!.signature,
          signatureMethod: signature!.signatureMethod,
          consent: true,
        },
      }),
    ["/api/v1/timesheets"],
  );
  const requestMutation = useMutation(
    () => api(`/api/v1/timesheets/${timesheetId}/request-approval`, { method: "POST", body: { approverUserId } }),
    ["/api/v1/notifications", "/api/v1/timesheets"],
  );
  const onsiteMutation = useMutation(
    () =>
      api<Timesheet>(`/api/v1/timesheets/${timesheetId}/onsite-approve`, {
        method: "POST",
        body: {
          approverUserId,
          pin,
          signedName: approverName.trim(),
          signature: approverSignature!.signature,
          signatureMethod: approverSignature!.signatureMethod,
          consent: true,
        },
      }),
    ["/api/v1/notifications", "/api/v1/timesheets"],
  );

  return (
    <Modal
      title="Lodge timecard"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {lodged ? "Done" : "Cancel"}
          </button>
          {!lodged && (
            <button
              className="btn btn-accent"
              disabled={signMutation.running || !signature || signedName.trim().length < 2 || !consent}
              onClick={() =>
                signMutation.run({
                  onSuccess: () => {
                    setLodged(true);
                    toast.push("Timecard lodged");
                  },
                })
              }
            >
              {signMutation.running ? "Lodging..." : "Sign & lodge"}
            </button>
          )}
          {lodged && approvalMode === "request" && (
            <button
              className="btn btn-primary"
              disabled={requestMutation.running || !approverUserId}
              onClick={() =>
                requestMutation.run({
                  onSuccess: () => {
                    toast.push("Signature requested");
                    onClose();
                  },
                })
              }
            >
              {requestMutation.running ? "Requesting..." : "Request signature"}
            </button>
          )}
          {lodged && approvalMode === "onsite" && (
            <button
              className="btn btn-primary"
              disabled={onsiteMutation.running || !approverUserId || !/^\d{4}$/.test(pin) || !approverSignature || approverName.trim().length < 2}
              onClick={() =>
                onsiteMutation.run({
                  onSuccess: () => {
                    toast.push("Timecard approved on site");
                    onClose();
                  },
                })
              }
            >
              {onsiteMutation.running ? "Signing..." : "Add signature & approve"}
            </button>
          )}
        </>
      }
    >
      <ErrorAlert error={signMutation.error || requestMutation.error || onsiteMutation.error} onDismiss={() => { signMutation.reset(); requestMutation.reset(); onsiteMutation.reset(); }} />
      {!lodged ? (
        <>
          <SignaturePad signedName={signedName} onNameChange={setSignedName} onChange={setSignature} />
          <label className="row" style={{ gap: 8, alignItems: "flex-start", fontSize: 13 }}>
            <input type="checkbox" checked={consent} onChange={(e: { target: { checked: boolean } }) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
            <span>I confirm this timecard is a complete and accurate record of the hours I worked.</span>
          </label>
        </>
      ) : (
        <div className="stack">
          <div className="alert alert-info">
            Timecard lodged. Pick how the manager or supervisor will countersign it.
          </div>
          <div className="seg" style={{ width: "fit-content" }}>
            <button type="button" className={approvalMode === "onsite" ? "on-pass" : ""} onClick={() => setApprovalMode("onsite")}>
              Add signature + PIN
            </button>
            <button type="button" className={approvalMode === "request" ? "on-pass" : ""} onClick={() => setApprovalMode("request")}>
              Request signature
            </button>
          </div>
          {approvalMode && (
            <Field label="Approver" required hint="Owner, admin, PM, supervisor or foreman.">
              <Select
                value={approverUserId}
                onChange={setApproverUserId}
                allowEmpty
                emptyLabel="— Select approver —"
                options={(approvers ?? []).map((approver) => ({
                  value: approver.id,
                  label: `${approver.name} (${titleCase(approver.role)})`,
                }))}
              />
            </Field>
          )}
          {approvalMode === "onsite" && (
            <>
              <Field label="Approver PIN" required hint="The approver enters their 4-digit signing PIN.">
                <TextInput value={pin} onChange={setPin} type="password" inputMode="numeric" maxLength={4} placeholder="0000" />
              </Field>
              <SignaturePad signedName={approverName} onNameChange={setApproverName} onChange={setApproverSignature} nameLabel="Approver name" />
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function ApproveModal({
  timesheetId,
  mode,
  onClose,
}: {
  timesheetId: string;
  mode: "approve" | "onsite";
  onClose: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const { data: approvers } = useApiQuery<ApproverSummary[]>(mode === "onsite" ? "/api/v1/timesheets/approvers" : null);
  const [approverUserId, setApproverUserId] = useState("");
  const [pin, setPin] = useState("");
  const [signedName, setSignedName] = useState(mode === "approve" ? (user?.name ?? "") : "");
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [consent, setConsent] = useState(false);

  const mutation = useMutation(
    () =>
      mode === "approve"
        ? api<Timesheet>(`/api/v1/timesheets/${timesheetId}/approve`, {
            method: "POST",
            body: {
              signedName: signedName.trim(),
              signature: signature!.signature,
              signatureMethod: signature!.signatureMethod,
              consent: true,
            },
          })
        : api<Timesheet>(`/api/v1/timesheets/${timesheetId}/onsite-approve`, {
            method: "POST",
            body: {
              approverUserId,
              pin,
              signedName: signedName.trim(),
              signature: signature!.signature,
              signatureMethod: signature!.signatureMethod,
              consent: true,
            },
          }),
    ["/api/v1/notifications", "/api/v1/timesheets"],
  );

  const ready =
    signature && signedName.trim().length >= 2 && consent && (mode === "approve" || (approverUserId && /^\d{4}$/.test(pin)));

  return (
    <Modal
      title={mode === "approve" ? "Approve timecard" : "On-site countersign (shared device)"}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || !ready}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push("Timecard approved");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Signing…" : "Countersign & approve"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      {mutation.error?.status === 409 && (
        <div className="alert alert-warning">
          The timecard changed after the employee signed it, or a signing PIN has not been created yet.
        </div>
      )}
      {mode === "onsite" && (
        <>
          <div className="alert alert-info">
            The employee stays logged in and hands you the device. Your PIN verifies you as the approver — the audit
            record shows you, not the employee.
          </div>
          <Field label="Approver" required>
            <Select
              value={approverUserId}
              onChange={setApproverUserId}
              allowEmpty
              emptyLabel="— Who is approving? —"
              options={(approvers ?? []).map((approver) => ({
                value: approver.id,
                label: `${approver.name} (${titleCase(approver.role)})`,
              }))}
            />
          </Field>
          <Field label="Signing PIN" required hint="4 digits. Set once in Settings after first login. 5 failed attempts locks for 15 minutes.">
            <TextInput value={pin} onChange={setPin} type="password" inputMode="numeric" maxLength={4} placeholder="••••" />
          </Field>
        </>
      )}
      <SignaturePad signedName={signedName} onNameChange={setSignedName} onChange={setSignature} nameLabel="Approver name" />
      <label className="row" style={{ gap: 8, alignItems: "flex-start", fontSize: 13 }}>
        <input type="checkbox" checked={consent} onChange={(e: { target: { checked: boolean } }) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
        <span>I have reviewed this timecard and approve the recorded hours.</span>
      </label>
    </Modal>
  );
}

function RejectModal({ timesheetId, onClose }: { timesheetId: string; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const mutation = useMutation(
    () => api(`/api/v1/timesheets/${timesheetId}/reject`, { method: "POST", body: { reason: reason.trim() } }),
    ["/api/v1/notifications", "/api/v1/timesheets"],
  );
  return (
    <Modal
      title="Reject timecard"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            disabled={mutation.running || reason.trim().length < 3}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push("Timecard rejected — the worker can create a correction");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Rejecting…" : "Reject"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <Field label="Reason" required hint="Shown to the worker and kept on the immutable rejected card.">
        <TextArea value={reason} onChange={setReason} rows={3} />
      </Field>
    </Modal>
  );
}

export function TimesheetsPage() {
  const { user, hasRole } = useAuth();
  const isApprover = hasRole(...TIMESHEET_APPROVERS);
  const toast = useToast();
  const path = usePath();
  const openParam = path.includes("open=") ? path.split("open=")[1]?.split("&")[0] : "";

  const [drafting, setDrafting] = useState(false);
  const [submitFor, setSubmitFor] = useState<string | null>(null);
  const [approveFor, setApproveFor] = useState<string | null>(null);
  const [onsiteFor, setOnsiteFor] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [actionId, setActionId] = useState(openParam ?? "");
  const [, forceRender] = useState(0);
  const { data: myTimecards, loading: myLoading, error: myError, refresh: refreshMine } = useApiQuery<Timesheet[]>("/api/v1/timesheets");
  const { data: pendingApprovals, loading: pendingLoading, error: pendingError, refresh: refreshPending } = useApiQuery<Timesheet[]>(isApprover ? "/api/v1/timesheets/pending-approvals" : null);

  const correct = async (id: string) => {
    try {
      await api<Timesheet>(`/api/v1/timesheets/${id}/correct`, { method: "POST" });
      toast.push("Correction draft created — review, sign and resubmit");
      refreshMine();
      forceRender((n) => n + 1);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Correction failed", "error");
    }
  };

  return (
    <Layout
      title="Timesheets"
      actions={
        <button className="btn btn-primary" onClick={() => setDrafting(true)}>
          <Icon name="plus" size={15} /> New timecard
        </button>
      }
    >
      {user?.signaturePinRequired && (
        <div className="alert alert-warning">
          <Icon name="pen" size={16} />
          <span>
            You haven't created a signing PIN yet. Set one in <a href="#/settings">Settings</a> so you can countersign
            timecards on a shared device.
          </span>
        </div>
      )}

      <section className="card">
        <div className="card-header">
          <h2>My timecards</h2>
          <span className="hint">Only timecards linked to your signed-in worker account are shown here.</span>
        </div>
        <ErrorAlert error={myError} />
        {myLoading && <Loading />}
        {!myLoading && (myTimecards?.length ?? 0) === 0 ? (
          <EmptyState
            title="No timecards yet"
            hint="Create today or yesterday's card, sign it and pick your approver. You can add several days at once when catching up."
            action={
              <button className="btn btn-primary" onClick={() => setDrafting(true)}>
                <Icon name="plus" size={15} /> New timecard
              </button>
            }
          />
        ) : !myLoading && myTimecards && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Timecard</th>
                  <th>Detail</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {myTimecards.map((card) => (
                  <tr key={card.id}>
                    <td>
                      <b>{timecardLabel(card)}</b>
                      <div className="mono tiny">{card.id}</div>
                    </td>
                    <td className="tiny">
                      {card.project ? `${card.project.code} · ${card.project.name}` : card.projectId}
                      <br />
                      {card.entries.length} shift{card.entries.length === 1 ? "" : "s"} · payroll week {formatDate(card.weekEnding)}
                    </td>
                    <td>
                      <StatusBadge status={card.status} />
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "nowrap" }}>
                        {card.status === "DRAFT" && (
                          <button className="btn btn-accent btn-sm" onClick={() => setSubmitFor(card.id)}>
                            Finish & lodge
                          </button>
                        )}
                        {card.status === "SUBMITTED" && (
                          <button className="btn btn-ghost btn-sm" onClick={() => setOnsiteFor(card.id)}>
                            On-site countersign
                          </button>
                        )}
                        {card.status === "REJECTED" && (
                          <button className="btn btn-ghost btn-sm" onClick={() => correct(card.id)}>
                            Create correction
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isApprover && (
        <section className="card">
          <div className="card-header">
            <h2>Awaiting your signature ({pendingApprovals?.length ?? 0})</h2>
            <span className="hint">Requested timecards that need your approval.</span>
          </div>
          <ErrorAlert error={pendingError} />
          {pendingLoading && <Loading />}
          {!pendingLoading && (!pendingApprovals || pendingApprovals.length === 0) && (
            <EmptyState title="No pending timecards" hint="Requested approvals will appear here." />
          )}
          {pendingApprovals && pendingApprovals.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Worker</th>
                    <th>Timecard</th>
                    <th>Hours</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pendingApprovals.map(card => {
                    const totals = card.entries.map(entry => entry.ordinaryMinutes + entry.overtimeMinutes).reduce((sum, value) => sum + value, 0);
                    return (
                      <tr key={card.id}>
                        <td>
                          <b>{card.worker ? `${card.worker.firstName} ${card.worker.lastName}` : "Worker"}</b>
                          <div className="tiny">{card.project ? `${card.project.code} · ${card.project.name}` : card.projectId}</div>
                        </td>
                        <td>
                          <b>{timecardLabel(card)}</b>
                          <div className="mono tiny">{card.id}</div>
                        </td>
                        <td className="tiny">{minutesToHours(totals)}h</td>
                        <td>
                          <div className="row" style={{ justifyContent: "flex-end", gap: 6, flexWrap: "nowrap" }}>
                            <button className="btn btn-primary btn-sm" onClick={() => setApproveFor(card.id)}>Sign</button>
                            <button className="btn btn-danger btn-sm" onClick={() => setRejectFor(card.id)}>Reject</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {isApprover && (
        <section className="card">
          <div className="card-header">
            <h2>Find timecard</h2>
            <span className="hint">Use a timecard ID from a notification or message.</span>
          </div>
          <div className="card-pad stack">
            <div className="row">
              <input
                className="input mono"
                style={{ maxWidth: 380 }}
                placeholder="Timecard ID from the notification…"
                value={actionId}
                onChange={(e: { target: { value: string } }) => setActionId(e.target.value)}
              />
              <button className="btn btn-primary" disabled={!actionId.trim()} onClick={() => setApproveFor(actionId.trim())}>
                Approve
              </button>
              <button className="btn btn-danger" disabled={!actionId.trim()} onClick={() => setRejectFor(actionId.trim())}>
                Reject
              </button>
            </div>
            <span className="tiny">
              Approval re-hashes the card and refuses to sign if anything changed after the employee's signature.
            </span>
          </div>
        </section>
      )}

      {drafting && <DraftTimesheetModal onClose={() => setDrafting(false)} onCreated={() => forceRender((n) => n + 1)} />}
      {submitFor && <SubmitModal timesheetId={submitFor} onClose={() => { setSubmitFor(null); forceRender((n) => n + 1); }} />}
      {approveFor && <ApproveModal timesheetId={approveFor} mode="approve" onClose={() => { setApproveFor(null); refreshPending(); forceRender((n) => n + 1); }} />}
      {onsiteFor && <ApproveModal timesheetId={onsiteFor} mode="onsite" onClose={() => { setOnsiteFor(null); forceRender((n) => n + 1); }} />}
      {rejectFor && <RejectModal timesheetId={rejectFor} onClose={() => { setRejectFor(null); refreshPending(); forceRender((n) => n + 1); }} />}
    </Layout>
  );
}
