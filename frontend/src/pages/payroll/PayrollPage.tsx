import { useEffect, useMemo, useState } from "react";
import { Layout } from "../../components/Layout.tsx";
import {
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
import { WorkerSelect } from "../../components/WorkerSelect.tsx";
import { api } from "../../lib/api.ts";
import { formatDate, isoDateOnly, minutesToHours } from "../../lib/format.ts";
import { listRecents, rememberRecent, updateRecent } from "../../lib/recents.ts";
import type { AccountingProvider, PayrollConnection, PayrollExport, Timesheet } from "../../lib/types.ts";
import { useApiQuery, useMutation } from "../../lib/useApi.ts";

const PROVIDERS: AccountingProvider[] = ["XERO", "MYOB"];

function inputDate(value = new Date()): string {
  const offset = value.getTimezoneOffset() * 60000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

function lastMonthDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return inputDate(date);
}

function timecardTotal(timesheet: Timesheet): number {
  return timesheet.entries.reduce((sum, entry) => sum + entry.ordinaryMinutes + entry.overtimeMinutes, 0);
}

function timecardWorker(timesheet: Timesheet): string {
  return timesheet.worker ? `${timesheet.worker.firstName} ${timesheet.worker.lastName}` : "Worker";
}

function ConnectionCard({ provider }: { provider: AccountingProvider }) {
  const toast = useToast();
  const [externalTenantId, setExternalTenantId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [externalEmployeeId, setExternalEmployeeId] = useState("");
  const [localCode, setLocalCode] = useState("");
  const [externalPayItemId, setExternalPayItemId] = useState("");
  const [configured, setConfigured] = useState(false);

  const configure = useMutation(
    () =>
      api<PayrollConnection>(`/api/v1/payroll/connections/${provider}`, {
        method: "PUT",
        body: { externalTenantId: externalTenantId.trim(), displayName: displayName.trim() || undefined },
      }),
    [],
  );
  const mapEmployee = useMutation(
    () =>
      api(`/api/v1/payroll/connections/${provider}/employees/${workerId.trim()}`, {
        method: "PUT",
        body: { externalEmployeeId: externalEmployeeId.trim() },
      }),
    [],
  );
  const mapPayItem = useMutation(
    () =>
      api(`/api/v1/payroll/connections/${provider}/pay-items/${encodeURIComponent(localCode.trim())}`, {
        method: "PUT",
        body: { externalPayItemId: externalPayItemId.trim() },
      }),
    [],
  );

  return (
    <section className="card">
      <div className="card-header">
        <h2>{provider}</h2>
        {configured ? <StatusBadge status="CONFIGURED" /> : <span className="hint">Not configured this session</span>}
      </div>
      <div className="card-pad stack" style={{ gap: 16 }}>
        <ErrorAlert error={configure.error ?? mapEmployee.error ?? mapPayItem.error} />
        <div className="stack">
          <b style={{ fontSize: 13.5 }}>Connection</b>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <Field label={`${provider} tenant / company file ID`} required>
              <TextInput value={externalTenantId} onChange={setExternalTenantId} mono />
            </Field>
            <Field label="Display name">
              <TextInput value={displayName} onChange={setDisplayName} />
            </Field>
            <button
              className="btn btn-primary"
              style={{ marginBottom: 4 }}
              disabled={configure.running || !externalTenantId.trim()}
              onClick={() =>
                configure.run({
                  onSuccess: () => {
                    setConfigured(true);
                    toast.push(`${provider} connection recorded as CONFIGURED`);
                  },
                })
              }
            >
              Save
            </button>
          </div>
          <span className="tiny">
            Recorded as CONFIGURED (not connected) until a live OAuth connector exists. Tokens belong in a secrets
            service, never in these settings.
          </span>
        </div>

        <hr className="divider" />

        <div className="stack">
          <b style={{ fontSize: 13.5 }}>Employee mapping</b>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <Field label="Worker">
              <WorkerSelect value={workerId} onChange={setWorkerId} allowEmpty emptyLabel="Select a worker" />
            </Field>
            <Field label={`${provider} employee ID`}>
              <TextInput value={externalEmployeeId} onChange={setExternalEmployeeId} mono />
            </Field>
            <button
              className="btn btn-ghost"
              style={{ marginBottom: 4 }}
              disabled={mapEmployee.running || !workerId.trim() || !externalEmployeeId.trim()}
              onClick={() =>
                mapEmployee.run({
                  onSuccess: () => {
                    toast.push("Employee mapping saved");
                    setWorkerId("");
                    setExternalEmployeeId("");
                  },
                })
              }
            >
              Map
            </button>
          </div>
        </div>

        <div className="stack">
          <b style={{ fontSize: 13.5 }}>Pay item mapping</b>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <Field label="Local code" hint="e.g. ORDINARY, OT1.5, TRAVEL">
              <TextInput value={localCode} onChange={setLocalCode} mono />
            </Field>
            <Field label={`${provider} pay item ID`}>
              <TextInput value={externalPayItemId} onChange={setExternalPayItemId} mono />
            </Field>
            <button
              className="btn btn-ghost"
              style={{ marginBottom: 4 }}
              disabled={mapPayItem.running || !localCode.trim() || !externalPayItemId.trim()}
              onClick={() =>
                mapPayItem.run({
                  onSuccess: () => {
                    toast.push("Pay item mapping saved");
                    setLocalCode("");
                    setExternalPayItemId("");
                  },
                })
              }
            >
              Map
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function CreateExportModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [provider, setProvider] = useState<string>("XERO");
  const [periodStart, setPeriodStart] = useState(lastMonthDate);
  const [periodEnd, setPeriodEnd] = useState(() => inputDate());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const available = useApiQuery<Timesheet[]>("/api/v1/payroll/approved-timesheets", periodStart && periodEnd ? { periodStart: isoDateOnly(periodStart), periodEnd: isoDateOnly(periodEnd) } : undefined);
  const ids = selectedIds;
  const cards = available.data ?? [];
  const allIds = useMemo(() => cards.map((card) => card.id), [cards]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => allIds.includes(id)));
  }, [allIds]);

  const toggle = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id));

  const mutation = useMutation(
    () =>
      api<PayrollExport>("/api/v1/payroll/exports", {
        method: "POST",
        body: {
          provider,
          periodStart: isoDateOnly(periodStart),
          periodEnd: isoDateOnly(periodEnd),
          timesheetIds: ids,
        },
      }),
    [],
  );

  return (
    <Modal
      title="Build payroll export"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || available.loading || !periodStart || !periodEnd || ids.length === 0}
            onClick={() =>
              mutation.run({
                onSuccess: (payrollExport) => {
                  rememberRecent("payroll-exports", {
                    id: payrollExport.id,
                    label: `${provider} · ${formatDate(payrollExport.periodStart)} → ${formatDate(payrollExport.periodEnd)}`,
                    sublabel: `${payrollExport.items?.length ?? ids.length} timesheet(s)`,
                    status: payrollExport.status,
                  });
                  toast.push("Export built and staged as READY");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Building…" : `Build export (${ids.length})`}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error ?? available.error} onDismiss={mutation.reset} />
      {mutation.error?.status === 422 && (
        <div className="alert alert-warning">One or more workers have no {provider} employee mapping — add mappings first.</div>
      )}
      {mutation.error?.status === 409 && (
        <div className="alert alert-warning">
          Every timesheet must be approved, belong to this organisation, and not already sit in an active export.
        </div>
      )}
      <div className="form-grid">
        <Field label="Provider" required>
          <Select value={provider} onChange={setProvider} options={PROVIDERS.map((p) => ({ value: p, label: p }))} />
        </Field>
        <div />
        <Field label="Period start" required>
          <TextInput value={periodStart} onChange={setPeriodStart} type="date" />
        </Field>
        <Field label="Period end" required>
          <TextInput value={periodEnd} onChange={setPeriodEnd} type="date" />
        </Field>
      </div>
      <div className="stack" style={{ marginTop: 14 }}>
        <div className="row-between">
          <div>
            <h3>Approved timecards</h3>
            <span className="tiny">Showing approved, unexported timecards for the selected payroll period.</span>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            disabled={allIds.length === 0}
            onClick={() => setSelectedIds(allSelected ? [] : allIds)}
          >
            {allSelected ? "Clear all" : "Select all in range"}
          </button>
        </div>
        {available.loading && <div className="spinner" />}
        {!available.loading && cards.length === 0 && (
          <div className="empty">
            <b>No approved timecards in this range</b>
            <span>Change the dates or approve timecards before building the export.</span>
          </div>
        )}
        {cards.length > 0 && (
          <div className="table-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th>Worker</th>
                  <th>Project</th>
                  <th>Payroll week</th>
                  <th>Hours</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((card) => (
                  <tr key={card.id}>
                    <td>
                      <input type="checkbox" checked={selectedIds.includes(card.id)} onChange={() => toggle(card.id)} aria-label={`Select ${timecardWorker(card)} for ${formatDate(card.weekEnding)}`} />
                    </td>
                    <td>
                      <b>{timecardWorker(card)}</b>
                      <div className="tiny">{card.entries.length} shift{card.entries.length === 1 ? "" : "s"}</div>
                    </td>
                    <td className="tiny">{card.project ? `${card.project.code} · ${card.project.name}` : "Project not loaded"}</td>
                    <td>{formatDate(card.weekEnding)}</td>
                    <td>{minutesToHours(timecardTotal(card))}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ExportStatusModal({ exportId, onClose }: { exportId: string; onClose: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState("SENT");
  const [externalReference, setExternalReference] = useState("");
  const [failureReason, setFailureReason] = useState("");
  const mutation = useMutation(
    () =>
      api(`/api/v1/payroll/exports/${exportId}/status`, {
        method: "PATCH",
        body: {
          status,
          externalReference: externalReference.trim() || undefined,
          failureReason: failureReason.trim() || undefined,
        },
      }),
    [],
  );
  const needsRef = status === "SENT" || status === "RECONCILED";
  return (
    <Modal
      title="Update export status"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || (needsRef && !externalReference.trim()) || (status === "FAILED" && !failureReason.trim())}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  updateRecent("payroll-exports", exportId, { status });
                  toast.push(`Export marked ${status}`);
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Updating…" : "Update"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <Field label="New status" required>
        <Select value={status} onChange={setStatus} options={["SENT", "RECONCILED", "FAILED"]} />
      </Field>
      {needsRef && (
        <Field label="External reference" required hint="The provider-side batch / pay run reference.">
          <TextInput value={externalReference} onChange={setExternalReference} mono />
        </Field>
      )}
      {status === "FAILED" && (
        <Field label="Failure reason" required>
          <TextArea value={failureReason} onChange={setFailureReason} rows={2} />
        </Field>
      )}
    </Modal>
  );
}

export function PayrollPage() {
  const [building, setBuilding] = useState(false);
  const [statusFor, setStatusFor] = useState<string | null>(null);
  const [, forceRender] = useState(0);
  const exports = listRecents("payroll-exports");

  return (
    <Layout
      title="Payroll export"
      actions={
        <button className="btn btn-primary" onClick={() => setBuilding(true)}>
          <Icon name="plus" size={15} /> Build export
        </button>
      }
    >
      <div className="alert alert-info">
        TirGeo stages approved, signed timecards in a provider-neutral payload. Award interpretation, tax, super and
        STP lodgement remain the job of your accredited payroll platform.
      </div>

      <div className="grid grid-2">
        {PROVIDERS.map((provider) => (
          <ConnectionCard key={provider} provider={provider} />
        ))}
      </div>

      <section className="card">
        <div className="card-header">
          <h2>Exports (this device)</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setBuilding(true)}>
            <Icon name="plus" size={13} /> Build export
          </button>
        </div>
        {exports.length === 0 ? (
          <div className="empty">
            <b>No exports built from this device</b>
            <span>Exports validate the pay period, mappings and approval state before staging.</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Export</th>
                  <th>Detail</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {exports.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <b>{entry.label}</b>
                    </td>
                    <td className="tiny">{entry.sublabel}</td>
                    <td>
                      <StatusBadge status={entry.status} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setStatusFor(entry.id);
                        }}
                      >
                        Update status
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {building && <CreateExportModal onClose={() => { setBuilding(false); forceRender((n) => n + 1); }} />}
      {statusFor && <ExportStatusModal exportId={statusFor} onClose={() => { setStatusFor(null); forceRender((n) => n + 1); }} />}
    </Layout>
  );
}
