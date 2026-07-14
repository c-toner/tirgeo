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
import { api } from "../../lib/api.ts";
import { HSEQ_EDITORS, HSEQ_VERIFIERS, useAuth } from "../../lib/auth.tsx";
import { formatDate, isOverdue, titleCase } from "../../lib/format.ts";
import type { ControlMeasure, ControlType, Hazard } from "../../lib/types.ts";
import { useApiQuery, useMutation } from "../../lib/useApi.ts";
import { usePath } from "../../lib/router.tsx";

const DOMAINS = ["HEALTH", "SAFETY", "ENVIRONMENT", "QUALITY"];
const RISKS = ["LOW", "MEDIUM", "HIGH", "EXTREME"];
const HAZARD_STATUSES = ["IDENTIFIED", "ASSESSED", "CONTROLLED", "CLOSED"];
const CONTROL_TYPES: ControlType[] = ["ELIMINATION", "SUBSTITUTION", "ISOLATION", "ENGINEERING", "ADMINISTRATIVE", "PPE"];

interface DraftControl {
  type: ControlType;
  title: string;
  description: string;
  verificationMethod: string;
}

function CreateHazardModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    projectId: "",
    title: "",
    description: "",
    domain: "SAFETY",
    activity: "",
    location: "",
    riskLevel: "MEDIUM",
    residualRiskLevel: "",
    reviewDueAt: "",
  });
  const [controls, setControls] = useState<DraftControl[]>([]);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const mutation = useMutation(
    () =>
      api<Hazard>("/api/v1/safety/hazards", {
        method: "POST",
        body: {
          projectId: form.projectId,
          title: form.title.trim(),
          description: form.description.trim(),
          domain: form.domain,
          activity: form.activity.trim() || undefined,
          location: form.location.trim() || undefined,
          riskLevel: form.riskLevel,
          residualRiskLevel: form.residualRiskLevel || undefined,
          reviewDueAt: form.reviewDueAt ? new Date(form.reviewDueAt).toISOString() : undefined,
          controls: controls.length
            ? controls.map((control) => ({
                type: control.type,
                title: control.title.trim(),
                description: control.description.trim(),
                verificationMethod: control.verificationMethod.trim() || undefined,
              }))
            : undefined,
        },
      }),
    ["/api/v1/safety/hazards", "/api/v1/safety/controls", "/api/v1/safety/dashboard"],
  );

  const addControl = () =>
    setControls((list) => [...list, { type: "ENGINEERING", title: "", description: "", verificationMethod: "" }]);

  const controlsValid = controls.every((c) => c.title.trim().length >= 2 && c.description.trim().length >= 2);

  return (
    <Modal
      title="Register hazard"
      large
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || !form.projectId || form.title.trim().length < 3 || form.description.trim().length < 3 || !controlsValid}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push("Hazard registered");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Saving…" : "Register hazard"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <div className="form-grid">
        <Field label="Project" required error={mutation.fieldErrors["projectId"]}>
          <ProjectSelect value={form.projectId} onChange={set("projectId")} allowEmpty emptyLabel="— Select project —" activeOnly />
        </Field>
        <Field label="Domain" required>
          <Select value={form.domain} onChange={set("domain")} options={DOMAINS} />
        </Field>
        <Field label="Hazard title" required span2 error={mutation.fieldErrors["title"]}>
          <TextInput value={form.title} onChange={set("title")} placeholder="e.g. Live services in excavation zone" />
        </Field>
        <Field label="Description" required span2 error={mutation.fieldErrors["description"]}>
          <TextArea value={form.description} onChange={set("description")} />
        </Field>
        <Field label="Activity">
          <TextInput value={form.activity} onChange={set("activity")} placeholder="e.g. Trenching" />
        </Field>
        <Field label="Location">
          <TextInput value={form.location} onChange={set("location")} placeholder="e.g. Chainage 120–180" />
        </Field>
        <Field label="Initial risk" required>
          <Select value={form.riskLevel} onChange={set("riskLevel")} options={RISKS} />
        </Field>
        <Field label="Residual risk (after controls)">
          <Select value={form.residualRiskLevel} onChange={set("residualRiskLevel")} allowEmpty emptyLabel="Not assessed yet" options={RISKS} />
        </Field>
        <Field label="Review due" span2>
          <TextInput value={form.reviewDueAt} onChange={set("reviewDueAt")} type="date" />
        </Field>
      </div>

      <div className="row-between">
        <h3>Controls (hierarchy of controls)</h3>
        <button className="btn btn-ghost btn-sm" onClick={addControl}>
          <Icon name="plus" size={13} /> Add control
        </button>
      </div>
      {controls.length === 0 && <p className="muted">Optional now — controls can also be added after assessment.</p>}
      {controls.map((control, index) => (
        <div key={index} className="card card-pad stack" style={{ boxShadow: "none" }}>
          <div className="form-grid">
            <Field label="Control type" required>
              <Select
                value={control.type}
                onChange={(value) => setControls((list) => list.map((c, i) => (i === index ? { ...c, type: value as ControlType } : c)))}
                options={CONTROL_TYPES}
              />
            </Field>
            <Field label="Title" required>
              <TextInput value={control.title} onChange={(value) => setControls((list) => list.map((c, i) => (i === index ? { ...c, title: value } : c)))} />
            </Field>
            <Field label="Description" required span2>
              <TextArea value={control.description} rows={2} onChange={(value) => setControls((list) => list.map((c, i) => (i === index ? { ...c, description: value } : c)))} />
            </Field>
            <Field label="Verification method" span2>
              <TextInput
                value={control.verificationMethod}
                onChange={(value) => setControls((list) => list.map((c, i) => (i === index ? { ...c, verificationMethod: value } : c)))}
                placeholder="e.g. Supervisor inspection"
              />
            </Field>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-end" }} onClick={() => setControls((list) => list.filter((_, i) => i !== index))}>
            Remove
          </button>
        </div>
      ))}
    </Modal>
  );
}

function HazardStatusModal({ hazard, onClose }: { hazard: Hazard; onClose: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<string>(hazard.status);
  const [residual, setResidual] = useState(hazard.residualRiskLevel ?? "");
  const [reviewDueAt, setReviewDueAt] = useState("");
  const mutation = useMutation(
    () =>
      api(`/api/v1/safety/hazards/${hazard.id}/status`, {
        method: "PATCH",
        body: {
          status,
          residualRiskLevel: residual || undefined,
          reviewDueAt: reviewDueAt ? new Date(reviewDueAt).toISOString() : undefined,
        },
      }),
    ["/api/v1/safety/hazards", "/api/v1/safety/dashboard"],
  );
  return (
    <Modal
      title={`Update — ${hazard.title}`}
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
                  toast.push("Hazard updated");
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
      <Field label="Status">
        <Select value={status} onChange={setStatus} options={HAZARD_STATUSES} />
      </Field>
      <Field label="Residual risk">
        <Select value={residual} onChange={setResidual} allowEmpty emptyLabel="Unchanged" options={RISKS} />
      </Field>
      <Field label="Next review due">
        <TextInput value={reviewDueAt} onChange={setReviewDueAt} type="date" />
      </Field>
    </Modal>
  );
}

function AddControlModal({ hazard, onClose }: { hazard: Hazard; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ type: "ENGINEERING", title: "", description: "", verificationMethod: "", reviewDueAt: "" });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const mutation = useMutation(
    () =>
      api(`/api/v1/safety/hazards/${hazard.id}/controls`, {
        method: "POST",
        body: {
          type: form.type,
          title: form.title.trim(),
          description: form.description.trim(),
          verificationMethod: form.verificationMethod.trim() || undefined,
          reviewDueAt: form.reviewDueAt ? new Date(form.reviewDueAt).toISOString() : undefined,
        },
      }),
    ["/api/v1/safety/hazards", "/api/v1/safety/controls"],
  );
  return (
    <Modal
      title={`Add control — ${hazard.title}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || form.title.trim().length < 2 || form.description.trim().length < 2}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push("Control added");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Saving…" : "Add control"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <Field label="Control type" required>
        <Select value={form.type} onChange={set("type")} options={CONTROL_TYPES} />
      </Field>
      <Field label="Title" required>
        <TextInput value={form.title} onChange={set("title")} />
      </Field>
      <Field label="Description" required>
        <TextArea value={form.description} onChange={set("description")} />
      </Field>
      <Field label="Verification method">
        <TextInput value={form.verificationMethod} onChange={set("verificationMethod")} />
      </Field>
      <Field label="Review due">
        <TextInput value={form.reviewDueAt} onChange={set("reviewDueAt")} type="date" />
      </Field>
    </Modal>
  );
}

function VerifyControlModal({ control, onClose }: { control: ControlMeasure; onClose: () => void }) {
  const toast = useToast();
  const [effectiveness, setEffectiveness] = useState("");
  const [reviewDueAt, setReviewDueAt] = useState("");
  const mutation = useMutation(
    () =>
      api(`/api/v1/safety/controls/${control.id}/verify`, {
        method: "PATCH",
        body: {
          effectiveness: effectiveness.trim() || undefined,
          reviewDueAt: reviewDueAt ? new Date(reviewDueAt).toISOString() : undefined,
        },
      }),
    ["/api/v1/safety/controls", "/api/v1/safety/hazards", "/api/v1/safety/dashboard"],
  );
  return (
    <Modal
      title={`Verify — ${control.title}`}
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
                  toast.push("Control verified");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Saving…" : "Mark verified"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <Field label="Effectiveness notes">
        <TextArea value={effectiveness} onChange={setEffectiveness} placeholder="What was checked and what evidence supports it?" />
      </Field>
      <Field label="Next review due">
        <TextInput value={reviewDueAt} onChange={setReviewDueAt} type="date" />
      </Field>
    </Modal>
  );
}

function HazardRow({ hazard, canEdit, onStatus, onAddControl }: { hazard: Hazard; canEdit: boolean; onStatus: () => void; onAddControl: () => void }) {
  const projectName = useProjectName(hazard.projectId);
  return (
    <tr>
      <td>
        <b>{hazard.title}</b>
        <div className="tiny">
          {titleCase(hazard.domain)}
          {hazard.activity ? ` · ${hazard.activity}` : ""}
          {hazard.location ? ` · ${hazard.location}` : ""}
        </div>
      </td>
      <td className="mono tiny">{projectName}</td>
      <td>
        <RiskBadge level={hazard.riskLevel} />
      </td>
      <td>
        <RiskBadge level={hazard.residualRiskLevel ?? null} />
      </td>
      <td>
        <StatusBadge status={hazard.status} />
      </td>
      <td className="num">{hazard.controls?.length ?? 0}</td>
      <td className={"tiny" + (isOverdue(hazard.reviewDueAt) ? " field-error" : "")}>{formatDate(hazard.reviewDueAt)}</td>
      {canEdit && (
        <td>
          <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
            <button className="btn btn-ghost btn-sm" onClick={onStatus}>
              Update
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onAddControl}>
              + Control
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

export function HazardsPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole(...HSEQ_EDITORS);
  const canVerify = hasRole(...HSEQ_VERIFIERS);
  const path = usePath();
  const [tab, setTab] = useState(path.includes("tab=controls") ? "controls" : "hazards");

  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState("");
  const [domain, setDomain] = useState("");
  const [risk, setRisk] = useState("");
  const [dueOnly, setDueOnly] = useState(false);

  const hazardsQuery = useApiQuery<Hazard[]>(tab === "hazards" ? "/api/v1/safety/hazards" : null, {
    projectId: projectId || undefined,
    status: status || undefined,
    domain: domain || undefined,
    riskLevel: risk || undefined,
  });
  const controlsQuery = useApiQuery<ControlMeasure[]>(tab === "controls" ? "/api/v1/safety/controls" : null, {
    projectId: projectId || undefined,
    dueOnly: dueOnly || undefined,
  });

  const [creating, setCreating] = useState(false);
  const [statusFor, setStatusFor] = useState<Hazard | null>(null);
  const [controlFor, setControlFor] = useState<Hazard | null>(null);
  const [verifying, setVerifying] = useState<ControlMeasure | null>(null);

  return (
    <Layout
      title="Hazard register"
      actions={
        canEdit ? (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} /> Register hazard
          </button>
        ) : undefined
      }
    >
      <div className="tabs">
        <button className={"tab" + (tab === "hazards" ? " active" : "")} onClick={() => setTab("hazards")}>
          Hazards
        </button>
        <button className={"tab" + (tab === "controls" ? " active" : "")} onClick={() => setTab("controls")}>
          Control verification
        </button>
      </div>

      <div className="filter-row">
        <ProjectSelect value={projectId} onChange={setProjectId} allowEmpty />
        {tab === "hazards" && (
          <>
            <Select value={status} onChange={setStatus} allowEmpty emptyLabel="Any status" options={HAZARD_STATUSES} />
            <Select value={domain} onChange={setDomain} allowEmpty emptyLabel="Any domain" options={DOMAINS} />
            <Select value={risk} onChange={setRisk} allowEmpty emptyLabel="Any risk" options={RISKS} />
          </>
        )}
        {tab === "controls" && (
          <label className="row" style={{ gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={dueOnly} onChange={(e: { target: { checked: boolean } }) => setDueOnly(e.target.checked)} />
            Due or overdue only
          </label>
        )}
        {canEdit && tab === "hazards" && (
          <button className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }} onClick={() => setCreating(true)}>
            <Icon name="plus" size={13} /> New
          </button>
        )}
      </div>

      {tab === "hazards" && (
        <>
          <ErrorAlert error={hazardsQuery.error} />
          {hazardsQuery.loading && !hazardsQuery.data && <Loading />}
          {hazardsQuery.data && hazardsQuery.data.length === 0 && (
            <div className="card">
              <EmptyState title="No hazards on the register" hint="Hazards raised from observations or risk workshops appear here with their controls." />
            </div>
          )}
          {hazardsQuery.data && hazardsQuery.data.length > 0 && (
            <div className="card table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Hazard</th>
                    <th>Project</th>
                    <th>Initial risk</th>
                    <th>Residual</th>
                    <th>Status</th>
                    <th className="num">Controls</th>
                    <th>Review due</th>
                    {canEdit && <th />}
                  </tr>
                </thead>
                <tbody>
                  {hazardsQuery.data.map((hazard) => (
                    <HazardRow
                      key={hazard.id}
                      hazard={hazard}
                      canEdit={canEdit}
                      onStatus={() => setStatusFor(hazard)}
                      onAddControl={() => setControlFor(hazard)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "controls" && (
        <>
          <ErrorAlert error={controlsQuery.error} />
          {controlsQuery.loading && !controlsQuery.data && <Loading />}
          {controlsQuery.data && controlsQuery.data.length === 0 && (
            <div className="card">
              <EmptyState title="No controls found" hint="Controls created under hazards appear here for verification." />
            </div>
          )}
          {controlsQuery.data && controlsQuery.data.length > 0 && (
            <div className="card table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Control</th>
                    <th>Hazard</th>
                    <th>Type</th>
                    <th>Review due</th>
                    <th>Verified</th>
                    {canVerify && <th />}
                  </tr>
                </thead>
                <tbody>
                  {controlsQuery.data.map((control) => (
                    <tr key={control.id}>
                      <td>
                        <b>{control.title}</b>
                        <div className="tiny">{control.description}</div>
                      </td>
                      <td className="tiny">{control.hazard?.title ?? "—"}</td>
                      <td>
                        <span className="badge no-dot">{titleCase(control.type)}</span>
                      </td>
                      <td className={"tiny" + (isOverdue(control.reviewDueAt) && !control.verifiedAt ? " field-error" : "")}>
                        {formatDate(control.reviewDueAt)}
                      </td>
                      <td>
                        {control.verifiedAt ? (
                          <span className="badge badge-good">Verified {formatDate(control.verifiedAt)}</span>
                        ) : (
                          <span className="badge badge-warning">Unverified</span>
                        )}
                      </td>
                      {canVerify && (
                        <td>
                          <button className="btn btn-ghost btn-sm" onClick={() => setVerifying(control)}>
                            Verify
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {creating && <CreateHazardModal onClose={() => setCreating(false)} />}
      {statusFor && <HazardStatusModal hazard={statusFor} onClose={() => setStatusFor(null)} />}
      {controlFor && <AddControlModal hazard={controlFor} onClose={() => setControlFor(null)} />}
      {verifying && <VerifyControlModal control={verifying} onClose={() => setVerifying(null)} />}
    </Layout>
  );
}
