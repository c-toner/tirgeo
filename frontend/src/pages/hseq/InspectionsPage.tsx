import { useState } from "react";
import { Layout } from "../../components/Layout.tsx";
import { ProjectSelect, useProjectName } from "../../components/ProjectSelect.tsx";
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
import { api } from "../../lib/api.ts";
import { HSEQ_EDITORS, HSEQ_VERIFIERS, useAuth } from "../../lib/auth.tsx";
import { formatDateTime, titleCase } from "../../lib/format.ts";
import type { HseqInspection, InspectionResult } from "../../lib/types.ts";
import { useApiQuery, useMutation } from "../../lib/useApi.ts";

const INSPECTION_TYPES = ["SITE_WALK", "PRE_START", "ENVIRONMENTAL", "QUALITY_AUDIT", "HSEQ_AUDIT", "PLANT"];
const RESULTS: InspectionResult[] = ["PASS", "DEFECT", "OUT_OF_SERVICE"];

interface DraftItem {
  section: string;
  question: string;
  result: InspectionResult;
  notes: string;
  correctiveActionRequired: boolean;
}

const STARTER_ITEMS: DraftItem[] = [
  { section: "Access", question: "Walkways clear, signed and delineated", result: "PASS", notes: "", correctiveActionRequired: false },
  { section: "Exclusion zones", question: "Plant/people separation maintained", result: "PASS", notes: "", correctiveActionRequired: false },
];

function ResultSeg({ value, onChange }: { value: InspectionResult; onChange: (result: InspectionResult) => void }) {
  const cls: Record<InspectionResult, string> = { PASS: "on-pass", DEFECT: "on-fail", OUT_OF_SERVICE: "on-na" };
  return (
    <div className="seg" role="radiogroup">
      {RESULTS.map((result) => (
        <button key={result} type="button" className={value === result ? cls[result] : ""} onClick={() => onChange(result)}>
          {result === "OUT_OF_SERVICE" ? "OOS" : titleCase(result)}
        </button>
      ))}
    </div>
  );
}

function InspectionBuilder({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ projectId: "", type: "SITE_WALK", title: "", location: "", notes: "" });
  const [items, setItems] = useState<DraftItem[]>(STARTER_ITEMS);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const patchItem = (index: number, patch: Partial<DraftItem>) =>
    setItems((list) => list.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const mutation = useMutation(
    () =>
      api<HseqInspection>("/api/v1/safety/inspections", {
        method: "POST",
        body: {
          projectId: form.projectId,
          type: form.type,
          title: form.title.trim(),
          location: form.location.trim() || undefined,
          inspectedAt: new Date().toISOString(),
          status: "SUBMITTED",
          notes: form.notes.trim() || undefined,
          items: items
            .filter((item) => item.question.trim().length >= 2)
            .map((item) => ({
              section: item.section.trim() || undefined,
              question: item.question.trim(),
              result: item.result,
              notes: item.notes.trim() || undefined,
              correctiveActionRequired: item.correctiveActionRequired,
            })),
        },
      }),
    ["/api/v1/safety/inspections", "/api/v1/safety/dashboard"],
  );

  const flagged = items.filter((item) => item.result !== "PASS");

  return (
    <Modal
      title="New inspection"
      large
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || !form.projectId || form.title.trim().length < 3 || items.every((item) => !item.question.trim())}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push(
                    flagged.length
                      ? `Inspection submitted — ${flagged.length} item(s) need corrective actions`
                      : "Inspection submitted",
                  );
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Submitting…" : "Submit inspection"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <div className="form-grid">
        <Field label="Project" required error={mutation.fieldErrors["projectId"]}>
          <ProjectSelect value={form.projectId} onChange={set("projectId")} allowEmpty emptyLabel="— Select project —" activeOnly />
        </Field>
        <Field label="Type" required>
          <Select value={form.type} onChange={set("type")} options={INSPECTION_TYPES} />
        </Field>
        <Field label="Title" required span2 error={mutation.fieldErrors["title"]}>
          <TextInput value={form.title} onChange={set("title")} placeholder="e.g. Morning site walk — Stage 2" />
        </Field>
        <Field label="Location" span2>
          <TextInput value={form.location} onChange={set("location")} />
        </Field>
      </div>

      <div className="row-between">
        <h3>Checklist items</h3>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setItems((list) => [...list, { section: "", question: "", result: "PASS", notes: "", correctiveActionRequired: false }])}
        >
          <Icon name="plus" size={13} /> Add item
        </button>
      </div>

      {items.map((item, index) => (
        <div key={index} className="checklist-q">
          <div className="form-grid">
            <Field label="Section">
              <TextInput value={item.section} onChange={(value) => patchItem(index, { section: value })} placeholder="e.g. Excavation" />
            </Field>
            <Field label="Question / check" required>
              <TextInput value={item.question} onChange={(value) => patchItem(index, { question: value })} />
            </Field>
          </div>
          <div className="row-between">
            <ResultSeg
              value={item.result}
              onChange={(result) =>
                patchItem(index, { result, correctiveActionRequired: result !== "PASS" ? true : item.correctiveActionRequired })
              }
            />
            <div className="row" style={{ gap: 12 }}>
              <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
                <input
                  type="checkbox"
                  checked={item.correctiveActionRequired}
                  onChange={(e: { target: { checked: boolean } }) => patchItem(index, { correctiveActionRequired: e.target.checked })}
                />
                Action required
              </label>
              <button className="btn-icon" onClick={() => setItems((list) => list.filter((_, i) => i !== index))} aria-label="Remove item">
                <Icon name="x" size={14} />
              </button>
            </div>
          </div>
          {item.result !== "PASS" && (
            <TextArea value={item.notes} onChange={(value) => patchItem(index, { notes: value })} rows={2} placeholder="Describe the defect or issue…" />
          )}
        </div>
      ))}

      <Field label="Overall notes">
        <TextArea value={form.notes} onChange={set("notes")} rows={2} />
      </Field>
    </Modal>
  );
}

function CompleteModal({ inspection, onClose }: { inspection: HseqInspection; onClose: () => void }) {
  const toast = useToast();
  const defects = inspection.items.filter((item) => item.result !== "PASS").length;
  const [result, setResult] = useState<string>(defects > 0 ? "DEFECT" : "PASS");
  const [score, setScore] = useState("");
  const [notes, setNotes] = useState("");
  const mutation = useMutation(
    () =>
      api(`/api/v1/safety/inspections/${inspection.id}/complete`, {
        method: "PATCH",
        body: {
          result,
          score: score ? Number(score) : undefined,
          notes: notes.trim() || undefined,
        },
      }),
    ["/api/v1/safety/inspections", "/api/v1/safety/dashboard"],
  );
  return (
    <Modal
      title={`Close out — ${inspection.title}`}
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
                  toast.push("Inspection closed");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Closing…" : "Close inspection"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      {defects > 0 && (
        <div className="alert alert-warning">
          {defects} checklist item(s) were flagged. Create corrective actions from the Actions page and link them to
          this inspection before closing if follow-up is required.
        </div>
      )}
      <Field label="Overall result" required>
        <Select value={result} onChange={setResult} options={RESULTS.map((r) => ({ value: r, label: titleCase(r) }))} />
      </Field>
      <Field label="Score (0–100)">
        <TextInput value={score} onChange={setScore} type="number" min={0} max={100} inputMode="numeric" />
      </Field>
      <Field label="Closure notes">
        <TextArea value={notes} onChange={setNotes} />
      </Field>
    </Modal>
  );
}

export function InspectionsPage() {
  const { hasRole } = useAuth();
  const canCreate = hasRole(...HSEQ_EDITORS);
  const canClose = hasRole(...HSEQ_VERIFIERS);
  const [projectId, setProjectId] = useState("");
  const [type, setType] = useState("");
  const { data, loading, error } = useApiQuery<HseqInspection[]>("/api/v1/safety/inspections", {
    projectId: projectId || undefined,
    type: type || undefined,
  });
  const [building, setBuilding] = useState(false);
  const [closing, setClosing] = useState<HseqInspection | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Layout
      title="Inspections"
      actions={
        canCreate ? (
          <button className="btn btn-primary" onClick={() => setBuilding(true)}>
            <Icon name="plus" size={15} /> New inspection
          </button>
        ) : undefined
      }
    >
      <div className="filter-row">
        <ProjectSelect value={projectId} onChange={setProjectId} allowEmpty />
        <Select value={type} onChange={setType} allowEmpty emptyLabel="Any type" options={INSPECTION_TYPES} />
        {canCreate && (
          <button className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }} onClick={() => setBuilding(true)}>
            <Icon name="plus" size={13} /> New
          </button>
        )}
      </div>

      <ErrorAlert error={error} />
      {loading && !data && <Loading />}
      {data && data.length === 0 && (
        <div className="card">
          <EmptyState title="No inspections yet" hint="Site walks, audits and environmental checks appear here with their item results." />
        </div>
      )}

      {data && data.length > 0 && (
        <div className="stack">
          {data.map((inspection) => {
            const flagged = inspection.items.filter((item) => item.result !== "PASS");
            const isOpen = expanded === inspection.id;
            return (
              <div className="card" key={inspection.id}>
                <div className="card-header" style={{ cursor: "pointer" }} onClick={() => setExpanded(isOpen ? null : inspection.id)}>
                  <div>
                    <h2>{inspection.title}</h2>
                    <span className="tiny">
                      {titleCase(inspection.type)} · <ProjectCode projectId={inspection.projectId} /> ·{" "}
                      {formatDateTime(inspection.inspectedAt)} · {inspection.items.length} items
                      {flagged.length > 0 ? ` · ${flagged.length} flagged` : ""}
                    </span>
                  </div>
                  <div className="row">
                    {inspection.score !== null && inspection.score !== undefined && (
                      <span className="badge no-dot">{inspection.score}/100</span>
                    )}
                    <StatusBadge status={inspection.status} />
                    {canClose && inspection.status !== "CLOSED" && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={(e: { stopPropagation: () => void }) => {
                          e.stopPropagation();
                          setClosing(inspection);
                        }}
                      >
                        Close out
                      </button>
                    )}
                  </div>
                </div>
                {isOpen && (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Section</th>
                          <th>Check</th>
                          <th>Result</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inspection.items.map((item, i) => (
                          <tr key={item.id ?? i}>
                            <td className="tiny">{item.section ?? "—"}</td>
                            <td>{item.question}</td>
                            <td>
                              <span className={`badge ${item.result === "PASS" ? "badge-good" : item.result === "DEFECT" ? "badge-serious" : "badge-critical"}`}>
                                {titleCase(item.result)}
                              </span>
                            </td>
                            <td className="tiny">
                              {item.notes ?? "—"}
                              {item.correctiveActionRequired && <span className="badge badge-warning" style={{ marginLeft: 6 }}>Action required</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {building && <InspectionBuilder onClose={() => setBuilding(false)} />}
      {closing && <CompleteModal inspection={closing} onClose={() => setClosing(null)} />}
    </Layout>
  );
}

function ProjectCode({ projectId }: { projectId: string }) {
  const name = useProjectName(projectId);
  return <>{name}</>;
}
