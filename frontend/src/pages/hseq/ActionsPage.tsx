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
  RiskBadge,
  Select,
  StatusBadge,
  TextArea,
  TextInput,
  useToast,
} from "../../components/ui.tsx";
import { WorkerSelect } from "../../components/WorkerSelect.tsx";
import { api } from "../../lib/api.ts";
import { HSEQ_EDITORS, useAuth } from "../../lib/auth.tsx";
import { formatDate, isOverdue } from "../../lib/format.ts";
import type { CorrectiveAction } from "../../lib/types.ts";
import { useApiQuery, useMutation } from "../../lib/useApi.ts";

const RISKS = ["LOW", "MEDIUM", "HIGH", "EXTREME"];
const SOURCE_KINDS = [
  { value: "", label: "Standalone" },
  { value: "incidentId", label: "Incident" },
  { value: "hazardId", label: "Hazard" },
  { value: "observationId", label: "Observation" },
  { value: "inspectionId", label: "Inspection" },
  { value: "permitId", label: "Permit" },
];

function sourceLabel(action: CorrectiveAction): string {
  if (action.incident) return `Incident · ${action.incident.type ?? action.incidentId?.slice(0, 8)}`;
  if (action.hazard) return `Hazard · ${action.hazard.title ?? ""}`;
  if (action.observation) return `Observation · ${action.observation.title ?? ""}`;
  if (action.inspection) return `Inspection · ${action.inspection.title ?? ""}`;
  if (action.permit) return `Permit · ${action.permit.title ?? ""}`;
  return action.source ?? "—";
}

function CreateActionModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    projectId: "",
    description: "",
    ownerId: "",
    dueAt: "",
    priority: "MEDIUM",
    source: "",
    sourceKind: "",
    sourceId: "",
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const mutation = useMutation(
    () =>
      api<CorrectiveAction>("/api/v1/safety/actions", {
        method: "POST",
        body: {
          projectId: form.projectId,
          description: form.description.trim(),
          ownerId: form.ownerId.trim(),
          dueAt: new Date(form.dueAt).toISOString(),
          priority: form.priority,
          source: form.source.trim() || undefined,
          ...(form.sourceKind && form.sourceId.trim() ? { [form.sourceKind]: form.sourceId.trim() } : {}),
        },
      }),
    ["/api/v1/safety/actions", "/api/v1/safety/dashboard"],
  );

  return (
    <Modal
      title="New corrective action"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || !form.projectId || form.description.trim().length < 3 || !form.ownerId.trim() || !form.dueAt}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push("Corrective action created");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Creating…" : "Create action"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <div className="form-grid">
        <Field label="Project" required error={mutation.fieldErrors["projectId"]}>
          <ProjectSelect value={form.projectId} onChange={set("projectId")} allowEmpty emptyLabel="— Select project —" activeOnly />
        </Field>
        <Field label="Priority" required>
          <Select value={form.priority} onChange={set("priority")} options={RISKS} />
        </Field>
        <Field label="What needs to happen" required span2 error={mutation.fieldErrors["description"]}>
          <TextArea value={form.description} onChange={set("description")} />
        </Field>
        <Field label="Owner" required error={mutation.fieldErrors["ownerId"]}>
          <WorkerSelect value={form.ownerId} onChange={set("ownerId")} />
        </Field>
        <Field label="Due" required error={mutation.fieldErrors["dueAt"]}>
          <TextInput value={form.dueAt} onChange={set("dueAt")} type="date" />
        </Field>
        <Field label="Linked source">
          <Select value={form.sourceKind} onChange={set("sourceKind")} options={SOURCE_KINDS} />
        </Field>
        {form.sourceKind && (
          <Field label="Source record ID" hint="Must belong to the same project.">
            <TextInput value={form.sourceId} onChange={set("sourceId")} mono />
          </Field>
        )}
        <Field label="Source note" span2>
          <TextInput value={form.source} onChange={set("source")} placeholder="e.g. Site walk defect" />
        </Field>
      </div>
    </Modal>
  );
}

function EditActionModal({ action, onClose }: { action: CorrectiveAction; onClose: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<string>(action.status);
  const [priority, setPriority] = useState<string>(action.priority);
  const [dueAt, setDueAt] = useState("");
  const [completionNotes, setCompletionNotes] = useState(action.completionNotes ?? "");
  const mutation = useMutation(
    () =>
      api(`/api/v1/safety/actions/${action.id}`, {
        method: "PATCH",
        body: {
          status,
          priority,
          dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
          completionNotes: completionNotes.trim() || undefined,
        },
      }),
    ["/api/v1/safety/actions", "/api/v1/safety/dashboard"],
  );
  return (
    <Modal
      title="Update action"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || (status === "CLOSED" && !completionNotes.trim())}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push("Action updated");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <p className="muted">{action.description}</p>
      <Field label="Status">
        <Select value={status} onChange={setStatus} options={["ACTIVE", "SUBMITTED", "CLOSED", "CANCELLED"]} />
      </Field>
      <Field label="Priority">
        <Select value={priority} onChange={setPriority} options={RISKS} />
      </Field>
      <Field label="New due date">
        <TextInput value={dueAt} onChange={setDueAt} type="date" />
      </Field>
      <Field label="Completion notes" required={status === "CLOSED"} hint={status === "CLOSED" ? "Describe the fix and evidence before closing." : undefined}>
        <TextArea value={completionNotes} onChange={setCompletionNotes} />
      </Field>
    </Modal>
  );
}

export function ActionsPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole(...HSEQ_EDITORS);
  const [projectId, setProjectId] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const { data, loading, error } = useApiQuery<CorrectiveAction[]>("/api/v1/safety/actions", {
    projectId: projectId || undefined,
    overdue: overdueOnly || undefined,
  });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CorrectiveAction | null>(null);

  const open = (data ?? []).filter((action) => !["CLOSED", "CANCELLED"].includes(action.status));
  const closed = (data ?? []).filter((action) => ["CLOSED", "CANCELLED"].includes(action.status));

  return (
    <Layout
      title="Corrective actions"
      actions={
        canEdit ? (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} /> New action
          </button>
        ) : undefined
      }
    >
      <div className="filter-row">
        <ProjectSelect value={projectId} onChange={setProjectId} allowEmpty />
        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={overdueOnly} onChange={(e: { target: { checked: boolean } }) => setOverdueOnly(e.target.checked)} />
          Overdue only
        </label>
        {canEdit && (
          <button className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }} onClick={() => setCreating(true)}>
            <Icon name="plus" size={13} /> New
          </button>
        )}
      </div>

      <ErrorAlert error={error} />
      {loading && !data && <Loading />}
      {data && data.length === 0 && (
        <div className="card">
          <EmptyState title="No corrective actions" hint="Actions raised from incidents, hazards, observations, inspections and permits are tracked here to closure." />
        </div>
      )}

      {open.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Project</th>
                <th>Source</th>
                <th>Priority</th>
                <th>Due</th>
                <th>Status</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {open.map((action) => (
                <ActionRow key={action.id} action={action} canEdit={canEdit} onEdit={() => setEditing(action)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {closed.length > 0 && (
        <details>
          <summary className="muted" style={{ cursor: "pointer" }}>
            Closed & cancelled ({closed.length})
          </summary>
          <div className="card table-wrap" style={{ marginTop: 10 }}>
            <table className="table">
              <tbody>
                {closed.map((action) => (
                  <ActionRow key={action.id} action={action} canEdit={false} onEdit={() => {}} />
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {creating && <CreateActionModal onClose={() => setCreating(false)} />}
      {editing && <EditActionModal action={editing} onClose={() => setEditing(null)} />}
    </Layout>
  );
}

function ActionRow({ action, canEdit, onEdit }: { action: CorrectiveAction; canEdit: boolean; onEdit: () => void }) {
  const projectName = useProjectName(action.projectId);
  const overdue = isOverdue(action.dueAt) && !["CLOSED", "CANCELLED"].includes(action.status);
  return (
    <tr>
      <td>
        <b>{action.description}</b>
        {action.completionNotes && <div className="tiny">Closure: {action.completionNotes}</div>}
      </td>
      <td className="mono tiny">{projectName}</td>
      <td className="tiny">{sourceLabel(action)}</td>
      <td>
        <RiskBadge level={action.priority} />
      </td>
      <td className={"tiny" + (overdue ? " field-error" : "")}>
        {formatDate(action.dueAt)}
        {overdue ? " · overdue" : ""}
      </td>
      <td>
        <StatusBadge status={action.status} />
      </td>
      {canEdit && (
        <td>
          <button className="btn btn-ghost btn-sm" onClick={onEdit}>
            Update
          </button>
        </td>
      )}
    </tr>
  );
}
