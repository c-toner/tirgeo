import { useMemo, useState } from "react";
import { Layout } from "../../components/Layout.tsx";
import { ProjectSelect } from "../../components/ProjectSelect.tsx";
import {
  EmptyState,
  ErrorAlert,
  Field,
  Icon,
  Modal,
  Select,
  StatusBadge,
  TextArea,
  TextInput,
  useToast,
} from "../../components/ui.tsx";
import { SignaturePad } from "../../components/SignaturePad.tsx";
import type { SignatureValue } from "../../components/SignaturePad.tsx";
import { api } from "../../lib/api.ts";
import { TIMESHEET_APPROVERS, useAuth } from "../../lib/auth.tsx";
import { formatDate, minutesToHours, titleCase, uuid } from "../../lib/format.ts";
import { getMyWorkerId, listRecents, rememberRecent, updateRecent } from "../../lib/recents.ts";
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

function newEntry(date?: string): EntryDraft {
  return {
    id: uuid(),
    workDate: date ?? "",
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

/** Sunday on/after today as the default week-ending. */
function defaultWeekEnding(): string {
  const now = new Date();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + ((7 - now.getDay()) % 7));
  const offset = sunday.getTimezoneOffset() * 60000;
  return new Date(sunday.getTime() - offset).toISOString().slice(0, 10);
}

function DraftTimesheetModal({ onClose, onCreated }: { onClose: () => void; onCreated: (timesheet: Timesheet) => void }) {
  const toast = useToast();
  const [projectId, setProjectId] = useState("");
  const [workerId, setWorkerId] = useState(getMyWorkerId());
  const [weekEnding, setWeekEnding] = useState(defaultWeekEnding());
  const [entries, setEntries] = useState<EntryDraft[]>([newEntry()]);

  const patch = (index: number, changes: Partial<EntryDraft>) =>
    setEntries((list) => list.map((entry, i) => (i === index ? { ...entry, ...changes } : entry)));

  const totals = useMemo(() => {
    const sums = entries.map(entryMinutes);
    return {
      ordinary: sums.reduce((sum, e) => sum + e.ordinary, 0),
      overtime: sums.reduce((sum, e) => sum + e.overtime, 0),
    };
  }, [entries]);

  const mutation = useMutation(
    () =>
      api<Timesheet>("/api/v1/timesheets", {
        method: "POST",
        body: {
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
        },
      }),
    [],
  );

  const issues = (mutation.error?.body as { issues?: Array<{ message?: string; entryId?: string }> } | undefined)?.issues;

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
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || !projectId || !workerId.trim() || !weekEnding || entries.every((entry) => !entry.workDate)}
            onClick={() =>
              mutation.run({
                onSuccess: (timesheet) => {
                  rememberRecent("timesheets", {
                    id: timesheet.id,
                    label: `Week ending ${formatDate(timesheet.weekEnding)}`,
                    sublabel: `${timesheet.entries.length} entries`,
                    status: "DRAFT",
                  });
                  toast.push("Draft timecard created — sign and submit it");
                  onCreated(timesheet);
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Creating…" : "Create draft"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
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
      <div className="form-grid">
        <Field label="Project" required>
          <ProjectSelect value={projectId} onChange={setProjectId} allowEmpty emptyLabel="— Select project —" activeOnly />
        </Field>
        <Field label="Week ending" required hint="All entries must fall in this week (organisation timezone).">
          <TextInput value={weekEnding} onChange={setWeekEnding} type="date" />
        </Field>
        <Field label="Worker ID" required span2 hint="Your worker record UUID — save it once in Settings. Workers can only create their own timecards.">
          <TextInput value={workerId} onChange={setWorkerId} mono placeholder="worker UUID" />
        </Field>
      </div>

      <div className="row-between">
        <h3>Shifts</h3>
        <button className="btn btn-ghost btn-sm" onClick={() => setEntries((list) => [...list, newEntry()])}>
          <Icon name="plus" size={13} /> Add shift
        </button>
      </div>

      {entries.map((entry, index) => {
        const minutes = entryMinutes(entry);
        return (
          <div key={entry.id} className="card card-pad stack" style={{ boxShadow: "none", gap: 10 }}>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <Field label="Date" required>
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
    </Modal>
  );
}

function SubmitModal({ timesheetId, onClose }: { timesheetId: string; onClose: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const { data: approvers } = useApiQuery<ApproverSummary[]>("/api/v1/timesheets/approvers");
  const [approverUserId, setApproverUserId] = useState("");
  const [signedName, setSignedName] = useState(user?.name ?? "");
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [consent, setConsent] = useState(false);

  const mutation = useMutation(
    () =>
      api<Timesheet>(`/api/v1/timesheets/${timesheetId}/submit`, {
        method: "POST",
        body: {
          approverUserId,
          signedName: signedName.trim(),
          signature: signature!.signature,
          signatureMethod: signature!.signatureMethod,
          consent: true,
        },
      }),
    [],
  );

  return (
    <Modal
      title="Sign & submit timecard"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-accent"
            disabled={mutation.running || !approverUserId || !signature || signedName.trim().length < 2 || !consent}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  updateRecent("timesheets", timesheetId, { status: "SUBMITTED" });
                  toast.push("Submitted — your approver has been notified");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Submitting…" : "Sign & submit"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <Field label="Approver" required hint="Owner, admin, PM, supervisor or foreman — they countersign on site or from their notifications.">
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
      <SignaturePad signedName={signedName} onNameChange={setSignedName} onChange={setSignature} />
      <label className="row" style={{ gap: 8, alignItems: "flex-start", fontSize: 13 }}>
        <input type="checkbox" checked={consent} onChange={(e: { target: { checked: boolean } }) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
        <span>I confirm this timecard is a complete and accurate record of the hours I worked.</span>
      </label>
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
    ["/api/v1/notifications"],
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
                  updateRecent("timesheets", timesheetId, { status: "APPROVED" });
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
    ["/api/v1/notifications"],
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
                  updateRecent("timesheets", timesheetId, { status: "REJECTED" });
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

  const recents = listRecents("timesheets");

  const correct = async (id: string) => {
    try {
      const corrected = await api<Timesheet>(`/api/v1/timesheets/${id}/correct`, { method: "POST" });
      rememberRecent("timesheets", {
        id: corrected.id,
        label: `Week ending ${formatDate(corrected.weekEnding)} (rev ${corrected.revision})`,
        sublabel: `${corrected.entries.length} entries`,
        status: "DRAFT",
      });
      toast.push("Correction draft created — review, sign and resubmit");
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
          <h2>My timecards (this device)</h2>
          <span className="hint">The API keeps every card; this list tracks the ones handled here.</span>
        </div>
        {recents.length === 0 ? (
          <EmptyState
            title="No timecards yet"
            hint="Create a draft for the week, sign it and pick your approver. Weekly cards are validated shift by shift."
            action={
              <button className="btn btn-primary" onClick={() => setDrafting(true)}>
                <Icon name="plus" size={15} /> New timecard
              </button>
            }
          />
        ) : (
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
                {recents.map((card) => (
                  <tr key={card.id}>
                    <td>
                      <b>{card.label}</b>
                      <div className="mono tiny">{card.id}</div>
                    </td>
                    <td className="tiny">{card.sublabel}</td>
                    <td>
                      <StatusBadge status={card.status} />
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "nowrap" }}>
                        {card.status === "DRAFT" && (
                          <button className="btn btn-accent btn-sm" onClick={() => setSubmitFor(card.id)}>
                            Sign & submit
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
            <h2>Approver actions</h2>
            <span className="hint">Approval requests arrive as notifications with the timecard ID.</span>
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
      {approveFor && <ApproveModal timesheetId={approveFor} mode="approve" onClose={() => { setApproveFor(null); forceRender((n) => n + 1); }} />}
      {onsiteFor && <ApproveModal timesheetId={onsiteFor} mode="onsite" onClose={() => { setOnsiteFor(null); forceRender((n) => n + 1); }} />}
      {rejectFor && <RejectModal timesheetId={rejectFor} onClose={() => { setRejectFor(null); forceRender((n) => n + 1); }} />}
    </Layout>
  );
}
