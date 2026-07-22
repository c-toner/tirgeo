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
  TextArea,
  TextInput,
  useToast,
} from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { formatDateTime, titleCase, todayInput } from "../../lib/format.ts";
import { rememberRecent, listRecents } from "../../lib/recents.ts";
import type { Incident, SafetyObservation } from "../../lib/types.ts";
import { useApiQuery, useMutation } from "../../lib/useApi.ts";
import { usePath } from "../../lib/router.tsx";

const OBSERVATION_TYPES = ["HAZARD", "NEAR_MISS", "UNSAFE_ACT", "POSITIVE_BEHAVIOUR", "ENVIRONMENTAL", "QUALITY"];
const RISKS = ["LOW", "MEDIUM", "HIGH", "EXTREME"];
const INCIDENT_TYPES = ["INJURY", "NEAR_MISS", "PROPERTY_DAMAGE", "ENVIRONMENTAL", "PLANT", "PUBLIC", "OTHER"];

function ObservationModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    projectId: "",
    type: "HAZARD",
    title: "",
    description: "",
    location: "",
    riskLevel: "",
    immediateAction: "",
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const mutation = useMutation(
    () =>
      api<SafetyObservation>("/api/v1/safety/observations", {
        method: "POST",
        body: {
          projectId: form.projectId,
          type: form.type,
          title: form.title.trim(),
          description: form.description.trim(),
          location: form.location.trim() || undefined,
          riskLevel: form.riskLevel || undefined,
          immediateAction: form.immediateAction.trim() || undefined,
        },
      }),
    ["/api/v1/safety/observations", "/api/v1/safety/dashboard"],
  );
  return (
    <Modal
      title="Report observation"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || !form.projectId || form.title.trim().length < 3 || form.description.trim().length < 3}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push("Observation reported — thank you");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Sending…" : "Report"}
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
          <Select value={form.type} onChange={set("type")} options={OBSERVATION_TYPES} />
        </Field>
        <Field label="Title" required span2 error={mutation.fieldErrors["title"]}>
          <TextInput value={form.title} onChange={set("title")} placeholder="What did you see?" />
        </Field>
        <Field label="Description" required span2 error={mutation.fieldErrors["description"]}>
          <TextArea value={form.description} onChange={set("description")} />
        </Field>
        <Field label="Location">
          <TextInput value={form.location} onChange={set("location")} />
        </Field>
        <Field label="Risk level">
          <Select value={form.riskLevel} onChange={set("riskLevel")} allowEmpty emptyLabel="Unrated" options={RISKS} />
        </Field>
        <Field label="Immediate action taken" span2>
          <TextArea value={form.immediateAction} onChange={set("immediateAction")} rows={2} placeholder="e.g. Stopped work and reset exclusion zone" />
        </Field>
      </div>
    </Modal>
  );
}

function IncidentModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    projectId: "",
    occurredAt: todayInput(),
    occurredTime: new Date().toTimeString().slice(0, 5),
    type: "INJURY",
    severity: "MEDIUM",
    description: "",
    immediateActions: "",
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const mutation = useMutation(
    () =>
      api<Incident>("/api/v1/safety/incidents", {
        method: "POST",
        body: {
          projectId: form.projectId,
          occurredAt: new Date(`${form.occurredAt}T${form.occurredTime || "00:00"}`).toISOString(),
          type: form.type,
          severity: form.severity,
          description: form.description.trim(),
          immediateActions: form.immediateActions.trim() || undefined,
        },
      }),
    ["/api/v1/safety/dashboard"],
  );
  return (
    <Modal
      title="Report incident"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            disabled={mutation.running || !form.projectId || !form.description.trim()}
            onClick={() =>
              mutation.run({
                onSuccess: (incident) => {
                  rememberRecent("incidents", {
                    id: incident.id,
                    label: `${titleCase(form.type)} — ${form.description.slice(0, 60)}`,
                    sublabel: formatDateTime(incident.occurredAt),
                    status: form.severity,
                  });
                  toast.push("Incident recorded. Follow your notification procedure for serious events.");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Recording…" : "Record incident"}
          </button>
        </>
      }
    >
      <div className="alert alert-warning">
        <Icon name="alert" size={16} />
        <span>
          TirGeo stores the evidence — it does not assess notifiability. Serious incidents may require immediate
          regulator notification under your state's WHS law.
        </span>
      </div>
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <div className="form-grid">
        <Field label="Project" required error={mutation.fieldErrors["projectId"]}>
          <ProjectSelect value={form.projectId} onChange={set("projectId")} allowEmpty emptyLabel="— Select project —" activeOnly />
        </Field>
        <Field label="Incident type" required>
          <Select value={form.type} onChange={set("type")} options={INCIDENT_TYPES} />
        </Field>
        <Field label="Date" required>
          <TextInput value={form.occurredAt} onChange={set("occurredAt")} type="date" />
        </Field>
        <Field label="Time" required>
          <TextInput value={form.occurredTime} onChange={set("occurredTime")} type="time" />
        </Field>
        <Field label="Severity" required>
          <Select value={form.severity} onChange={set("severity")} options={RISKS} />
        </Field>
        <Field label="What happened" required span2 error={mutation.fieldErrors["description"]}>
          <TextArea value={form.description} onChange={set("description")} rows={4} />
        </Field>
        <Field label="Immediate actions taken" span2>
          <TextArea value={form.immediateActions} onChange={set("immediateActions")} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

export function ObservationsPage() {
  const path = usePath();
  const [tab, setTab] = useState(path.includes("tab=incidents") ? "incidents" : "observations");
  const [projectId, setProjectId] = useState("");
  const [type, setType] = useState("");
  const { data, loading, error } = useApiQuery<SafetyObservation[]>(tab === "observations" ? "/api/v1/safety/observations" : null, {
    projectId: projectId || undefined,
    type: type || undefined,
  });
  const [reporting, setReporting] = useState(false);
  const [reportingIncident, setReportingIncident] = useState(false);
  const [viewingObservation, setViewingObservation] = useState<SafetyObservation | null>(null);
  const recentIncidents = listRecents("incidents");

  return (
    <Layout
      title="Observations & incidents"
      actions={
        <div className="row">
          <button className="btn btn-ghost" onClick={() => setReportingIncident(true)}>
            <Icon name="alert" size={15} /> Incident
          </button>
          <button className="btn btn-primary" onClick={() => setReporting(true)}>
            <Icon name="plus" size={15} /> Observation
          </button>
        </div>
      }
    >
      <div className="tabs">
        <button className={"tab" + (tab === "observations" ? " active" : "")} onClick={() => setTab("observations")}>
          Observations
        </button>
        <button className={"tab" + (tab === "incidents" ? " active" : "")} onClick={() => setTab("incidents")}>
          Incidents
        </button>
      </div>

      {tab === "observations" && (
        <>
          <div className="filter-row">
            <ProjectSelect value={projectId} onChange={setProjectId} allowEmpty />
            <Select value={type} onChange={setType} allowEmpty emptyLabel="Any type" options={OBSERVATION_TYPES} />
          </div>
          <ErrorAlert error={error} />
          {loading && !data && <Loading />}
          {data && data.length === 0 && (
            <div className="card">
              <EmptyState
                title="No observations recorded"
                hint="Everyone on site can raise observations — hazards, near misses, unsafe acts and positive behaviour."
                action={
                  <button className="btn btn-primary" onClick={() => setReporting(true)}>
                    <Icon name="plus" size={15} /> Report observation
                  </button>
                }
              />
            </div>
          )}
          {data && data.length > 0 && (
            <div className="card table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Observation</th>
                    <th>Project</th>
                    <th>Type</th>
                    <th>Risk</th>
                    <th>Observed</th>
                    <th className="num">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((observation) => (
                    <ObservationRow key={observation.id} observation={observation} onOpen={() => setViewingObservation(observation)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "incidents" && (
        <>
          <div className="alert alert-info">
            The API records incidents but does not list them yet — this device keeps a local index of incidents
            reported from this browser. Counts for all incidents appear on the dashboard.
          </div>
          {recentIncidents.length === 0 ? (
            <div className="card">
              <EmptyState
                title="No incidents reported from this device"
                action={
                  <button className="btn btn-danger" onClick={() => setReportingIncident(true)}>
                    <Icon name="alert" size={15} /> Report incident
                  </button>
                }
              />
            </div>
          ) : (
            <div className="card table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Incident</th>
                    <th>Occurred</th>
                    <th>Severity</th>
                    <th>ID</th>
                  </tr>
                </thead>
                <tbody>
                  {recentIncidents.map((incident) => (
                    <tr key={incident.id}>
                      <td>
                        <b>{incident.label}</b>
                      </td>
                      <td className="tiny">{incident.sublabel}</td>
                      <td>
                        <RiskBadge level={(incident.status as never) ?? null} />
                      </td>
                      <td className="mono tiny">{incident.id.slice(0, 8)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {reporting && <ObservationModal onClose={() => setReporting(false)} />}
      {reportingIncident && <IncidentModal onClose={() => setReportingIncident(false)} />}
      {viewingObservation && <ObservationDetailModal observation={viewingObservation} onClose={() => setViewingObservation(null)} />}
    </Layout>
  );
}

function ObservationDetailModal({ observation, onClose }: { observation: SafetyObservation; onClose: () => void }) {
  const projectName = useProjectName(observation.projectId);
  return (
    <Modal title="Observation details" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Close</button>}>
      <div className="stack">
        <div className="summary-grid">
          <div className="summary-item">
            <span>Project</span>
            <b>{projectName}</b>
          </div>
          <div className="summary-item">
            <span>Type</span>
            <b>{titleCase(observation.type)}</b>
          </div>
          <div className="summary-item">
            <span>Risk</span>
            <b><RiskBadge level={observation.riskLevel ?? null} /></b>
          </div>
          <div className="summary-item">
            <span>Observed</span>
            <b>{formatDateTime(observation.observedAt)}</b>
          </div>
        </div>
        <section className="summary-section">
          <h3>{observation.title}</h3>
          <p className="muted">{observation.description || "No description recorded."}</p>
        </section>
        {observation.immediateAction && (
          <section className="summary-section">
            <h3>Immediate action</h3>
            <p className="muted">{observation.immediateAction}</p>
          </section>
        )}
      </div>
    </Modal>
  );
}

function ObservationRow({ observation, onOpen }: { observation: SafetyObservation; onOpen: () => void }) {
  const projectName = useProjectName(observation.projectId);
  return (
    <tr
      className="clickable-row"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Open observation details for ${observation.title}`}
    >
      <td>
        <b>{observation.title}</b>
        <div className="tiny">{observation.description}</div>
        {observation.immediateAction && <div className="tiny">Immediate action: {observation.immediateAction}</div>}
      </td>
      <td className="mono tiny">{projectName}</td>
      <td>
        <span className="badge no-dot">{titleCase(observation.type)}</span>
      </td>
      <td>
        <RiskBadge level={observation.riskLevel ?? null} />
      </td>
      <td className="tiny">{formatDateTime(observation.observedAt)}</td>
      <td className="num">{observation.correctiveActions?.length ?? 0}</td>
    </tr>
  );
}
