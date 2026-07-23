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
  StatTile,
  StatusBadge,
  TextArea,
  TextInput,
  useToast,
} from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { formatCurrency, formatDate, isoDateOnly, titleCase, todayInput } from "../../lib/format.ts";
import type {
  CostEntryStatus,
  CostEntryType,
  CostTrackingProjectDetail,
  CostTrackingProjectSummary,
  DailyProjectCostDraft,
  DailyProjectCostLine,
  ForecastConfidence,
} from "../../lib/types.ts";
import { invalidate, useApiQuery, useMutation } from "../../lib/useApi.ts";

const COST_TYPES: CostEntryType[] = [
  "LABOUR",
  "PLANT",
  "MATERIALS",
  "SUBCONTRACTOR",
  "HIRE",
  "DISPOSAL",
  "TRAFFIC_MANAGEMENT",
  "SURVEYING",
  "OVERHEAD",
  "OTHER",
];
const COST_STATUSES: CostEntryStatus[] = ["COMMITTED", "ACCRUED", "INVOICED", "APPROVED", "PAID", "DISPUTED"];
const CONFIDENCE: ForecastConfidence[] = ["LOW", "MEDIUM", "HIGH"];

function percent(value?: number | null): string {
  return value === null || value === undefined ? "-" : `${value.toFixed(1)}%`;
}

function moneyNumber(value?: string | number | null): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function marginTone(status: string): "critical" | "serious" | "warning" | "good" {
  if (status === "LOSS") return "critical";
  if (status === "AT_RISK") return "serious";
  if (status === "WATCH") return "warning";
  return "good";
}

function typeOptions() {
  return COST_TYPES.map((type) => ({ value: type, label: titleCase(type) }));
}

function CostPlanModal({ detail, onClose }: { detail: CostTrackingProjectDetail; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    contractBudget: detail.costPlan?.contractBudget ? String(detail.costPlan.contractBudget) : "",
    contingencyAmount: detail.costPlan?.contingencyAmount ? String(detail.costPlan.contingencyAmount) : "0",
    targetMarginPercent: detail.costPlan?.targetMarginPercent ? String(detail.costPlan.targetMarginPercent) : "",
    notes: detail.costPlan?.notes ?? "",
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const mutation = useMutation(
    () =>
      api(`/api/v1/commercial/cost-tracking/projects/${detail.project.id}/plan`, {
        method: "PUT",
        body: {
          contractBudget: form.contractBudget ? Number(form.contractBudget) : null,
          contingencyAmount: form.contingencyAmount ? Number(form.contingencyAmount) : 0,
          targetMarginPercent: form.targetMarginPercent ? Number(form.targetMarginPercent) : null,
          notes: form.notes.trim() || null,
        },
      }),
    ["/api/v1/commercial/cost-tracking"],
  );
  return (
    <Modal
      title="Cost plan"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push("Cost plan updated");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Saving..." : "Save plan"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <div className="form-grid">
        <Field label="Cost budget override (AUD)" hint="Leave blank to use cost code budgets.">
          <TextInput value={form.contractBudget} onChange={set("contractBudget")} type="number" min={0} inputMode="decimal" />
        </Field>
        <Field label="Contingency (AUD)">
          <TextInput value={form.contingencyAmount} onChange={set("contingencyAmount")} type="number" min={0} inputMode="decimal" />
        </Field>
        <Field label="Target margin (%)">
          <TextInput value={form.targetMarginPercent} onChange={set("targetMarginPercent")} type="number" inputMode="decimal" />
        </Field>
        <Field label="Notes" span2>
          <TextArea value={form.notes} onChange={set("notes")} rows={4} />
        </Field>
      </div>
    </Modal>
  );
}

function CostEntryModal({ detail, onClose }: { detail: CostTrackingProjectDetail; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    costCodeId: "",
    type: "MATERIALS" as CostEntryType,
    status: "ACCRUED" as CostEntryStatus,
    supplier: "",
    description: "",
    incurredAt: todayInput(),
    invoiceNumber: "",
    quantity: "",
    unit: "",
    unitRate: "",
    amount: "",
    gstAmount: "",
    committed: false,
  });
  const set = (key: keyof typeof form) => (value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const mutation = useMutation(
    () =>
      api("/api/v1/commercial/cost-tracking/cost-entries", {
        method: "POST",
        body: {
          projectId: detail.project.id,
          costCodeId: form.costCodeId || null,
          type: form.type,
          status: form.status,
          supplier: form.supplier.trim() || undefined,
          description: form.description.trim(),
          incurredAt: isoDateOnly(form.incurredAt),
          invoiceNumber: form.invoiceNumber.trim() || undefined,
          quantity: form.quantity ? Number(form.quantity) : null,
          unit: form.unit.trim() || undefined,
          unitRate: form.unitRate ? Number(form.unitRate) : null,
          amount: Number(form.amount),
          gstAmount: form.gstAmount ? Number(form.gstAmount) : 0,
          committed: form.committed,
        },
      }),
    ["/api/v1/commercial/cost-tracking"],
  );
  const costCodeOptions = detail.costCodes.map((code) => ({ value: code.id, label: `${code.code} - ${code.description}` }));
  return (
    <Modal
      title="Add project cost"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || !form.description.trim() || !form.amount || !form.incurredAt}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push("Cost captured");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Saving..." : "Add cost"}
          </button>
        </>
      }
      large
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <div className="form-grid">
        <Field label="Cost code">
          <Select value={form.costCodeId} onChange={set("costCodeId")} allowEmpty emptyLabel="Unallocated" options={costCodeOptions} />
        </Field>
        <Field label="Type" required>
          <Select value={form.type} onChange={(value) => set("type")(value as CostEntryType)} options={typeOptions()} />
        </Field>
        <Field label="Status" required>
          <Select value={form.status} onChange={(value) => set("status")(value as CostEntryStatus)} options={COST_STATUSES} />
        </Field>
        <Field label="Date" required>
          <TextInput value={form.incurredAt} onChange={set("incurredAt")} type="date" />
        </Field>
        <Field label="Supplier">
          <TextInput value={form.supplier} onChange={set("supplier")} />
        </Field>
        <Field label="Invoice / docket">
          <TextInput value={form.invoiceNumber} onChange={set("invoiceNumber")} />
        </Field>
        <Field label="Description" required span2>
          <TextInput value={form.description} onChange={set("description")} />
        </Field>
        <Field label="Quantity">
          <TextInput value={form.quantity} onChange={set("quantity")} type="number" min={0} inputMode="decimal" />
        </Field>
        <Field label="Unit">
          <TextInput value={form.unit} onChange={set("unit")} placeholder="m3, t, hr" />
        </Field>
        <Field label="Unit rate">
          <TextInput value={form.unitRate} onChange={set("unitRate")} type="number" min={0} inputMode="decimal" />
        </Field>
        <Field label="Amount (AUD)" required>
          <TextInput value={form.amount} onChange={set("amount")} type="number" min={0} inputMode="decimal" />
        </Field>
        <Field label="GST (AUD)">
          <TextInput value={form.gstAmount} onChange={set("gstAmount")} type="number" min={0} inputMode="decimal" />
        </Field>
        <label className="check-row">
          <input type="checkbox" checked={form.committed} onChange={(event) => set("committed")(event.target.checked)} />
          Committed but not final cost
        </label>
      </div>
    </Modal>
  );
}

type DraftLineForm = {
  id?: string;
  costCodeId: string;
  type: CostEntryType;
  description: string;
  quantity: string;
  unit: string;
  unitRate: string;
  amount: string;
  source: string;
  workerId?: string | null;
  plantId?: string | null;
};

function draftLineForm(line: DailyProjectCostLine): DraftLineForm {
  return {
    id: line.id,
    costCodeId: line.costCodeId ?? "",
    type: line.type,
    description: line.description,
    quantity: String(line.quantity ?? ""),
    unit: line.unit || "hr",
    unitRate: line.unitRate === null || line.unitRate === undefined ? "" : String(line.unitRate),
    amount: String(line.amount ?? ""),
    source: line.source,
    workerId: line.workerId,
    plantId: line.plantId,
  };
}

function DailyCostDraftEditor({ detail, draft }: { detail: CostTrackingProjectDetail; draft: DailyProjectCostDraft }) {
  const toast = useToast();
  const [rows, setRows] = useState<DraftLineForm[]>(() => draft.lines.map(draftLineForm));
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const costCodeOptions = detail.costCodes.map((code) => ({ value: code.id, label: `${code.code} - ${code.description}` }));
  useEffect(() => {
    setRows(draft.lines.map(draftLineForm));
    setRemovedIds([]);
  }, [draft]);
  const updateRow = (index: number, patch: Partial<DraftLineForm>) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  const removeRow = (index: number) => {
    const row = rows[index];
    if (row?.id) setRemovedIds((current) => [...current, row.id!]);
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  };
  const addRow = (type: CostEntryType) => setRows((current) => [
    ...current,
    {
      costCodeId: "",
      type,
      description: type === "PLANT" ? "Manual plant" : "Manual labour",
      quantity: "",
      unit: "hr",
      unitRate: "",
      amount: "",
      source: "MANUAL",
    },
  ]);
  const total = rows.reduce((sum, row) => sum + (Number(row.amount) || ((Number(row.quantity) || 0) * (Number(row.unitRate) || 0))), 0);
  const mutation = useMutation(
    () =>
      api(`/api/v1/commercial/cost-tracking/daily-cost-drafts/${draft.id}`, {
        method: "PATCH",
        body: {
          lines: [
            ...rows.map((row) => ({
              id: row.id,
              costCodeId: row.costCodeId || null,
              type: row.type,
              workerId: row.workerId ?? null,
              plantId: row.plantId ?? null,
              description: row.description.trim(),
              quantity: Number(row.quantity) || 0,
              unit: row.unit.trim() || "hr",
              unitRate: row.unitRate ? Number(row.unitRate) : null,
              amount: row.amount ? Number(row.amount) : undefined,
            })),
            ...removedIds.map((id) => ({ id, remove: true, type: "OTHER", description: "Removed", quantity: 0, unit: "hr" })),
          ],
        },
      }),
    ["/api/v1/commercial/cost-tracking"],
  );
  return (
    <div className="stack" style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
        <div>
          <b>{formatDate(draft.costDate)}</b>
          <div className="tiny muted">{rows.length} cost lines · {formatCurrency(total)}</div>
        </div>
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => addRow("LABOUR")}>
            <Icon name="plus" size={14} /> Labour
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => addRow("PLANT")}>
            <Icon name="plus" size={14} /> Plant
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={mutation.running || rows.some((row) => !row.description.trim())}
            onClick={() => mutation.run({ onSuccess: () => toast.push("Daily cost draft saved") })}
          >
            {mutation.running ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ minWidth: 170 }}>Person / plant</th>
              <th>Type</th>
              <th>Code</th>
              <th style={{ width: 96 }}>Hours</th>
              <th style={{ width: 110 }}>Rate</th>
              <th style={{ width: 120 }}>Amount</th>
              <th style={{ width: 44 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id ?? `new-${index}`}>
                <td>
                  <TextInput value={row.description} onChange={(value) => updateRow(index, { description: value })} />
                  {row.source !== "MANUAL" && <div className="tiny muted">{titleCase(row.source)}</div>}
                </td>
                <td>
                  <Select value={row.type} onChange={(value) => updateRow(index, { type: value as CostEntryType })} options={[{ value: "LABOUR", label: "Labour" }, { value: "PLANT", label: "Plant" }, { value: "OTHER", label: "Other" }]} />
                </td>
                <td>
                  <Select value={row.costCodeId} onChange={(value) => updateRow(index, { costCodeId: value })} allowEmpty emptyLabel="Unallocated" options={costCodeOptions} />
                </td>
                <td>
                  <TextInput value={row.quantity} onChange={(value) => updateRow(index, { quantity: value })} type="number" min={0} inputMode="decimal" />
                </td>
                <td>
                  <TextInput value={row.unitRate} onChange={(value) => updateRow(index, { unitRate: value, amount: "" })} type="number" min={0} inputMode="decimal" />
                </td>
                <td>
                  <TextInput value={row.amount || String(((Number(row.quantity) || 0) * (Number(row.unitRate) || 0)).toFixed(2))} onChange={(value) => updateRow(index, { amount: value })} type="number" min={0} inputMode="decimal" />
                </td>
                <td>
                  <button className="icon-btn" aria-label="Remove line" onClick={() => removeRow(index)}>
                    <Icon name="x" size={15} />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState title="No draft lines for this day" hint="Add labour or plant manually, or submit a timecard or pre-start linked to this project." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ForecastModal({ detail, onClose }: { detail: CostTrackingProjectDetail; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    costCodeId: "",
    type: "SUBCONTRACTOR" as CostEntryType,
    description: "",
    amount: "",
    confidence: "MEDIUM" as ForecastConfidence,
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const mutation = useMutation(
    () =>
      api("/api/v1/commercial/cost-tracking/forecasts", {
        method: "POST",
        body: {
          projectId: detail.project.id,
          costCodeId: form.costCodeId || null,
          type: form.type,
          description: form.description.trim(),
          amount: Number(form.amount),
          confidence: form.confidence,
        },
      }),
    ["/api/v1/commercial/cost-tracking"],
  );
  const costCodeOptions = detail.costCodes.map((code) => ({ value: code.id, label: `${code.code} - ${code.description}` }));
  return (
    <Modal
      title="Forecast allowance"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || !form.description.trim() || !form.amount}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push("Forecast added");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Saving..." : "Add forecast"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <div className="form-grid">
        <Field label="Cost code">
          <Select value={form.costCodeId} onChange={set("costCodeId")} allowEmpty emptyLabel="Unallocated" options={costCodeOptions} />
        </Field>
        <Field label="Type" required>
          <Select value={form.type} onChange={(value) => set("type")(value as CostEntryType)} options={typeOptions()} />
        </Field>
        <Field label="Amount (AUD)" required>
          <TextInput value={form.amount} onChange={set("amount")} type="number" min={0} inputMode="decimal" />
        </Field>
        <Field label="Confidence">
          <Select value={form.confidence} onChange={(value) => set("confidence")(value as ForecastConfidence)} options={CONFIDENCE} />
        </Field>
        <Field label="Description" required span2>
          <TextArea value={form.description} onChange={set("description")} rows={3} />
        </Field>
      </div>
    </Modal>
  );
}

export function CostTrackingPage() {
  const [projectId, setProjectId] = useState("");
  const [editingPlan, setEditingPlan] = useState(false);
  const [addingCost, setAddingCost] = useState(false);
  const [addingForecast, setAddingForecast] = useState(false);
  const summaries = useApiQuery<CostTrackingProjectSummary[]>("/api/v1/commercial/cost-tracking/summary");
  const detail = useApiQuery<CostTrackingProjectDetail>(projectId ? `/api/v1/commercial/cost-tracking/projects/${projectId}` : null);

  useEffect(() => {
    if (!projectId && summaries.data?.[0]) setProjectId(summaries.data[0].project.id);
  }, [projectId, summaries.data]);

  const selectedSummary = summaries.data?.find((item) => item.project.id === projectId);
  const selected = detail.data ?? selectedSummary;
  const costByType = useMemo(() => {
    const rows = new Map<string, number>();
    for (const entry of detail.data?.costEntries ?? []) {
      if (entry.status === "DISPUTED") continue;
      rows.set(entry.type, (rows.get(entry.type) ?? 0) + moneyNumber(entry.amount));
    }
    return [...rows.entries()].sort((a, b) => b[1] - a[1]);
  }, [detail.data]);

  const refreshAll = () => invalidate("/api/v1/commercial/cost-tracking");

  return (
    <Layout
      title="Cost tracking"
      actions={
        <div className="row">
          <button className="btn btn-ghost" disabled={!detail.data} onClick={() => setEditingPlan(true)}>
            Cost plan
          </button>
          <button className="btn btn-ghost" disabled={!detail.data} onClick={() => setAddingForecast(true)}>
            Forecast
          </button>
          <button className="btn btn-primary" disabled={!detail.data} onClick={() => setAddingCost(true)}>
            <Icon name="plus" size={15} /> Add cost
          </button>
        </div>
      }
    >
      <section className="card card-pad stack">
        <div className="grid grid-2">
          <Field label="Project">
            <ProjectSelect value={projectId} onChange={setProjectId} allowEmpty emptyLabel="Select a project" />
          </Field>
          <div className="row" style={{ justifyContent: "flex-end", alignItems: "end" }}>
            <button className="btn btn-ghost" onClick={refreshAll}>
              Refresh
            </button>
          </div>
        </div>
        <ErrorAlert error={summaries.error ?? detail.error} />
      </section>

      {(summaries.loading || detail.loading) && <Loading />}
      {!summaries.loading && summaries.data?.length === 0 && (
        <EmptyState title="No project costs yet" hint="Create a project first, then return here to manage budgets, actuals, forecasts and margins." />
      )}

      {selected && (
        <>
          <section className="card card-pad stack">
            <div className="card-header">
              <div>
                <h2>
                  {selected.project.code} - {selected.project.name}
                </h2>
                <span className="hint">{selected.project.clientName ?? "No client recorded"}</span>
              </div>
              <StatusBadge status={selected.summary.marginStatus} />
            </div>
            <div className="stat-grid">
              <StatTile label="Forecast margin" value={percent(selected.summary.forecastMarginPercent)} tone={marginTone(selected.summary.marginStatus)} foot={formatCurrency(selected.summary.forecastProfit)} />
              <StatTile label="Revised contract" value={formatCurrency(selected.summary.revisedContractValue)} tone="primary" foot={`${formatCurrency(selected.summary.approvedVariations)} approved variations`} />
              <StatTile label="Actual cost" value={formatCurrency(selected.summary.actualCost)} tone="neutral" foot={`${formatCurrency(selected.summary.approvedLabourCost)} approved labour`} />
              <StatTile label="Forecast final cost" value={formatCurrency(selected.summary.forecastFinalCost)} tone="warning" foot={`${formatCurrency(selected.summary.committedCost + selected.summary.forecastToComplete)} exposure ahead`} />
            </div>
          </section>

          <div className="grid grid-2">
            <section className="card">
              <div className="card-header">
                <h2>Cost position</h2>
                <span className="hint">Budget, claims and forecast health.</span>
              </div>
              <div className="card-pad stack">
                <div className="summary-grid">
                  <div className="summary-item">
                    <span>Budgeted cost</span>
                    <b>{formatCurrency(selected.summary.budgetedCost)}</b>
                  </div>
                  <div className="summary-item">
                    <span>Cost to date</span>
                    <b>{percent(selected.summary.costToDatePercent)}</b>
                  </div>
                  <div className="summary-item">
                    <span>Claimed</span>
                    <b>{formatCurrency(selected.summary.claimedAmount)}</b>
                  </div>
                  <div className="summary-item">
                    <span>Certified</span>
                    <b>{formatCurrency(selected.summary.certifiedAmount)}</b>
                  </div>
                </div>
                <p className="muted">Target margin: {selected.costPlan?.targetMarginPercent ? `${selected.costPlan.targetMarginPercent}%` : "not set"}</p>
              </div>
            </section>

            <section className="card">
              <div className="card-header">
                <h2>Actual cost mix</h2>
                <span className="hint">Manual direct costs by category.</span>
              </div>
              <div className="card-pad stack">
                {costByType.length === 0 ? (
                  <EmptyState title="No direct costs captured" hint="Add supplier invoices, dockets or accruals to start seeing cost mix." />
                ) : (
                  costByType.map(([type, amount]) => (
                    <div key={type} className="summary-list-item">
                      <b>{titleCase(type)}</b>
                      <span>{formatCurrency(amount)}</span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          {detail.data && (
            <>
              <section className="card">
                <div className="card-header">
                  <div>
                    <h2>Daily draft costs</h2>
                    <span className="hint">Timecards and pre-starts linked to this project, grouped by work day.</span>
                  </div>
                  <StatusBadge status="DRAFT" />
                </div>
                <div className="card-pad stack">
                  {detail.data.dailyCostDrafts.length === 0 ? (
                    <EmptyState title="No draft daily costs" hint="Submitted timecards and plant pre-starts will appear here for review." />
                  ) : (
                    detail.data.dailyCostDrafts.map((draft) => <DailyCostDraftEditor key={draft.id} detail={detail.data!} draft={draft} />)
                  )}
                </div>
              </section>
              <div className="grid grid-2">
              <section className="card">
                <div className="card-header">
                  <h2>Recent costs</h2>
                  <span className="hint">Invoices, accruals and commitments.</span>
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th style={{ textAlign: "right" }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.costEntries.slice(0, 8).map((entry) => (
                        <tr key={entry.id}>
                          <td>{formatDate(entry.incurredAt)}</td>
                          <td>
                            <b>{entry.description}</b>
                            <div className="tiny muted">{entry.costCode?.code ?? "Unallocated"}{entry.supplier ? ` - ${entry.supplier}` : ""}</div>
                          </td>
                          <td>{titleCase(entry.type)}</td>
                          <td><StatusBadge status={entry.status} /></td>
                          <td style={{ textAlign: "right" }}>{formatCurrency(entry.amount)}</td>
                        </tr>
                      ))}
                      {detail.data.costEntries.length === 0 && (
                        <tr>
                          <td colSpan={5}>
                            <EmptyState title="No costs recorded" />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="card">
                <div className="card-header">
                  <h2>Forecast allowances</h2>
                  <span className="hint">Likely remaining cost exposure.</span>
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th>Type</th>
                        <th>Confidence</th>
                        <th style={{ textAlign: "right" }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.costForecasts.map((forecast) => (
                        <tr key={forecast.id}>
                          <td>
                            <b>{forecast.description}</b>
                            <div className="tiny muted">{forecast.costCode?.code ?? "Unallocated"}</div>
                          </td>
                          <td>{titleCase(forecast.type)}</td>
                          <td><StatusBadge status={forecast.confidence} /></td>
                          <td style={{ textAlign: "right" }}>{formatCurrency(forecast.amount)}</td>
                        </tr>
                      ))}
                      {detail.data.costForecasts.length === 0 && (
                        <tr>
                          <td colSpan={4}>
                            <EmptyState title="No forecast allowances" />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
              </div>
            </>
          )}
        </>
      )}

      {editingPlan && detail.data && <CostPlanModal detail={detail.data} onClose={() => setEditingPlan(false)} />}
      {addingCost && detail.data && <CostEntryModal detail={detail.data} onClose={() => setAddingCost(false)} />}
      {addingForecast && detail.data && <ForecastModal detail={detail.data} onClose={() => setAddingForecast(false)} />}
    </Layout>
  );
}
