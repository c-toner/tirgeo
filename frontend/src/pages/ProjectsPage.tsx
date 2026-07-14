import { useState } from "react";
import { Layout } from "../components/Layout.tsx";
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
} from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { PROJECT_LEADERS, useAuth } from "../lib/auth.tsx";
import { formatCurrency, formatDate, isoDateOnly } from "../lib/format.ts";
import type { Project, ProjectStatus } from "../lib/types.ts";
import { useApiQuery, useMutation } from "../lib/useApi.ts";

const JURISDICTIONS = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];

// Mirrors backend lifecycle: forward transitions plus ON_HOLD loops.
const PROJECT_STATUSES: ProjectStatus[] = [
  "TENDER",
  "AWARDED",
  "MOBILISING",
  "ACTIVE",
  "ON_HOLD",
  "PRACTICAL_COMPLETION",
  "DEFECTS_LIABILITY",
  "CLOSED",
];

function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    code: "",
    name: "",
    clientName: "",
    jurisdiction: "NSW",
    address: "",
    description: "",
    contractValue: "",
    startDate: "",
    endDate: "",
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const mutation = useMutation(
    () =>
      api<Project>("/api/v1/projects", {
        method: "POST",
        body: {
          code: form.code.trim(),
          name: form.name.trim(),
          clientName: form.clientName.trim() || undefined,
          description: form.description.trim() || undefined,
          jurisdiction: form.jurisdiction,
          address: form.address.trim() || undefined,
          contractValue: form.contractValue ? Number(form.contractValue) : undefined,
          startDate: form.startDate ? isoDateOnly(form.startDate) : undefined,
          endDate: form.endDate ? isoDateOnly(form.endDate) : undefined,
        },
      }),
    ["/api/v1/projects"],
  );

  const submit = () =>
    mutation.run({
      onSuccess: (project) => {
        toast.push(`Project ${project.code} created`);
        onClose();
      },
    });

  return (
    <Modal
      title="New project"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={mutation.running || !form.code || form.name.length < 2}>
            {mutation.running ? "Creating…" : "Create project"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <div className="form-grid">
        <Field label="Project code" required error={mutation.fieldErrors["code"]}>
          <TextInput value={form.code} onChange={set("code")} placeholder="e.g. TG-2026-014" mono />
        </Field>
        <Field label="Jurisdiction" required error={mutation.fieldErrors["jurisdiction"]}>
          <Select value={form.jurisdiction} onChange={set("jurisdiction")} options={JURISDICTIONS.map((j) => ({ value: j, label: j }))} />
        </Field>
        <Field label="Project name" required error={mutation.fieldErrors["name"]} span2>
          <TextInput value={form.name} onChange={set("name")} placeholder="e.g. Bellbird Rd stormwater upgrade" />
        </Field>
        <Field label="Client" error={mutation.fieldErrors["clientName"]}>
          <TextInput value={form.clientName} onChange={set("clientName")} placeholder="Principal / head contractor" />
        </Field>
        <Field label="Contract value (AUD)" error={mutation.fieldErrors["contractValue"]}>
          <TextInput value={form.contractValue} onChange={set("contractValue")} type="number" min={0} inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="Start date" error={mutation.fieldErrors["startDate"]}>
          <TextInput value={form.startDate} onChange={set("startDate")} type="date" />
        </Field>
        <Field label="End date" error={mutation.fieldErrors["endDate"]}>
          <TextInput value={form.endDate} onChange={set("endDate")} type="date" />
        </Field>
        <Field label="Site address" span2 error={mutation.fieldErrors["address"]}>
          <TextInput value={form.address} onChange={set("address")} />
        </Field>
        <Field label="Description" span2 error={mutation.fieldErrors["description"]}>
          <TextArea value={form.description} onChange={set("description")} />
        </Field>
      </div>
    </Modal>
  );
}

function StatusModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<string>(project.status);
  const mutation = useMutation(
    () => api<Project>(`/api/v1/projects/${project.id}/status`, { method: "PATCH", body: { status } }),
    ["/api/v1/projects"],
  );
  return (
    <Modal
      title={`Move ${project.code}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || status === project.status}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push(`Project moved to ${status.replaceAll("_", " ").toLowerCase()}`);
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Updating…" : "Update status"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      {mutation.error?.status === 409 && (
        <div className="alert alert-warning">The lifecycle only moves forwards (with on-hold loops). Pick an adjacent stage.</div>
      )}
      <Field label="Lifecycle stage">
        <Select value={status} onChange={setStatus} options={PROJECT_STATUSES.map((s) => ({ value: s, label: s.replaceAll("_", " ") }))} />
      </Field>
      <p className="tiny">
        Current stage: <StatusBadge status={project.status} />
      </p>
    </Modal>
  );
}

export function ProjectsPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole(...PROJECT_LEADERS);
  const { data, loading, error } = useApiQuery<Project[]>("/api/v1/projects");
  const [creating, setCreating] = useState(false);
  const [statusFor, setStatusFor] = useState<Project | null>(null);
  const [filter, setFilter] = useState("");

  const projects = (data ?? []).filter(
    (project) =>
      !filter ||
      project.code.toLowerCase().includes(filter.toLowerCase()) ||
      project.name.toLowerCase().includes(filter.toLowerCase()) ||
      (project.clientName ?? "").toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <Layout
      title="Projects"
      actions={
        canEdit ? (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} /> New project
          </button>
        ) : undefined
      }
    >
      <div className="filter-row">
        <input className="input" style={{ maxWidth: 320 }} placeholder="Search code, name or client…" value={filter} onChange={(e: { target: { value: string } }) => setFilter(e.target.value)} />
        {canEdit && (
          <button className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }} onClick={() => setCreating(true)}>
            <Icon name="plus" size={13} /> New
          </button>
        )}
      </div>

      <ErrorAlert error={error} />
      {loading && !data && <Loading />}

      {data && projects.length === 0 && (
        <div className="card">
          <EmptyState
            title={filter ? "No projects match your search" : "No projects yet"}
            hint={canEdit ? "Create the first project to unlock diaries, HSEQ records and timesheets." : "Projects will appear once an administrator creates them."}
            action={
              canEdit && !filter ? (
                <button className="btn btn-primary" onClick={() => setCreating(true)}>
                  <Icon name="plus" size={15} /> Create project
                </button>
              ) : undefined
            }
          />
        </div>
      )}

      {projects.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Project</th>
                <th>Client</th>
                <th>Jurisdiction</th>
                <th className="num">Contract value</th>
                <th>Dates</th>
                <th>Status</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td className="mono">{project.code}</td>
                  <td>
                    <b>{project.name}</b>
                    {project.address && <div className="tiny">{project.address}</div>}
                  </td>
                  <td>{project.clientName ?? "—"}</td>
                  <td>{project.jurisdiction}</td>
                  <td className="num">{formatCurrency(project.contractValue)}</td>
                  <td className="tiny">
                    {formatDate(project.startDate)} → {formatDate(project.endDate)}
                  </td>
                  <td>
                    <StatusBadge status={project.status} />
                  </td>
                  {canEdit && (
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => setStatusFor(project)}>
                        Move
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <CreateProjectModal onClose={() => setCreating(false)} />}
      {statusFor && <StatusModal project={statusFor} onClose={() => setStatusFor(null)} />}
    </Layout>
  );
}
