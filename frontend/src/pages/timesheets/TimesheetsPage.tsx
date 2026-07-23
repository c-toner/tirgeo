import { useEffect, useMemo, useState } from "react";
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
import { formatDate, formatDateTime, minutesToHours, titleCase, uuid } from "../../lib/format.ts";
import { usePath } from "../../lib/router.tsx";
import type { ApproverSummary, Timesheet } from "../../lib/types.ts";
import { useApiQuery, useMutation } from "../../lib/useApi.ts";

const MANAGER_ROLES = ["PROJECT_MANAGER", "OPERATIONS_MANAGER"];

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

function isDefaultEntry(entry: EntryDraft): boolean {
  return entry.start === "07:00" &&
    entry.finish === "15:30" &&
    entry.breakMinutes === "30" &&
    entry.overtimeMinutes === "0" &&
    !entry.allowances.trim() &&
    !entry.notes.trim();
}

function entrySignature(entry: EntryDraft): string {
  return [entry.workDate, entry.start, entry.finish, entry.breakMinutes, entry.overtimeMinutes].join("|");
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

function timecardMinutes(timesheet: Timesheet): number {
  return timesheet.entries.reduce((sum, entry) => sum + entry.ordinaryMinutes + entry.overtimeMinutes, 0);
}

function workerName(timesheet: Timesheet): string {
  return timesheet.worker ? `${timesheet.worker.firstName} ${timesheet.worker.lastName}` : "Worker";
}

async function verifySigningPin(approverUserId: string, pin: string): Promise<string | null> {
  try {
    await api("/api/v1/timesheets/verify-signing-pin", { method: "POST", body: { approverUserId, pin } });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Signing PIN could not be verified";
  }
}

function DraftTimesheetModal({ onClose, onCreated }: { onClose: () => void; onCreated: (timesheet: Timesheet) => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const { data: approvers } = useApiQuery<ApproverSummary[]>("/api/v1/timesheets/approvers");
  const [projectId, setProjectId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [entries, setEntries] = useState<EntryDraft[]>([newEntry()]);
  const [approvalMode, setApprovalMode] = useState<"request" | "onsite" | null>(null);
  const [approverUserId, setApproverUserId] = useState("");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifyingPin, setVerifyingPin] = useState(false);
  const [onsiteVerified, setOnsiteVerified] = useState(false);
  const [approverSignature, setApproverSignature] = useState<SignatureValue | null>(null);
  const [signedName, setSignedName] = useState(user?.name ?? "");
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [consent, setConsent] = useState(false);
  const weekEnding = weekEndingForEntries(entries);

  useEffect(() => {
    if (!approverUserId && approvers?.[0]) setApproverUserId(approvers[0].id);
    if (!approvalMode && user?.role === "OWNER") setApprovalMode("onsite");
    if (!approvalMode && user?.role && MANAGER_ROLES.includes(user.role)) setApprovalMode("request");
  }, [approvalMode, approverUserId, approvers, user?.role]);

  const patch = (index: number, changes: Partial<EntryDraft>) =>
    setEntries((list) => list.map((entry, i) => (i === index ? { ...entry, ...changes } : entry)));

  const useQuickDate = (date: string) => {
    setEntries((list) => {
      if (!list.length) return [newEntry(date)];
      if (list.length === 1 && isDefaultEntry(list[0]!)) return [{ ...list[0]!, workDate: date }];
      if (list.some((entry) => entry.workDate === date)) {
        toast.push("That day is already on this timecard");
        return list;
      }
      return [...list, newEntry(date)];
    });
  };

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
      .filter((entry, index, list) => entry.workDate && list.findIndex((candidate) => entrySignature(candidate) === entrySignature(entry)) === index)
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
          allowanceCodes: entry.allowances.split(",").map((code) => code.trim()).filter(Boolean),
          notes: entry.notes.trim() || undefined,
        };
      }),
  });

  const lodgeMutation = useMutation(
    () =>
      api<Timesheet>("/api/v1/timesheets/lodge", {
        method: "POST",
        body: { ...createPayload(), approverUserId, signedName: signedName.trim(), signature: signature!.signature, signatureMethod: signature!.signatureMethod, consent: true },
      }),
    ["/api/v1/notifications", "/api/v1/timesheets"],
  );
  const onsiteMutation = useMutation(
    () =>
      api<Timesheet>("/api/v1/timesheets/lodge-onsite-approve", {
        method: "POST",
        body: {
          ...createPayload(),
          approverUserId,
          pin,
          approverSignedName: approvers?.find((approver) => approver.id === approverUserId)?.name ?? "Supervisor",
          approverSignature: approverSignature!.signature,
          approverSignatureMethod: approverSignature!.signatureMethod,
          approverConsent: true,
          signedName: signedName.trim(),
          signature: signature!.signature,
          signatureMethod: signature!.signatureMethod,
          consent: true,
        },
      }),
    ["/api/v1/notifications", "/api/v1/timesheets"],
  );

  const error = lodgeMutation.error || onsiteMutation.error;
  const issues = ((lodgeMutation.error ?? onsiteMutation.error)?.body as { issues?: Array<{ message?: string; entryId?: string }> } | undefined)?.issues;
  const selectedApprover = approvers?.find((approver) => approver.id === approverUserId);
  const selectedApproverName = selectedApprover?.name ?? "";
  const supervisorHandled = Boolean((approvalMode === "request" && approverUserId) || (approvalMode === "onsite" && onsiteVerified));
  const canSubmit = Boolean(projectId && workerId.trim() && weekEnding && entries.some((entry) => entry.workDate) && supervisorHandled && signedName.trim().length >= 2 && signature && consent);

  const resetSupervisorVerification = () => {
    setOnsiteVerified(false);
    onsiteMutation.reset();
  };
  const verifyOnsiteSupervisor = async () => {
    if (!approverUserId || !/^\d{4}$/.test(pin) || !approverSignature) return;
    setVerifyingPin(true);
    setPinError(null);
    resetSupervisorVerification();
    const error = await verifySigningPin(approverUserId, pin);
    setVerifyingPin(false);
    if (error) {
      setPinError(error);
      return;
    }
    setOnsiteVerified(true);
    toast.push("Supervisor signature verified");
  };

  const submit = () => {
    const mutation = approvalMode === "onsite" ? onsiteMutation : lodgeMutation;
    mutation.run({
      onSuccess: (timesheet) => {
        toast.push(approvalMode === "onsite" ? "Timecard signed and approved" : "Timecard lodged and signature requested");
        onCreated(timesheet as Timesheet);
        onClose();
      },
    });
  };

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
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={lodgeMutation.running || onsiteMutation.running || !canSubmit} onClick={submit}>
            {lodgeMutation.running || onsiteMutation.running ? "Submitting..." : approvalMode === "onsite" ? "Sign & approve timecard" : "Sign & request supervisor"}
          </button>
        </>
      }
    >
      <ErrorAlert error={error} onDismiss={() => { lodgeMutation.reset(); onsiteMutation.reset(); }} />
      {issues && issues.length > 0 && (
        <div className="alert alert-warning">
          <div>
            <b>Entry validation issues</b>
            {issues.map((issue, index) => <div key={index} style={{ fontWeight: 400 }}>• {issue.message}</div>)}
          </div>
        </div>
      )}

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
          <button className="btn btn-ghost btn-sm" onClick={() => useQuickDate(localDate())}>Today</button>
          <button className="btn btn-ghost btn-sm" onClick={() => useQuickDate(yesterday())}>Yesterday</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setEntries((list) => [...list, newEntry()])}><Icon name="plus" size={13} /> Add day</button>
        </div>
      </div>

      {entries.map((entry, index) => {
        const minutes = entryMinutes(entry);
        return (
          <div key={entry.id} className="card card-pad stack" style={{ boxShadow: "none", gap: 10 }}>
            <div className="timesheet-shift-grid">
              <Field label="Work date" required><TextInput value={entry.workDate} onChange={(value) => patch(index, { workDate: value })} type="date" /></Field>
              <Field label="Start"><TextInput value={entry.start} onChange={(value) => patch(index, { start: value })} type="time" /></Field>
              <Field label="Finish"><TextInput value={entry.finish} onChange={(value) => patch(index, { finish: value })} type="time" /></Field>
              <Field label="Break (min)"><TextInput value={entry.breakMinutes} onChange={(value) => patch(index, { breakMinutes: value })} type="number" min={0} inputMode="numeric" /></Field>
              <Field label="Overtime (min)"><TextInput value={entry.overtimeMinutes} onChange={(value) => patch(index, { overtimeMinutes: value })} type="number" min={0} inputMode="numeric" /></Field>
              <button className="btn-icon" style={{ marginBottom: 4 }} aria-label="Remove shift" onClick={() => setEntries((list) => list.filter((_, i) => i !== index))} disabled={entries.length === 1}><Icon name="x" size={14} /></button>
            </div>
            <div className="row">
              <Field label="Allowance codes (comma-separated)"><TextInput value={entry.allowances} onChange={(value) => patch(index, { allowances: value })} placeholder="e.g. TRAVEL, MEAL" /></Field>
              <Field label="Notes"><TextInput value={entry.notes} onChange={(value) => patch(index, { notes: value })} /></Field>
            </div>
            <span className="tiny">Worked {minutesToHours(minutes.elapsed)}h → ordinary {minutesToHours(minutes.ordinary)}h + overtime {minutesToHours(minutes.overtime)}h</span>
          </div>
        );
      })}

      <div className="stack">
        <h3>Supervisor signature</h3>
        <Field label="Supervisor" required hint="Pick who will approve this timecard before you sign it.">
          <Select
            value={approverUserId}
            onChange={(value) => { setApproverUserId(value); setPinError(null); resetSupervisorVerification(); }}
            allowEmpty
            emptyLabel="— Select supervisor —"
            options={(approvers ?? []).map((approver) => ({ value: approver.id, label: `${approver.name} (${titleCase(approver.role)})` }))}
          />
        </Field>
        <div className="seg" style={{ width: "fit-content" }}>
          <button type="button" className={approvalMode === "request" ? "on-pass" : ""} onClick={() => { setApprovalMode("request"); resetSupervisorVerification(); }}>Request signature</button>
          <button type="button" className={approvalMode === "onsite" ? "on-pass" : ""} onClick={() => { setApprovalMode("onsite"); resetSupervisorVerification(); }}>Sign now</button>
        </div>
        {approvalMode === "request" && approverUserId && <div className="alert alert-info">The supervisor will receive a notification after you sign and submit this timecard.</div>}
        {approvalMode === "onsite" && (
          <>
            <Field label="Supervisor PIN" required hint="The supervisor enters their 4-digit signing PIN." error={pinError ?? undefined}>
              <TextInput value={pin} onChange={(value) => { setPin(value); setPinError(null); resetSupervisorVerification(); }} type="password" inputMode="numeric" maxLength={4} placeholder="0000" invalid={!!pinError} />
            </Field>
            {selectedApproverName && <div className="tiny">Signing as <b>{selectedApproverName}</b></div>}
            {pinError && <div className="alert alert-critical">Incorrect supervisor PIN. Check the 4-digit PIN and try again.</div>}
            <SignaturePad signedName={selectedApproverName} onNameChange={() => undefined} onChange={(value) => { setApproverSignature(value); resetSupervisorVerification(); }} showNameField={false} />
            <button className="btn btn-primary" type="button" disabled={verifyingPin || !approverUserId || !/^\d{4}$/.test(pin) || !approverSignature} onClick={verifyOnsiteSupervisor}>
              {verifyingPin ? "Checking PIN..." : onsiteVerified ? "Supervisor verified" : "Verify supervisor signature"}
            </button>
          </>
        )}
      </div>

      {supervisorHandled && (
        <div className="stack">
          <h3>Employee signature</h3>
          <SignaturePad signedName={signedName} onNameChange={setSignedName} onChange={setSignature} />
          <label className="row" style={{ gap: 8, alignItems: "flex-start", fontSize: 13 }}>
            <input type="checkbox" checked={consent} onChange={(e: { target: { checked: boolean } }) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
            <span>I confirm this timecard is a complete and accurate record of the hours I worked.</span>
          </label>
        </div>
      )}
    </Modal>
  );
}

function SubmitModal({ timesheetId, onClose }: { timesheetId: string; onClose: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const { data: approvers } = useApiQuery<ApproverSummary[]>("/api/v1/timesheets/approvers");
  const [approvalMode, setApprovalMode] = useState<"request" | "onsite" | null>(null);
  const [approverUserId, setApproverUserId] = useState("");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifyingPin, setVerifyingPin] = useState(false);
  const [onsiteVerified, setOnsiteVerified] = useState(false);
  const [approverSignature, setApproverSignature] = useState<SignatureValue | null>(null);
  const [signedName, setSignedName] = useState(user?.name ?? "");
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    if (!approverUserId && approvers?.[0]) setApproverUserId(approvers[0].id);
    if (!approvalMode && user?.role === "OWNER") setApprovalMode("onsite");
    if (!approvalMode && user?.role && MANAGER_ROLES.includes(user.role)) setApprovalMode("request");
  }, [approvalMode, approverUserId, approvers, user?.role]);

  const signMutation = useMutation(
    () =>
      api<Timesheet>(`/api/v1/timesheets/${timesheetId}/submit`, {
        method: "POST",
        body: { approverUserId, signedName: signedName.trim(), signature: signature!.signature, signatureMethod: signature!.signatureMethod, consent: true },
      }),
    ["/api/v1/notifications", "/api/v1/timesheets"],
  );
  const onsiteMutation = useMutation(
    () =>
      api<Timesheet>(`/api/v1/timesheets/${timesheetId}/submit-onsite-approve`, {
        method: "POST",
        body: {
          approverUserId,
          pin,
          approverSignedName: approvers?.find((approver) => approver.id === approverUserId)?.name ?? "Supervisor",
          approverSignature: approverSignature!.signature,
          approverSignatureMethod: approverSignature!.signatureMethod,
          approverConsent: true,
          signedName: signedName.trim(),
          signature: signature!.signature,
          signatureMethod: signature!.signatureMethod,
          consent: true,
        },
      }),
    ["/api/v1/notifications", "/api/v1/timesheets"],
  );

  const supervisorHandled = Boolean((approvalMode === "request" && approverUserId) || (approvalMode === "onsite" && onsiteVerified));
  const selectedApprover = approvers?.find((approver) => approver.id === approverUserId);
  const selectedApproverName = selectedApprover?.name ?? "";
  const ready = Boolean(supervisorHandled && signature && signedName.trim().length >= 2 && consent);
  const resetSupervisorVerification = () => {
    setOnsiteVerified(false);
    onsiteMutation.reset();
  };
  const verifyOnsiteSupervisor = async () => {
    if (!approverUserId || !/^\d{4}$/.test(pin) || !approverSignature) return;
    setVerifyingPin(true);
    setPinError(null);
    resetSupervisorVerification();
    const error = await verifySigningPin(approverUserId, pin);
    setVerifyingPin(false);
    if (error) {
      setPinError(error);
      return;
    }
    setOnsiteVerified(true);
    toast.push("Supervisor signature verified");
  };

  const submit = () => {
    const mutation = approvalMode === "onsite" ? onsiteMutation : signMutation;
    mutation.run({
      onSuccess: () => {
        toast.push(approvalMode === "onsite" ? "Timecard signed and approved" : "Timecard lodged and signature requested");
        onClose();
      },
    });
  };

  return (
    <Modal
      title="Lodge timecard"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={verifyingPin || signMutation.running || onsiteMutation.running || !ready} onClick={submit}>
            {signMutation.running || onsiteMutation.running ? "Submitting..." : approvalMode === "onsite" ? "Sign & approve timecard" : "Sign & request supervisor"}
          </button>
        </>
      }
    >
      <ErrorAlert error={signMutation.error || onsiteMutation.error} onDismiss={() => { signMutation.reset(); onsiteMutation.reset(); }} />
      <div className="stack">
        <h3>Supervisor signature</h3>
        <Field label="Supervisor" required hint="Pick who will approve this timecard before you sign it.">
          <Select
            value={approverUserId}
            onChange={(value) => { setApproverUserId(value); setPinError(null); resetSupervisorVerification(); }}
            allowEmpty
            emptyLabel="— Select supervisor —"
            options={(approvers ?? []).map((approver) => ({ value: approver.id, label: `${approver.name} (${titleCase(approver.role)})` }))}
          />
        </Field>
        <div className="seg" style={{ width: "fit-content" }}>
          <button type="button" className={approvalMode === "request" ? "on-pass" : ""} onClick={() => { setApprovalMode("request"); resetSupervisorVerification(); }}>Request signature</button>
          <button type="button" className={approvalMode === "onsite" ? "on-pass" : ""} onClick={() => { setApprovalMode("onsite"); resetSupervisorVerification(); }}>Sign now</button>
        </div>
        {approvalMode === "request" && approverUserId && <div className="alert alert-info">The supervisor will receive a notification after you sign and submit this timecard.</div>}
        {approvalMode === "onsite" && (
          <>
            <Field label="Supervisor PIN" required hint="The supervisor enters their 4-digit signing PIN." error={pinError ?? undefined}>
              <TextInput value={pin} onChange={(value) => { setPin(value); setPinError(null); resetSupervisorVerification(); }} type="password" inputMode="numeric" maxLength={4} placeholder="0000" invalid={!!pinError} />
            </Field>
            {selectedApproverName && <div className="tiny">Signing as <b>{selectedApproverName}</b></div>}
            {pinError && <div className="alert alert-critical">Incorrect supervisor PIN. Check the 4-digit PIN and try again.</div>}
            <SignaturePad signedName={selectedApproverName} onNameChange={() => undefined} onChange={(value) => { setApproverSignature(value); resetSupervisorVerification(); }} showNameField={false} />
            <button className="btn btn-primary" type="button" disabled={verifyingPin || !approverUserId || !/^\d{4}$/.test(pin) || !approverSignature} onClick={verifyOnsiteSupervisor}>
              {verifyingPin ? "Checking PIN..." : onsiteVerified ? "Supervisor verified" : "Verify supervisor signature"}
            </button>
          </>
        )}
      </div>

      {supervisorHandled && (
        <div className="stack">
          <h3>Employee signature</h3>
          <SignaturePad signedName={signedName} onNameChange={setSignedName} onChange={setSignature} />
          <label className="row" style={{ gap: 8, alignItems: "flex-start", fontSize: 13 }}>
            <input type="checkbox" checked={consent} onChange={(e: { target: { checked: boolean } }) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
            <span>I confirm this timecard is a complete and accurate record of the hours I worked.</span>
          </label>
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
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifyingPin, setVerifyingPin] = useState(false);
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
            disabled={verifyingPin || mutation.running || !ready}
            onClick={async () => {
              if (mode === "onsite") {
                setVerifyingPin(true);
                setPinError(null);
                const error = await verifySigningPin(approverUserId, pin);
                setVerifyingPin(false);
                if (error) {
                  setPinError(error);
                  return;
                }
              }
              mutation.run({
                onSuccess: () => {
                  toast.push("Timecard approved");
                  onClose();
                },
              });
            }}
          >
            {verifyingPin ? "Checking PIN..." : mutation.running ? "Signing…" : "Countersign & approve"}
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
              onChange={(value) => {
                setApproverUserId(value);
                setPinError(null);
              }}
              allowEmpty
              emptyLabel="— Who is approving? —"
              options={(approvers ?? []).map((approver) => ({
                value: approver.id,
                label: `${approver.name} (${titleCase(approver.role)})`,
              }))}
            />
          </Field>
          <Field label="Signing PIN" required hint="4 digits. Set once in Settings after first login. 5 failed attempts locks for 15 minutes." error={pinError ?? undefined}>
            <TextInput value={pin} onChange={(value) => { setPin(value); setPinError(null); }} type="password" inputMode="numeric" maxLength={4} placeholder="••••" invalid={!!pinError} />
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

function TimecardDetailModal({
  timesheetId,
  canApprove,
  onClose,
  onApprove,
  onReject,
}: {
  timesheetId: string;
  canApprove: boolean;
  onClose: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const { data, loading, error } = useApiQuery<Timesheet>(`/api/v1/timesheets/${timesheetId}`);

  return (
    <Modal
      title="Timecard details"
      large
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          {canApprove && data?.status === "SUBMITTED" && (
            <>
              <button className="btn btn-danger" onClick={() => onReject(data.id)}>
                Reject
              </button>
              <button className="btn btn-primary" onClick={() => onApprove(data.id)}>
                Sign & approve
              </button>
            </>
          )}
        </>
      }
    >
      <ErrorAlert error={error} />
      {loading && <Loading />}
      {data && (
        <div className="stack">
          <div className="grid grid-3">
            <div className="summary-item">
              <span>Worker</span>
              <b>{workerName(data)}</b>
            </div>
            <div className="summary-item">
              <span>Project</span>
              <b>{data.project ? `${data.project.code} - ${data.project.name}` : "Project not loaded"}</b>
            </div>
            <div className="summary-item">
              <span>Status</span>
              <b><StatusBadge status={data.status} /></b>
            </div>
            <div className="summary-item">
              <span>Timecard</span>
              <b>{timecardLabel(data)}</b>
            </div>
            <div className="summary-item">
              <span>Payroll week</span>
              <b>{formatDate(data.weekEnding)}</b>
            </div>
            <div className="summary-item">
              <span>Total hours</span>
              <b>{minutesToHours(timecardMinutes(data))}h</b>
            </div>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Start</th>
                  <th>Finish</th>
                  <th>Break</th>
                  <th>Ordinary</th>
                  <th>Overtime</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.workDate)}</td>
                    <td>{formatDateTime(entry.startedAt)}</td>
                    <td>{formatDateTime(entry.finishedAt)}</td>
                    <td>{entry.unpaidBreakMinutes} min</td>
                    <td>{minutesToHours(entry.ordinaryMinutes)}h</td>
                    <td>{minutesToHours(entry.overtimeMinutes)}h</td>
                    <td className="tiny">{entry.notes || "No notes"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="card card-pad stack" style={{ boxShadow: "none" }}>
            <h3>Signature record</h3>
            {(data.signatures ?? []).length === 0 ? (
              <span className="muted">No signatures recorded.</span>
            ) : (
              (data.signatures ?? []).map((signature) => (
                <div key={signature.id} className="summary-list-item">
                  <b>{titleCase(signature.type)} signature</b>
                  <span>{signature.signedName} · {formatDateTime(signature.signedAt ?? signature.createdAt)}</span>
                </div>
              ))
            )}
          </section>
        </div>
      )}
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
  const [detailFor, setDetailFor] = useState<string | null>(openParam || null);
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
                  <tr
                    key={card.id}
                    className="clickable-row"
                    tabIndex={0}
                    onClick={() => setDetailFor(card.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setDetailFor(card.id);
                      }
                    }}
                    aria-label={`Open timecard for ${timecardLabel(card)}`}
                  >
                    <td>
                      <b>{timecardLabel(card)}</b>
                      <div className="tiny">{card.entries.length} shift{card.entries.length === 1 ? "" : "s"}</div>
                    </td>
                    <td className="tiny">
                      {card.project ? `${card.project.code} · ${card.project.name}` : "Project not loaded"}
                      <br />
                      {card.entries.length} shift{card.entries.length === 1 ? "" : "s"} · payroll week {formatDate(card.weekEnding)}
                    </td>
                    <td>
                      <StatusBadge status={card.status} />
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "nowrap" }}>
                        {card.status === "DRAFT" && (
                          <button className="btn btn-accent btn-sm" onClick={(event) => { event.stopPropagation(); setSubmitFor(card.id); }}>
                            Finish & lodge
                          </button>
                        )}
                        {card.status === "SUBMITTED" && (
                          <button className="btn btn-ghost btn-sm" onClick={(event) => { event.stopPropagation(); setOnsiteFor(card.id); }}>
                            On-site countersign
                          </button>
                        )}
                        {card.status === "REJECTED" && (
                          <button className="btn btn-ghost btn-sm" onClick={(event) => { event.stopPropagation(); correct(card.id); }}>
                            Create correction
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={(event) => { event.stopPropagation(); setDetailFor(card.id); }}>
                          View
                        </button>
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
                      <tr
                        key={card.id}
                        className="clickable-row"
                        tabIndex={0}
                        onClick={() => setDetailFor(card.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setDetailFor(card.id);
                          }
                        }}
                        aria-label={`Open approval timecard for ${workerName(card)}`}
                      >
                        <td>
                          <b>{card.worker ? `${card.worker.firstName} ${card.worker.lastName}` : "Worker"}</b>
                          <div className="tiny">{card.project ? `${card.project.code} · ${card.project.name}` : "Project not loaded"}</div>
                        </td>
                        <td>
                          <b>{timecardLabel(card)}</b>
                          <div className="tiny">Payroll week {formatDate(card.weekEnding)}</div>
                        </td>
                        <td className="tiny">{minutesToHours(totals)}h</td>
                        <td>
                          <div className="row" style={{ justifyContent: "flex-end", gap: 6, flexWrap: "nowrap" }}>
                            <button className="btn btn-ghost btn-sm" onClick={(event) => { event.stopPropagation(); setDetailFor(card.id); }}>View</button>
                            <button className="btn btn-primary btn-sm" onClick={(event) => { event.stopPropagation(); setApproveFor(card.id); }}>Sign</button>
                            <button className="btn btn-danger btn-sm" onClick={(event) => { event.stopPropagation(); setRejectFor(card.id); }}>Reject</button>
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

      {drafting && <DraftTimesheetModal onClose={() => setDrafting(false)} onCreated={() => forceRender((n) => n + 1)} />}
      {submitFor && <SubmitModal timesheetId={submitFor} onClose={() => { setSubmitFor(null); forceRender((n) => n + 1); }} />}
      {detailFor && (
        <TimecardDetailModal
          timesheetId={detailFor}
          canApprove={isApprover}
          onClose={() => setDetailFor(null)}
          onApprove={(id) => {
            setDetailFor(null);
            setApproveFor(id);
          }}
          onReject={(id) => {
            setDetailFor(null);
            setRejectFor(id);
          }}
        />
      )}
      {approveFor && <ApproveModal timesheetId={approveFor} mode="approve" onClose={() => { setApproveFor(null); refreshPending(); forceRender((n) => n + 1); }} />}
      {onsiteFor && <ApproveModal timesheetId={onsiteFor} mode="onsite" onClose={() => { setOnsiteFor(null); forceRender((n) => n + 1); }} />}
      {rejectFor && <RejectModal timesheetId={rejectFor} onClose={() => { setRejectFor(null); refreshPending(); forceRender((n) => n + 1); }} />}
    </Layout>
  );
}
