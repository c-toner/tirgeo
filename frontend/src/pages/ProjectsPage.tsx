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
import type { Plant, Project, ProjectStatus } from "../lib/types.ts";
import { useApiQuery, useMutation } from "../lib/useApi.ts";
import { WorkerMultiSelect } from "../components/WorkerSelect.tsx";
import { ProjectSelect } from "../components/ProjectSelect.tsx";

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
    parentProjectId: "",
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
          parentProjectId: form.parentProjectId || undefined,
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
        <Field label="Parent project" span2 hint="Optional. Use this for stages, separable portions or sub-projects under a main job.">
          <ProjectSelect value={form.parentProjectId} onChange={set("parentProjectId")} allowEmpty emptyLabel="No parent project" />
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

function plantLabel(plant: Plant): string {
  const makeModel = [plant.make, plant.model].filter(Boolean).join(" ");
  return `${plant.assetNumber} · ${plant.type}${makeModel ? ` · ${makeModel}` : ""}`;
}

function PlantMultiSelect({ value, onChange }: { value: string[]; onChange: (plantIds: string[]) => void }) {
  const { data } = useApiQuery<Plant[]>("/api/v1/plant");
  const [query, setQuery] = useState("");
  const plants = data ?? [];
  const selected = plants.filter((plant) => value.includes(plant.id));
  const filtered = plants
    .filter((plant) => !value.includes(plant.id))
    .filter((plant) => plantLabel(plant).toLowerCase().includes(query.trim().toLowerCase()));
  const remove = (id: string) => onChange(value.filter((plantId) => plantId !== id));

  return (
    <div className="worker-select">
      {selected.length > 0 && (
        <div className="worker-chips">
          {selected.map((plant) => (
            <button type="button" key={plant.id} onClick={() => remove(plant.id)} aria-label={`Remove ${plant.assetNumber}`}>
              {plant.assetNumber}
              <Icon name="x" size={12} />
            </button>
          ))}
        </div>
      )}
      <TextInput value={query} onChange={setQuery} placeholder="Search plant by asset, type or model" />
      {query && filtered.length > 0 && (
        <div className="worker-options" role="listbox">
          {filtered.slice(0, 30).map((plant) => (
            <button
              key={plant.id}
              type="button"
              onClick={() => {
                onChange([...value, plant.id]);
                setQuery("");
              }}
            >
              <span>
                {plant.assetNumber}
                {plant.currentProject && <em>{plant.currentProject.code}</em>}
              </span>
              <small>{[plant.type, plant.make, plant.model, plant.status].filter(Boolean).join(" · ")}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ResourcesModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const toast = useToast();
  const [workerIds, setWorkerIds] = useState(() => (project.currentWorkers ?? []).map((worker) => worker.id));
  const [plantIds, setPlantIds] = useState(() => (project.currentPlant ?? []).map((plant) => plant.id));
  const mutation = useMutation(
    () =>
      api<Project>(`/api/v1/projects/${project.id}/resources`, {
        method: "PATCH",
        body: { workerIds, plantIds },
      }),
    ["/api/v1/projects"],
  );

  return (
    <Modal
      title={`Resources on ${project.code}`}
      onClose={onClose}
      large
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
                  toast.push("Project resources updated");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Saving…" : "Save resources"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <p className="muted">
        Assign the people and plant currently working on this project. Worker locations are also updated automatically when they create or lodge timecards.
      </p>
      <div className="form-grid">
        <Field label={`Workers (${workerIds.length})`} hint="Selecting a worker moves their current project to this job.">
          <WorkerMultiSelect value={workerIds} onChange={setWorkerIds} placeholder="Search workers to assign" />
        </Field>
        <Field label={`Plant (${plantIds.length})`} hint="Selecting plant moves its current project to this job.">
          <PlantMultiSelect value={plantIds} onChange={setPlantIds} />
        </Field>
      </div>
    </Modal>
  );
}

function daysOnSite(assignedAt?: string | null): string {
  if (!assignedAt) return "today";
  const started = new Date(assignedAt);
  if (Number.isNaN(started.getTime())) return "today";
  const days = Math.max(0, Math.floor((Date.now() - started.getTime()) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function ProjectDetailPanel({ project, canEdit, onResources }: { project: Project; canEdit: boolean; onResources: () => void }) {
  const workers = project.currentWorkers ?? [];
  const plant = project.currentPlant ?? [];
  const reports = project.dailyReports ?? [];
  const actuals = project.productionActuals ?? [];
  const dockets = project.dockets ?? [];
  const subProjects = project.subProjects ?? [];

  return (
    <aside className="card" style={{ alignSelf: "start", position: "sticky", top: 16 }}>
      <div className="card-header">
        <div>
          <h2>{project.code}</h2>
          <span className="hint">{project.name}</span>
        </div>
        {canEdit && (
          <button className="btn btn-primary btn-sm" onClick={onResources}>
            Resources
          </button>
        )}
      </div>
      <div className="card-pad stack" style={{ gap: 18 }}>
        {project.parentProject && (
          <div>
            <b>Parent project</b>
            <p className="tiny">{project.parentProject.code} · {project.parentProject.name}</p>
          </div>
        )}

        <div>
          <div className="row-between">
            <b>Workers at this site</b>
            <span className="badge no-dot">{workers.length}</span>
          </div>
          {workers.length === 0 ? (
            <p className="tiny muted">No workers assigned yet.</p>
          ) : (
            <div className="stack" style={{ gap: 8, marginTop: 8 }}>
              {workers.slice(0, 8).map((worker) => (
                <div className="row-between" key={worker.id}>
                  <span className="tiny"><b>{worker.firstName} {worker.lastName}</b>{worker.classification ? ` · ${worker.classification}` : ""}</span>
                  <span className="tiny">{daysOnSite(worker.currentProjectAssignedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="row-between">
            <b>Plant at this site</b>
            <span className="badge no-dot">{plant.length}</span>
          </div>
          {plant.length === 0 ? (
            <p className="tiny muted">No plant assigned yet.</p>
          ) : (
            <div className="stack" style={{ gap: 8, marginTop: 8 }}>
              {plant.slice(0, 8).map((item) => (
                <div className="row-between" key={item.id}>
                  <span className="tiny"><b>{item.assetNumber}</b> · {item.type}</span>
                  <span className="tiny">{daysOnSite(item.currentProjectAssignedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <b>Recent progress reports</b>
          {reports.length === 0 ? (
            <p className="tiny muted">No daily reports yet.</p>
          ) : (
            <div className="stack" style={{ gap: 8, marginTop: 8 }}>
              {reports.slice(0, 5).map((report) => (
                <div className="row-between" key={report.id}>
                  <span className="tiny">{formatDate(report.reportDate)}</span>
                  <StatusBadge status={report.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <b>Production progress</b>
          {actuals.length === 0 ? (
            <p className="tiny muted">No captured quantities yet.</p>
          ) : (
            <div className="stack" style={{ gap: 8, marginTop: 8 }}>
              {actuals.slice(0, 5).map((actual) => (
                <div className="row-between" key={actual.id}>
                  <span className="tiny">{actual.activity}</span>
                  <span className="tiny">{Number(actual.quantity).toLocaleString()} {actual.unit}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <b>Dockets</b>
          {dockets.length === 0 ? (
            <p className="tiny muted">No dayworks or schedule-of-rates dockets yet.</p>
          ) : (
            <div className="stack" style={{ gap: 8, marginTop: 8 }}>
              {dockets.slice(0, 5).map((docket) => (
                <div key={docket.id}>
                  <div className="row-between">
                    <span className="tiny"><b>{docket.docketType === "SCHEDULE_OF_RATES" ? "SOR" : "Dayworks"}</b> · {formatDate(docket.docketDate)}</span>
                    <span className="tiny">{canEdit ? formatCurrency(docket.totalAmount) : docket.lines.map((line) => `${line.quantity} ${line.unit}`).join(", ")}</span>
                  </div>
                  {docket.description && <div className="tiny muted">{docket.description}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <b>Sub-projects</b>
          {subProjects.length === 0 ? (
            <p className="tiny muted">No sub-projects linked.</p>
          ) : (
            <div className="stack" style={{ gap: 8, marginTop: 8 }}>
              {subProjects.map((subProject) => (
                <div className="row-between" key={subProject.id}>
                  <span className="tiny"><b>{subProject.code}</b> · {subProject.name}</span>
                  <StatusBadge status={subProject.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

export function ProjectsPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole(...PROJECT_LEADERS);
  const { data, loading, error } = useApiQuery<Project[]>("/api/v1/projects");
  const [creating, setCreating] = useState(false);
  const [statusFor, setStatusFor] = useState<Project | null>(null);
  const [resourcesFor, setResourcesFor] = useState<Project | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [filter, setFilter] = useState("");

  const projects = (data ?? []).filter(
    (project) =>
      !filter ||
      project.code.toLowerCase().includes(filter.toLowerCase()) ||
      project.name.toLowerCase().includes(filter.toLowerCase()) ||
      (project.clientName ?? "").toLowerCase().includes(filter.toLowerCase()),
  );
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;

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
        <div className="project-board">
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
                  <th>Resources</th>
                  <th>Status</th>
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr
                    key={project.id}
                    className="clickable-row"
                    onClick={() => setSelectedProjectId(project.id)}
                    style={selectedProject?.id === project.id ? { outline: "1px solid var(--accent)", outlineOffset: -1 } : undefined}
                  >
                    <td className="mono">{project.code}</td>
                    <td>
                      <b>{project.name}</b>
                      {project.address && <div className="tiny">{project.address}</div>}
                      {project.parentProject && <div className="tiny">Under {project.parentProject.code}</div>}
                    </td>
                    <td>{project.clientName ?? "—"}</td>
                    <td>{project.jurisdiction}</td>
                    <td className="num">{formatCurrency(project.contractValue)}</td>
                    <td className="tiny">
                      {formatDate(project.startDate)} → {formatDate(project.endDate)}
                    </td>
                    <td className="tiny">
                      <span className="badge no-dot">{project.currentWorkers?.length ?? 0} workers</span>{" "}
                      <span className="badge no-dot">{project.currentPlant?.length ?? 0} plant</span>
                    </td>
                    <td>
                      <StatusBadge status={project.status} />
                    </td>
                    {canEdit && (
                      <td onClick={(event) => event.stopPropagation()}>
                        <div className="row" style={{ gap: 6, flexWrap: "nowrap", justifyContent: "flex-end" }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setResourcesFor(project)}>
                            Resources
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setStatusFor(project)}>
                            Move
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selectedProject && (
            <ProjectDetailPanel project={selectedProject} canEdit={canEdit} onResources={() => setResourcesFor(selectedProject)} />
          )}
        </div>
      )}

      {creating && <CreateProjectModal onClose={() => setCreating(false)} />}
      {statusFor && <StatusModal project={statusFor} onClose={() => setStatusFor(null)} />}
      {resourcesFor && <ResourcesModal project={resourcesFor} onClose={() => setResourcesFor(null)} />}
    </Layout>
  );
}
