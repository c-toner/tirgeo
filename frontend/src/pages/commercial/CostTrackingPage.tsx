import { useEffect, useRef, useState } from "react";
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
import { api, getApiBase, getToken } from "../../lib/api.ts";
import { formatCurrency, formatDate, isoDateOnly, titleCase, todayInput } from "../../lib/format.ts";
import type {
  CostEntryStatus,
  CostEntryType,
  CostTrackingProjectDetail,
  DailyProjectCostDraft,
  DailyProjectCostLine,
  FileAsset,
  ForecastConfidence,
  ProjectOption,
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

type InvoiceExtractResult = {
  fileAsset: FileAsset;
  suggestion: {
    amount: number | null;
    supplier: string | null;
    invoiceNumber: string | null;
    description: string;
    incurredAt: string;
    type: CostEntryType;
    costCodeId: string | null;
    costCodeLabel: string | null;
    possibleDuplicate: {
      id: string;
      projectId: string;
      invoiceNumber?: string | null;
      supplier?: string | null;
      amount: string | number;
      incurredAt: string;
      description: string;
    } | null;
    confidence: string;
    message: string;
  };
};

function percent(value?: number | null): string {
  return value === null || value === undefined ? "-" : `${value.toFixed(1)}%`;
}

function dateInputDaysAgo(days: number): string {
  const value = new Date();
  value.setDate(value.getDate() - days);
  return value.toISOString().slice(0, 10);
}

async function openEvidence(file: FileAsset) {
  const preview = window.open("", "_blank");
  try {
    const token = getToken();
    const response = await fetch(new URL(`${getApiBase()}/api/v1/files/${file.id}/download`, window.location.origin), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error("Evidence could not be opened");
    const objectUrl = URL.createObjectURL(await response.blob());
    if (preview) preview.location.href = objectUrl;
    else {
      const link = document.createElement("a");
      link.href = objectUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.click();
    }
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    preview?.close();
    throw error;
  }
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
  const [attachmentFileAssetId, setAttachmentFileAssetId] = useState("");
  const [invoiceFileName, setInvoiceFileName] = useState("");
  const [invoiceMessage, setInvoiceMessage] = useState("");
  const [invoiceSuggestion, setInvoiceSuggestion] = useState<InvoiceExtractResult["suggestion"] | null>(null);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const set = (key: keyof typeof form) => (value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const extractMutation = useMutation<InvoiceExtractResult>(
    async () => {
      const file = fileInputRef.current?.files?.[0];
      if (!file) throw new Error("Choose an invoice, docket or receipt first");
      const formData = new FormData();
      formData.append("file", file);
      return api(`/api/v1/commercial/cost-tracking/projects/${detail.project.id}/invoice-costs/extract`, {
        method: "POST",
        formData,
      });
    },
    [],
  );
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
          source: attachmentFileAssetId ? "INVOICE_UPLOAD" : "MANUAL",
          sourceId: attachmentFileAssetId || undefined,
          attachmentFileAssetId: attachmentFileAssetId || undefined,
          evidence: attachmentFileAssetId ? { fileAssetId: attachmentFileAssetId, review: "USER_CONFIRMED" } : undefined,
          allowDuplicate,
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
            disabled={mutation.running || !form.description.trim() || !form.amount || !form.incurredAt || (!!invoiceSuggestion?.possibleDuplicate && !allowDuplicate)}
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
      <ErrorAlert error={extractMutation.error} onDismiss={extractMutation.reset} />
      {(invoiceSuggestion?.possibleDuplicate || mutation.error?.code === "DUPLICATE_COST_INVOICE") && (
        <div className="alert alert-warning" role="alert">
          <div>
            <b>Possible duplicate invoice</b>
            <div>Check the existing cost before adding this invoice again. Duplicate costs will overstate project expenditure and reduce the reported margin.</div>
            <label className="check-row" style={{ marginTop: 8 }}>
              <input type="checkbox" checked={allowDuplicate} onChange={(event) => setAllowDuplicate(event.target.checked)} />
              I have checked the existing cost and want to add this invoice again
            </label>
          </div>
        </div>
      )}
      <div className="form-grid">
        <Field label="Invoice, docket or receipt" span2 hint="Optional. Upload evidence and review the extracted total before adding the cost.">
          <div className="row">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.xlsx,.csv,.txt,image/*"
              onChange={() => {
                setInvoiceFileName(fileInputRef.current?.files?.[0]?.name ?? "");
                setAttachmentFileAssetId("");
                setInvoiceMessage("");
                setInvoiceSuggestion(null);
                setAllowDuplicate(false);
                extractMutation.reset();
              }}
            />
            <button
              className="btn btn-ghost"
              disabled={extractMutation.running || !invoiceFileName}
              onClick={() =>
                extractMutation.run({
                  onSuccess: (result) => {
                    const suggestion = result.suggestion;
                    setAttachmentFileAssetId(result.fileAsset.id);
                    setInvoiceMessage(suggestion.message);
                    setInvoiceSuggestion(suggestion);
                    setAllowDuplicate(false);
                    setForm((current) => ({
                      ...current,
                      type: suggestion.type,
                      status: "ACCRUED",
                      costCodeId: suggestion.costCodeId ?? current.costCodeId,
                      supplier: suggestion.supplier ?? current.supplier,
                      invoiceNumber: suggestion.invoiceNumber ?? current.invoiceNumber,
                      description: suggestion.description || current.description,
                      incurredAt: suggestion.incurredAt || current.incurredAt,
                      amount: suggestion.amount !== null ? String(suggestion.amount) : current.amount,
                    }));
                    toast.push("Evidence uploaded. Review the extracted cost before adding it.");
                  },
                })
              }
            >
              <Icon name="upload" size={15} /> {extractMutation.running ? "Reading..." : "Read file"}
            </button>
          </div>
          {invoiceMessage && <p className="muted" style={{ margin: "8px 0 0" }}>{invoiceMessage}</p>}
          {invoiceSuggestion?.costCodeLabel && (
            <p className="tiny muted" style={{ margin: "4px 0 0" }}>Remembered coding: {invoiceSuggestion.costCodeLabel}</p>
          )}
        </Field>
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

function DailyCostDraftEditor({
  detail,
  draft,
  selected,
  onSelectedChange,
}: {
  detail: CostTrackingProjectDetail;
  draft: DailyProjectCostDraft;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<DraftLineForm[]>(() => draft.lines.map(draftLineForm));
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const costCodeOptions = detail.costCodes.map((code) => ({ value: code.id, label: `${code.code} - ${code.description}` }));
  const isPosted = draft.status === "APPROVED";
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
        <label className="row" style={{ alignItems: "flex-start" }}>
          <input type="checkbox" checked={selected} disabled={isPosted || rows.length === 0} onChange={(event) => onSelectedChange(event.target.checked)} />
          <span>
            <b>{formatDate(draft.costDate)}</b>
            <div className="tiny muted">{rows.length} cost lines · {formatCurrency(total)}{isPosted ? " · posted" : ""}</div>
          </span>
        </label>
        <div className="row">
          <button className="btn btn-ghost btn-sm" disabled={isPosted} onClick={() => addRow("LABOUR")}>
            <Icon name="plus" size={14} /> Labour
          </button>
          <button className="btn btn-ghost btn-sm" disabled={isPosted} onClick={() => addRow("PLANT")}>
            <Icon name="plus" size={14} /> Plant
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={isPosted || mutation.running || rows.some((row) => !row.description.trim())}
            onClick={() => mutation.run({ onSuccess: () => toast.push("Daily cost draft saved") })}
          >
            {mutation.running ? "Saving..." : "Save draft"}
          </button>
        </div>
      </div>
      {isPosted && <p className="muted" style={{ margin: 0 }}>This day has already been posted to the project cost tracker.</p>}
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
                  <TextInput value={row.description} onChange={(value) => updateRow(index, { description: value })} disabled={isPosted} />
                  {row.source !== "MANUAL" && <div className="tiny muted">{titleCase(row.source)}</div>}
                </td>
                <td>
                  <Select value={row.type} onChange={(value) => updateRow(index, { type: value as CostEntryType })} disabled={isPosted} options={[{ value: "LABOUR", label: "Labour" }, { value: "PLANT", label: "Plant" }, { value: "OTHER", label: "Other" }]} />
                </td>
                <td>
                  <Select value={row.costCodeId} onChange={(value) => updateRow(index, { costCodeId: value })} disabled={isPosted} allowEmpty emptyLabel="Unallocated" options={costCodeOptions} />
                </td>
                <td>
                  <TextInput value={row.quantity} onChange={(value) => updateRow(index, { quantity: value })} disabled={isPosted} type="number" min={0} inputMode="decimal" />
                </td>
                <td>
                  <TextInput value={row.unitRate} onChange={(value) => updateRow(index, { unitRate: value, amount: "" })} disabled={isPosted} type="number" min={0} inputMode="decimal" />
                </td>
                <td>
                  <TextInput value={row.amount || String(((Number(row.quantity) || 0) * (Number(row.unitRate) || 0)).toFixed(2))} onChange={(value) => updateRow(index, { amount: value })} disabled={isPosted} type="number" min={0} inputMode="decimal" />
                </td>
                <td>
                  <button className="icon-btn" aria-label="Remove line" disabled={isPosted} onClick={() => removeRow(index)}>
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
  const toast = useToast();
  const [projectId, setProjectId] = useState("");
  const [editingPlan, setEditingPlan] = useState(false);
  const [addingCost, setAddingCost] = useState(false);
  const [addingForecast, setAddingForecast] = useState(false);
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const [openingEvidenceId, setOpeningEvidenceId] = useState("");
  const [draftFrom, setDraftFrom] = useState(() => dateInputDaysAgo(30));
  const [draftTo, setDraftTo] = useState(() => todayInput());
  const projects = useApiQuery<ProjectOption[]>("/api/v1/projects/options");
  const detail = useApiQuery<CostTrackingProjectDetail>(projectId ? `/api/v1/commercial/cost-tracking/projects/${projectId}` : null);
  const draftQuery = useApiQuery<DailyProjectCostDraft[]>(
    projectId ? `/api/v1/commercial/cost-tracking/projects/${projectId}/daily-cost-drafts` : null,
    { from: draftFrom, to: draftTo },
  );

  useEffect(() => {
    if (!projectId && projects.data?.[0]) setProjectId(projects.data[0].id);
  }, [projectId, projects.data]);
  useEffect(() => setSelectedDraftIds([]), [projectId, draftFrom, draftTo]);

  const selected = detail.data;
  const visibleDrafts = draftQuery.data ?? [];
  const selectableDraftIds = visibleDrafts.filter(draft => draft.status !== "APPROVED" && draft.lines.length > 0).map(draft => draft.id);
  const refreshAll = () => invalidate("/api/v1/commercial/cost-tracking");
  const postDraftMutation = useMutation(
    () =>
      api(`/api/v1/commercial/cost-tracking/projects/${projectId}/daily-cost-drafts/post`, {
        method: "POST",
        body: { draftIds: selectedDraftIds },
      }),
    ["/api/v1/commercial/cost-tracking"],
  );
  const toggleDraftSelection = (draftId: string, checked: boolean) => {
    setSelectedDraftIds((current) => checked ? [...new Set([...current, draftId])] : current.filter((id) => id !== draftId));
  };

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
        <ErrorAlert error={projects.error ?? detail.error ?? draftQuery.error} />
      </section>

      {(projects.loading || detail.loading) && <Loading />}
      {!projects.loading && projects.data?.length === 0 && (
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
                <h2>Needs attention</h2>
                <span className="hint">Work the exceptions, not every transaction.</span>
              </div>
              <div className="card-pad stack">
                {detail.data && Object.values(detail.data.attention).every(value => value === 0) ? (
                  <div className="alert alert-good"><b>Cost book is tidy.</b> No current exceptions need review.</div>
                ) : detail.data ? (
                  <div className="summary-list">
                    <div className="summary-list-item"><span>Draft days ready for review</span><b>{detail.data.attention.draftDays}</b></div>
                    <div className="summary-list-item"><span>Draft lines missing a rate</span><b>{detail.data.attention.missingRates}</b></div>
                    <div className="summary-list-item"><span>Unallocated costs or lines</span><b>{detail.data.attention.unallocated}</b></div>
                    <div className="summary-list-item"><span>Invoices missing evidence</span><b>{detail.data.attention.missingEvidence}</b></div>
                    <div className="summary-list-item"><span>Disputed costs</span><b>{detail.data.attention.disputed}</b></div>
                  </div>
                ) : <Loading />}
              </div>
            </section>
          </div>

          {detail.data && (
            <>
              <section className="card">
                <div className="card-header">
                  <div>
                    <h2>Cost code control</h2>
                    <span className="hint">Budget versus actual, committed, and forecast exposure.</span>
                  </div>
                  <StatusBadge status={detail.data.costCodePerformance.some(row => row.variance < 0) ? "AT_RISK" : "ON_TRACK"} />
                </div>
                <div className="table-wrap">
                  <table className="table cost-control-table">
                    <thead>
                      <tr>
                        <th>Cost code</th>
                        <th style={{ textAlign: "right" }}>Budget</th>
                        <th style={{ textAlign: "right" }}>Actual</th>
                        <th style={{ textAlign: "right" }}>Committed</th>
                        <th style={{ textAlign: "right" }}>Forecast</th>
                        <th style={{ textAlign: "right" }}>Exposure</th>
                        <th style={{ textAlign: "right" }}>Variance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.costCodePerformance.map(row => (
                        <tr key={`${row.code}-${row.costCodeId ?? "project"}`}>
                          <td>
                            <b>{row.code}</b>
                            <div className="tiny muted">{row.description}</div>
                            <div className="cost-progress" aria-label={row.usedPercent === null ? "No budget set" : `${row.usedPercent}% of budget exposed`}>
                              <span
                                className={row.variance < 0 ? "over" : ""}
                                style={{ width: `${Math.min(Math.max(row.usedPercent ?? 0, 0), 100)}%` }}
                              />
                            </div>
                          </td>
                          <td style={{ textAlign: "right" }}>{formatCurrency(row.budget)}</td>
                          <td style={{ textAlign: "right" }}>{formatCurrency(row.actual)}</td>
                          <td style={{ textAlign: "right" }}>{formatCurrency(row.committed)}</td>
                          <td style={{ textAlign: "right" }}>{formatCurrency(row.forecast)}</td>
                          <td style={{ textAlign: "right" }}><b>{formatCurrency(row.exposure)}</b></td>
                          <td className={row.variance < 0 ? "cost-negative" : "cost-positive"} style={{ textAlign: "right" }}>
                            {formatCurrency(row.variance)}
                          </td>
                        </tr>
                      ))}
                      {detail.data.costCodePerformance.length === 0 && (
                        <tr>
                          <td colSpan={7}><EmptyState title="No cost code activity" hint="Add cost-code budgets or allocate project costs to see the control view." /></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="card">
                <div className="card-header">
                  <div>
                    <h2>Daily draft costs</h2>
                    <span className="hint">Timecards and pre-starts linked to this project, grouped by work day.</span>
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={postDraftMutation.running || selectedDraftIds.length === 0}
                    aria-busy={postDraftMutation.running}
                    onClick={() =>
                      postDraftMutation.run({
                        onSuccess: () => {
                          toast.push(`${selectedDraftIds.length} draft day${selectedDraftIds.length === 1 ? "" : "s"} posted to project costs`);
                          setSelectedDraftIds([]);
                        },
                      })
                    }
                  >
                    {postDraftMutation.running ? "Posting..." : `Post selected (${selectedDraftIds.length})`}
                  </button>
                </div>
                <div className="card-pad stack">
                  <ErrorAlert error={postDraftMutation.error} onDismiss={postDraftMutation.reset} />
                  <div className="draft-review-controls">
                    <Field label="From">
                      <TextInput value={draftFrom} onChange={setDraftFrom} type="date" />
                    </Field>
                    <Field label="To">
                      <TextInput value={draftTo} onChange={setDraftTo} type="date" />
                    </Field>
                    <div className="row draft-selection-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={selectableDraftIds.length === 0}
                        onClick={() => setSelectedDraftIds(selectableDraftIds)}
                      >
                        Select all ready ({selectableDraftIds.length})
                      </button>
                      {selectedDraftIds.length > 0 && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setSelectedDraftIds([])}>Clear</button>
                      )}
                    </div>
                  </div>
                  {draftQuery.loading ? <Loading /> : visibleDrafts.length === 0 ? (
                    <EmptyState title="No draft daily costs" hint="Submitted timecards and plant pre-starts will appear here for review." />
                  ) : (
                    visibleDrafts.map((draft) => (
                      <DailyCostDraftEditor
                        key={draft.id}
                        detail={detail.data!}
                        draft={draft}
                        selected={selectedDraftIds.includes(draft.id)}
                        onSelectedChange={(checked) => toggleDraftSelection(draft.id, checked)}
                      />
                    ))
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
                        <th>Evidence</th>
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
                          <td>
                            {entry.attachment ? (
                              <button
                                className="btn btn-ghost btn-sm"
                                aria-busy={openingEvidenceId === entry.id}
                                disabled={openingEvidenceId === entry.id}
                                onClick={async () => {
                                  setOpeningEvidenceId(entry.id);
                                  try {
                                    await openEvidence(entry.attachment!);
                                  } catch {
                                    toast.push("Evidence could not be opened", "error");
                                  } finally {
                                    setOpeningEvidenceId("");
                                  }
                                }}
                              >
                                <Icon name="file" size={14} /> {openingEvidenceId === entry.id ? "Opening..." : "View"}
                              </button>
                            ) : <span className="tiny muted">None</span>}
                          </td>
                          <td style={{ textAlign: "right" }}>{formatCurrency(entry.amount)}</td>
                        </tr>
                      ))}
                      {detail.data.costEntries.length === 0 && (
                        <tr>
                          <td colSpan={6}>
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
