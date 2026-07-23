import { useEffect, useMemo, useState } from "react";
import { Layout } from "../../components/Layout.tsx";
import { ProjectSelect } from "../../components/ProjectSelect.tsx";
import { EmptyState, ErrorAlert, Field, Icon, Loading, Modal, Select, StatTile, StatusBadge, TextArea, TextInput, useToast } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { PROJECT_LEADERS, useAuth } from "../../lib/auth.tsx";
import { formatCurrency, formatDate, isoDateOnly, titleCase, todayInput } from "../../lib/format.ts";
import type { Docket, DocketInvoice, DocketInvoiceSummary, DocketRate, DocketRateBasis, DocketType } from "../../lib/types.ts";
import { useApiQuery, useMutation } from "../../lib/useApi.ts";

const DOCKET_TYPES: DocketType[] = ["SCHEDULE_OF_RATES", "DAYWORKS"];
const RATE_BASIS: DocketRateBasis[] = ["MEASURED_WORK", "LABOUR", "PLANT", "MATERIAL", "SUBCONTRACTOR", "OTHER"];

function docketTypeLabel(type: DocketType) {
  return type === "SCHEDULE_OF_RATES" ? "Schedule of rates" : "Dayworks";
}

function numberValue(value?: string | number | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function RateModal({ onClose, projectId }: { onClose: () => void; projectId: string }) {
  const toast = useToast();
  const [form, setForm] = useState({
    projectScope: projectId ? "PROJECT" : "GLOBAL",
    projectId,
    code: "",
    description: "",
    docketType: "SCHEDULE_OF_RATES" as DocketType,
    basis: "MEASURED_WORK" as DocketRateBasis,
    unit: "m",
    unitRate: "",
    currency: "AUD",
    notes: "",
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const mutation = useMutation(
    () =>
      api<DocketRate>("/api/v1/dockets/rates/admin", {
        method: "POST",
        body: {
          projectId: form.projectScope === "PROJECT" ? form.projectId : null,
          code: form.code.trim(),
          description: form.description.trim(),
          docketType: form.docketType,
          basis: form.basis,
          unit: form.unit.trim(),
          unitRate: Number(form.unitRate),
          currency: form.currency.trim() || "AUD",
          notes: form.notes.trim() || null,
        },
      }),
    ["/api/v1/dockets/rates/admin", "/api/v1/dockets/rates"],
  );
  return (
    <Modal
      title="New docket rate"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || !form.code.trim() || !form.description.trim() || !form.unit.trim() || !form.unitRate || (form.projectScope === "PROJECT" && !form.projectId)}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push("Docket rate created");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Saving..." : "Create rate"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <div className="form-grid">
        <Field label="Scope">
          <Select value={form.projectScope} onChange={set("projectScope")} options={[{ value: "GLOBAL", label: "All projects" }, { value: "PROJECT", label: "Project-specific" }]} />
        </Field>
        {form.projectScope === "PROJECT" && (
          <Field label="Project" required>
            <ProjectSelect value={form.projectId} onChange={set("projectId")} allowEmpty emptyLabel="Select project" />
          </Field>
        )}
        <Field label="Docket type" required>
          <Select value={form.docketType} onChange={(value) => set("docketType")(value as DocketType)} options={DOCKET_TYPES.map((type) => ({ value: type, label: docketTypeLabel(type) }))} />
        </Field>
        <Field label="Basis">
          <Select value={form.basis} onChange={(value) => set("basis")(value as DocketRateBasis)} options={RATE_BASIS.map((basis) => ({ value: basis, label: titleCase(basis) }))} />
        </Field>
        <Field label="Code" required>
          <TextInput value={form.code} onChange={set("code")} placeholder="PIPE-375" mono />
        </Field>
        <Field label="Unit" required>
          <TextInput value={form.unit} onChange={set("unit")} placeholder="m, each, hr" />
        </Field>
        <Field label="Description" required span2>
          <TextInput value={form.description} onChange={set("description")} placeholder="375mm pipe laid" />
        </Field>
        <Field label="Rate" required>
          <TextInput value={form.unitRate} onChange={set("unitRate")} type="number" min={0} inputMode="decimal" />
        </Field>
        <Field label="Currency">
          <TextInput value={form.currency} onChange={set("currency")} maxLength={3} />
        </Field>
        <Field label="Notes" span2>
          <TextArea value={form.notes} onChange={set("notes")} rows={3} />
        </Field>
      </div>
    </Modal>
  );
}

export function DocketsPage() {
  const { hasRole } = useAuth();
  const canManage = hasRole(...PROJECT_LEADERS);
  const toast = useToast();
  const [projectId, setProjectId] = useState("");
  const [docketType, setDocketType] = useState<DocketType>("SCHEDULE_OF_RATES");
  const [docketDate, setDocketDate] = useState(todayInput());
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [lineDraft, setLineDraft] = useState({ rateId: "", quantity: "", notes: "" });
  const [lines, setLines] = useState<Array<{ rateId: string; quantity: string; notes: string }>>([]);
  const [addingRate, setAddingRate] = useState(false);

  const rates = useApiQuery<DocketRate[]>("/api/v1/dockets/rates", { projectId, docketType });
  const myDockets = useApiQuery<Docket[]>("/api/v1/dockets/my");
  const adminRates = useApiQuery<DocketRate[]>(canManage ? "/api/v1/dockets/rates/admin" : null);
  const adminDockets = useApiQuery<Docket[]>(canManage ? "/api/v1/dockets" : null, projectId ? { projectId } : undefined);
  const invoiceSummary = useApiQuery<DocketInvoiceSummary>(canManage && projectId ? `/api/v1/dockets/projects/${projectId}/invoice-summary` : null);

  const ratesById = useMemo(() => new Map((rates.data ?? []).map((rate) => [rate.id, rate])), [rates.data]);
  const selectedRate = ratesById.get(lineDraft.rateId);

  useEffect(() => {
    setLines([]);
    setLineDraft({ rateId: "", quantity: "", notes: "" });
  }, [projectId, docketType]);

  const addLine = () => {
    if (!lineDraft.rateId || !lineDraft.quantity) return;
    setLines((current) => [...current, lineDraft]);
    setLineDraft({ rateId: "", quantity: "", notes: "" });
  };

  const mutation = useMutation(
    () =>
      api<Docket>("/api/v1/dockets", {
        method: "POST",
        body: {
          projectId,
          docketType,
          docketDate: isoDateOnly(docketDate),
          location: location.trim() || undefined,
          description: description.trim() || undefined,
          lines: lines.map((line) => ({ rateId: line.rateId, quantity: Number(line.quantity), notes: line.notes.trim() || undefined })),
        },
      }),
    ["/api/v1/dockets/my", "/api/v1/dockets"],
  );
  const invoiceMutation = useMutation(
    () =>
      api<DocketInvoice>(`/api/v1/dockets/projects/${projectId}/invoices`, {
        method: "POST",
        body: { issueNow: false },
      }),
    ["/api/v1/dockets", "/api/v1/dockets/projects"],
  );

  const submit = () =>
    mutation.run({
      onSuccess: () => {
        toast.push("Docket submitted");
        setLocation("");
        setDescription("");
        setLines([]);
      },
    });

  const generateInvoice = () =>
    invoiceMutation.run({
      onSuccess: (invoice) => {
        toast.push(`Invoice ${invoice.invoiceNumber} created`);
      },
    });

  const uninvoicedDockets = (adminDockets.data ?? []).filter((docket) => !docket.invoiceId);
  const invoicedDockets = (adminDockets.data ?? []).filter((docket) => docket.invoiceId);
  const submittedToday = (myDockets.data ?? []).filter((docket) => docket.docketDate.slice(0, 10) === todayInput()).length;
  const quantityToday = (myDockets.data ?? [])
    .filter((docket) => docket.docketDate.slice(0, 10) === todayInput())
    .flatMap((docket) => docket.lines)
    .reduce((total, line) => total + numberValue(line.quantity), 0);

  return (
    <Layout
      title="Dockets"
      actions={
        canManage ? (
          <button className="btn btn-primary" onClick={() => setAddingRate(true)}>
            <Icon name="plus" size={15} /> New rate
          </button>
        ) : undefined
      }
    >
      <div className="stat-grid">
        <StatTile label="Submitted today" value={submittedToday} foot="Across your site dockets" tone="primary" />
        <StatTile label="Quantity today" value={quantityToday.toLocaleString()} foot="Measured units across submitted dockets" tone="neutral" />
        {canManage && (
          <>
            <StatTile label="Value of uninvoiced dockets" value={formatCurrency(invoiceSummary.data?.uninvoicedTotal ?? uninvoicedDockets.reduce((total, docket) => total + numberValue(docket.totalAmount), 0))} foot={`${invoiceSummary.data?.uninvoicedCount ?? uninvoicedDockets.length} docket(s) waiting`} tone="warning" />
            <StatTile label="Invoiced docket revenue" value={formatCurrency(invoiceSummary.data?.invoicedTotal ?? invoicedDockets.reduce((total, docket) => total + numberValue(docket.totalAmount), 0))} foot={`${invoiceSummary.data?.invoicedCount ?? invoicedDockets.length} docket(s) invoiced`} tone="good" />
          </>
        )}
      </div>

      <section className="card card-pad stack">
        <div className="form-grid">
          <Field label="Project" required>
            <ProjectSelect value={projectId} onChange={setProjectId} allowEmpty emptyLabel="Select project" activeOnly />
          </Field>
          <Field label="Docket type">
            <Select value={docketType} onChange={(value) => setDocketType(value as DocketType)} options={DOCKET_TYPES.map((type) => ({ value: type, label: docketTypeLabel(type) }))} />
          </Field>
          <Field label="Date" required>
            <TextInput value={docketDate} onChange={setDocketDate} type="date" />
          </Field>
          <Field label="Location">
            <TextInput value={location} onChange={setLocation} placeholder="Street, area or chainage" />
          </Field>
          <Field label="Work summary" span2>
            <TextArea value={description} onChange={setDescription} rows={3} placeholder="What was completed today?" />
          </Field>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h2>Measured work</h2>
            <span className="hint">Workers record quantities only. Rates stay hidden here.</span>
          </div>
        </div>
        <div className="card-pad stack">
          <ErrorAlert error={rates.error ?? mutation.error} onDismiss={mutation.reset} />
          {rates.loading && <Loading />}
          <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 2, minWidth: 240 }}>
              <Field label="Item">
                <Select
                  value={lineDraft.rateId}
                  onChange={(rateId) => setLineDraft((current) => ({ ...current, rateId }))}
                  allowEmpty
                  emptyLabel={projectId ? "Select work item" : "Select a project first"}
                  options={(rates.data ?? []).map((rate) => ({ value: rate.id, label: `${rate.code} - ${rate.description} (${rate.unit})` }))}
                />
              </Field>
            </div>
            <div style={{ width: 150 }}>
              <Field label={`Quantity${selectedRate ? ` (${selectedRate.unit})` : ""}`}>
                <TextInput value={lineDraft.quantity} onChange={(quantity) => setLineDraft((current) => ({ ...current, quantity }))} type="number" min={0} inputMode="decimal" />
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <Field label="Notes">
                <TextInput value={lineDraft.notes} onChange={(notes) => setLineDraft((current) => ({ ...current, notes }))} />
              </Field>
            </div>
            <button className="btn btn-ghost" onClick={addLine} disabled={!lineDraft.rateId || !lineDraft.quantity}>
              <Icon name="plus" size={14} /> Add
            </button>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const rate = ratesById.get(line.rateId);
                  return (
                    <tr key={`${line.rateId}-${index}`}>
                      <td><b>{rate?.code}</b><div className="tiny muted">{rate?.description}</div></td>
                      <td>{line.quantity} {rate?.unit}</td>
                      <td>{line.notes || "-"}</td>
                      <td>
                        <button className="btn-icon" aria-label="Remove line" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>
                          <Icon name="x" size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {lines.length === 0 && (
                  <tr><td colSpan={4}><EmptyState title="No measured work added" hint="Add the items completed today, such as pipe laid in metres or headwalls installed." /></td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="row-between">
            <span className="tiny">{lines.length} line item(s)</span>
            <button className="btn btn-accent" onClick={submit} disabled={mutation.running || !projectId || !docketDate || lines.length === 0}>
              {mutation.running ? "Submitting..." : "Submit docket"}
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>My recent dockets</h2>
          <span className="hint">Submitted quantities, no prices shown.</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Project</th><th>Type</th><th>Items</th><th>Status</th></tr></thead>
            <tbody>
              {(myDockets.data ?? []).slice(0, 8).map((docket) => (
                <tr key={docket.id}>
                  <td>{formatDate(docket.docketDate)}</td>
                  <td>{docket.project?.code ?? "-"}</td>
                  <td>{docketTypeLabel(docket.docketType)}</td>
                  <td>{docket.lines.map((line) => `${line.code}: ${line.quantity} ${line.unit}`).join(", ")}</td>
                  <td><StatusBadge status={docket.status} /></td>
                </tr>
              ))}
              {!myDockets.loading && (myDockets.data ?? []).length === 0 && <tr><td colSpan={5}><EmptyState title="No dockets submitted yet" /></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {canManage && (
        <div className="stack">
          <section className="card">
            <div className="card-header">
              <div>
                <h2>Project invoicing</h2>
                <span className="hint">Creates one draft invoice from all uninvoiced dockets linked to the selected project.</span>
              </div>
              <button className="btn btn-primary" disabled={!projectId || invoiceMutation.running || (invoiceSummary.data?.uninvoicedCount ?? uninvoicedDockets.length) === 0} onClick={generateInvoice}>
                {invoiceMutation.running ? "Building invoice..." : "Generate invoice"}
              </button>
            </div>
            <div className="card-pad">
              <ErrorAlert error={invoiceMutation.error ?? invoiceSummary.error} onDismiss={invoiceMutation.reset} />
              <div className="summary-grid">
                <div className="summary-item">
                  <span>Uninvoiced</span>
                  <b>{formatCurrency(invoiceSummary.data?.uninvoicedTotal ?? 0)}</b>
                </div>
                <div className="summary-item">
                  <span>Already invoiced</span>
                  <b>{formatCurrency(invoiceSummary.data?.invoicedTotal ?? 0)}</b>
                </div>
                <div className="summary-item">
                  <span>Invoices</span>
                  <b>{invoiceSummary.data?.invoices.length ?? 0}</b>
                </div>
              </div>
            </div>
          </section>

          <div className="grid grid-2">
          <section className="card">
            <div className="card-header">
              <h2>Rate book</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setAddingRate(true)}><Icon name="plus" size={13} /> Rate</button>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Code</th><th>Description</th><th>Type</th><th>Rate</th><th>Status</th></tr></thead>
                <tbody>
                  {(adminRates.data ?? []).slice(0, 12).map((rate) => (
                    <tr key={rate.id}>
                      <td className="mono">{rate.code}</td>
                      <td><b>{rate.description}</b><div className="tiny muted">{rate.project ? rate.project.code : "All projects"} · {titleCase(rate.basis)}</div></td>
                      <td>{docketTypeLabel(rate.docketType)}</td>
                      <td>{formatCurrency(rate.unitRate)} / {rate.unit}</td>
                      <td><StatusBadge status={rate.active ? "ACTIVE" : "INACTIVE"} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2>Commercial docket register</h2>
              <span className="hint">Calculated from submitted quantities.</span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Date</th><th>Worker</th><th>Type</th><th>Status</th><th className="num">Value</th></tr></thead>
                <tbody>
                  {(adminDockets.data ?? []).slice(0, 12).map((docket) => (
                    <tr key={docket.id}>
                      <td>{formatDate(docket.docketDate)}</td>
                      <td>{docket.worker ? `${docket.worker.firstName} ${docket.worker.lastName}` : "-"}</td>
                      <td>{docketTypeLabel(docket.docketType)}</td>
                      <td><StatusBadge status={docket.invoiceId ? "APPROVED" : docket.status} /></td>
                      <td className="num">{formatCurrency(docket.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          </div>
        </div>
      )}

      {addingRate && <RateModal projectId={projectId} onClose={() => setAddingRate(false)} />}
    </Layout>
  );
}
