import { useMemo, useState } from "react";
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
  StatusBadge,
  TextArea,
  TextInput,
  useToast,
} from "../../components/ui.tsx";
import { SignaturePad } from "../../components/SignaturePad.tsx";
import type { SignatureValue } from "../../components/SignaturePad.tsx";
import { WorkerSelect } from "../../components/WorkerSelect.tsx";
import { api } from "../../lib/api.ts";
import { PLANT_CLEARERS, PROJECT_LEADERS, TEMPLATE_ADMINS, useAuth } from "../../lib/auth.tsx";
import { formatDate, titleCase } from "../../lib/format.ts";
import { Link } from "../../lib/router.tsx";
import type { InspectionResult, Plant, PreStartDefect, PreStartTemplate } from "../../lib/types.ts";
import { useApiQuery, useMutation } from "../../lib/useApi.ts";

const DEFECT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

function CreatePlantModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ assetNumber: "", type: "", make: "", model: "", registration: "", nextServiceAt: "" });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const mutation = useMutation(
    () =>
      api<Plant>("/api/v1/plant", {
        method: "POST",
        body: {
          assetNumber: form.assetNumber.trim(),
          type: form.type.trim(),
          make: form.make.trim() || undefined,
          model: form.model.trim() || undefined,
          registration: form.registration.trim() || undefined,
          nextServiceAt: form.nextServiceAt ? new Date(form.nextServiceAt).toISOString() : undefined,
        },
      }),
    ["/api/v1/plant"],
  );
  return (
    <Modal
      title="Add plant asset"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || !form.assetNumber.trim() || !form.type.trim()}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push("Plant asset added");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Adding…" : "Add asset"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <div className="form-grid">
        <Field label="Asset number" required>
          <TextInput value={form.assetNumber} onChange={set("assetNumber")} placeholder="e.g. EX-07" mono />
        </Field>
        <Field label="Plant type" required hint="Matched against pre-start templates (e.g. Excavator, Roller).">
          <TextInput value={form.type} onChange={set("type")} placeholder="Excavator" />
        </Field>
        <Field label="Make">
          <TextInput value={form.make} onChange={set("make")} />
        </Field>
        <Field label="Model">
          <TextInput value={form.model} onChange={set("model")} />
        </Field>
        <Field label="Registration">
          <TextInput value={form.registration} onChange={set("registration")} />
        </Field>
        <Field label="Next service due">
          <TextInput value={form.nextServiceAt} onChange={set("nextServiceAt")} type="date" />
        </Field>
      </div>
    </Modal>
  );
}

function PreStartModal({ plant, onClose }: { plant: Plant; onClose: () => void }) {
  const toast = useToast();
  const { data: templates, loading } = useApiQuery<PreStartTemplate[]>("/api/v1/plant/pre-start-templates", {
    plantType: plant.type,
  });
  const [templateId, setTemplateId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [hourMeter, setHourMeter] = useState("");
  const [answers, setAnswers] = useState<Record<string, boolean | string | number | null>>({});
  const [defects, setDefects] = useState<Record<string, PreStartDefect>>({});
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [signedName, setSignedName] = useState("");

  const template = templates?.find((t) => t.id === templateId);

  // Which answered questions trigger a defect, per template defectOn rules.
  const triggering = useMemo(() => {
    if (!template) return [];
    return template.sections
      .flatMap((section) => section.questions)
      .filter((question) => question.defectOn.some((value) => value === answers[question.id]))
      .map((question) => question.id);
  }, [template, answers]);

  const missingRequired = useMemo(() => {
    if (!template) return [];
    return template.sections
      .flatMap((section) => section.questions)
      .filter((question) => question.required && (answers[question.id] === undefined || answers[question.id] === null || answers[question.id] === ""))
      .map((question) => question.id);
  }, [template, answers]);

  const lockedOut = answers["lockout-tagout"] === true;
  const result: InspectionResult = triggering.length === 0 ? "PASS" : lockedOut ? "OUT_OF_SERVICE" : "DEFECT";
  const missingDefectDetails = triggering.filter((id) => !defects[id]?.item?.trim() || !defects[id]?.detail?.trim());

  const setAnswer = (id: string, value: boolean | string | number | null) => setAnswers((a) => ({ ...a, [id]: value }));
  const patchDefect = (id: string, patch: Partial<PreStartDefect>) =>
    setDefects((d) => ({
      ...d,
      [id]: {
        ...(d[id] ?? { questionId: id, item: "", severity: "MEDIUM" as const, detail: "", photoIds: [] }),
        ...patch,
      },
    }));

  const mutation = useMutation(
    () =>
      api(`/api/v1/plant/${plant.id}/pre-starts`, {
        method: "POST",
        body: {
          workerId: workerId.trim(),
          projectId: projectId || undefined,
          inspectedAt: new Date().toISOString(),
          hourMeter: hourMeter ? Number(hourMeter) : undefined,
          checklistTemplateId: templateId,
          answers,
          result,
          defects: triggering.map((id) => defects[id]).filter(Boolean),
          signature: signature?.signature ?? "",
        },
      }),
    ["/api/v1/plant"],
  );

  const canSubmit =
    template &&
    workerId.trim() &&
    missingRequired.length === 0 &&
    missingDefectDetails.length === 0 &&
    signature &&
    !mutation.running &&
    (result !== "OUT_OF_SERVICE" || lockedOut);

  return (
    <Modal
      title={`Pre-start — ${plant.assetNumber} (${plant.type})`}
      large
      onClose={onClose}
      footer={
        <>
          <div className="row" style={{ marginRight: "auto", gap: 8 }}>
            <span className="muted">Result:</span>
            <span
              className={`badge ${result === "PASS" ? "badge-good" : result === "DEFECT" ? "badge-serious" : "badge-critical"}`}
            >
              {titleCase(result)}
            </span>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-accent"
            disabled={!canSubmit}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push(
                    result === "PASS"
                      ? "Pre-start passed — plant ready"
                      : result === "DEFECT"
                        ? "Defects recorded — plant flagged"
                        : "Plant locked out and taken out of service",
                  );
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Submitting…" : "Submit pre-start"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      {loading && <Loading />}
      {!loading && (templates?.length ?? 0) === 0 && (
        <div className="alert alert-warning">
          No published pre-start template covers plant type “{plant.type}”. An owner/administrator can publish one
          under <Link to="/plant/templates">Templates</Link>.
        </div>
      )}

      <div className="form-grid">
        <Field label="Checklist template" required>
          <Select
            value={templateId}
            onChange={(id) => {
              setTemplateId(id);
              setAnswers({});
              setDefects({});
            }}
            allowEmpty
            emptyLabel="— Select template —"
            options={(templates ?? []).map((t) => ({
              value: t.id,
              label: `${t.name} v${t.version}${t.plantType ? ` (${t.plantType})` : " (generic)"}`,
            }))}
          />
        </Field>
        <Field label="Worker" required hint="Your linked worker is selected by default.">
          <WorkerSelect value={workerId} onChange={setWorkerId} />
        </Field>
        <Field label="Project (optional)">
          <ProjectSelect value={projectId} onChange={setProjectId} allowEmpty emptyLabel="Not project-specific" activeOnly />
        </Field>
        <Field
          label={`Hour meter${plant.hourMeter !== null && plant.hourMeter !== undefined ? ` (last ${plant.hourMeter})` : ""}`}
          hint="Cannot move backwards."
        >
          <TextInput value={hourMeter} onChange={setHourMeter} type="number" min={0} inputMode="decimal" />
        </Field>
      </div>

      {template &&
        template.sections.map((section) => (
          <section key={section.id}>
            <h3 style={{ margin: "8px 0 2px" }}>{section.title}</h3>
            {section.questions.map((question) => {
              const value = answers[question.id];
              const isTriggering = triggering.includes(question.id);
              return (
                <div key={question.id} className="checklist-q">
                  <div className="row-between">
                    <div>
                      <b style={{ fontSize: 13.5 }}>
                        {question.label}
                        {question.required && <span style={{ color: "var(--critical)" }}> *</span>}
                      </b>
                      {question.guidance && <div className="tiny">{question.guidance}</div>}
                    </div>
                    {question.type === "PASS_FAIL_NA" && (
                      <div className="seg">
                        {(["PASS", "FAIL", "NA"] as const).map((option) => (
                          <button
                            key={option}
                            type="button"
                            className={value === option ? (option === "PASS" ? "on-pass" : option === "FAIL" ? "on-fail" : "on-na") : ""}
                            onClick={() => setAnswer(question.id, option)}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    )}
                    {question.type === "BOOLEAN" && (
                      <div className="seg">
                        <button type="button" className={value === true ? "on-fail" : ""} onClick={() => setAnswer(question.id, true)}>
                          Yes
                        </button>
                        <button type="button" className={value === false ? "on-pass" : ""} onClick={() => setAnswer(question.id, false)}>
                          No
                        </button>
                      </div>
                    )}
                  </div>
                  {question.type === "TEXT" && (
                    <TextArea value={typeof value === "string" ? value : ""} onChange={(text) => setAnswer(question.id, text || null)} rows={2} />
                  )}
                  {question.type === "NUMBER" && (
                    <TextInput
                      value={value === null || value === undefined ? "" : String(value)}
                      onChange={(text) => setAnswer(question.id, text === "" ? null : Number(text))}
                      type="number"
                    />
                  )}
                  {isTriggering && (
                    <div className="card card-pad stack" style={{ boxShadow: "none", borderColor: "var(--serious)", gap: 10 }}>
                      <b style={{ fontSize: 13 }}>Defect record required</b>
                      <div className="form-grid">
                        <Field label="Item" required>
                          <TextInput value={defects[question.id]?.item ?? ""} onChange={(text) => patchDefect(question.id, { item: text })} placeholder="e.g. Left track" />
                        </Field>
                        <Field label="Severity" required>
                          <Select
                            value={defects[question.id]?.severity ?? "MEDIUM"}
                            onChange={(severity) => patchDefect(question.id, { severity: severity as PreStartDefect["severity"] })}
                            options={DEFECT_SEVERITIES}
                          />
                        </Field>
                        <Field label="Detail" required span2>
                          <TextArea value={defects[question.id]?.detail ?? ""} onChange={(text) => patchDefect(question.id, { detail: text })} rows={2} />
                        </Field>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}

      {template && (
        <>
          {triggering.length > 0 && !lockedOut && (
            <div className="alert alert-warning">
              <Icon name="alert" size={16} />
              <span>
                Failed checks recorded. If the plant is unsafe to operate, isolate it and mark “Machine locked out or
                tagged out” — that records it out of service until an authorised clearance.
              </span>
            </div>
          )}
          <SignaturePad signedName={signedName} onNameChange={setSignedName} onChange={setSignature} nameLabel="Operator name" />
        </>
      )}
    </Modal>
  );
}

function ClearanceModal({ plant, onClose }: { plant: Plant; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const mutation = useMutation(
    () => api(`/api/v1/plant/${plant.id}/clearance`, { method: "POST", body: { reason: reason.trim() } }),
    ["/api/v1/plant"],
  );
  return (
    <Modal
      title={`Return to service — ${plant.assetNumber}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || reason.trim().length < 10}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push("Clearance recorded — plant available");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Recording…" : "Record clearance"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <div className="alert alert-warning">
        Only record a clearance once the defect has been rectified or assessed safe by an authorised person. The
        clearance is audited with your identity.
      </div>
      <Field label="Reason / rectification detail" required hint="Minimum 10 characters.">
        <TextArea value={reason} onChange={setReason} rows={4} placeholder="e.g. Hydraulic hose replaced by ABC Mechanical, pressure tested OK. Work order #1042." />
      </Field>
    </Modal>
  );
}

export function PlantPage() {
  const { hasRole } = useAuth();
  const canCreate = hasRole(...PROJECT_LEADERS);
  const canClear = hasRole(...PLANT_CLEARERS);
  const canManageTemplates = hasRole(...TEMPLATE_ADMINS);
  const { data, loading, error } = useApiQuery<Plant[]>("/api/v1/plant");
  const [creating, setCreating] = useState(false);
  const [preStartFor, setPreStartFor] = useState<Plant | null>(null);
  const [clearingFor, setClearingFor] = useState<Plant | null>(null);
  const [filter, setFilter] = useState("");

  const assets = (data ?? []).filter(
    (plant) =>
      !filter ||
      plant.assetNumber.toLowerCase().includes(filter.toLowerCase()) ||
      plant.type.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <Layout
      title="Plant & pre-starts"
      actions={
        <div className="row">
          {canManageTemplates && (
            <Link to="/plant/templates" className="btn btn-ghost">
              Templates
            </Link>
          )}
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={15} /> Add asset
            </button>
          )}
        </div>
      }
    >
      <div className="filter-row">
        <input className="input" style={{ maxWidth: 300 }} placeholder="Search asset number or type…" value={filter} onChange={(e: { target: { value: string } }) => setFilter(e.target.value)} />
        {canManageTemplates && (
          <Link to="/plant/templates" className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }}>
            Manage templates
          </Link>
        )}
      </div>

      <ErrorAlert error={error} />
      {loading && !data && <Loading />}
      {data && assets.length === 0 && (
        <div className="card">
          <EmptyState
            title={filter ? "No plant matches" : "No plant registered"}
            hint="Excavators, rollers, trucks and attachments — registered plant gets pre-start checklists and defect tracking."
            action={
              canCreate && !filter ? (
                <button className="btn btn-primary" onClick={() => setCreating(true)}>
                  <Icon name="plus" size={15} /> Add asset
                </button>
              ) : undefined
            }
          />
        </div>
      )}

      {assets.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Make / model</th>
                <th className="num">Hour meter</th>
                <th>Next service</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {assets.map((plant) => {
                const needsClearance = ["OUT_OF_SERVICE", "DEFECT_REPORTED"].includes(plant.status);
                return (
                  <tr key={plant.id}>
                    <td>
                      <b className="mono">{plant.assetNumber}</b>
                      <div className="tiny">{plant.type}</div>
                    </td>
                    <td className="tiny">
                      {[plant.make, plant.model].filter(Boolean).join(" ") || "—"}
                      {plant.registration ? ` · ${plant.registration}` : ""}
                    </td>
                    <td className="num">{plant.hourMeter ?? "—"}</td>
                    <td className="tiny">{formatDate(plant.nextServiceAt)}</td>
                    <td>
                      <StatusBadge status={plant.status} />
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: "nowrap", justifyContent: "flex-end" }}>
                        {!needsClearance && (
                          <button className="btn btn-accent btn-sm" onClick={() => setPreStartFor(plant)}>
                            Pre-start
                          </button>
                        )}
                        {needsClearance && canClear && (
                          <button className="btn btn-primary btn-sm" onClick={() => setClearingFor(plant)}>
                            Clear
                          </button>
                        )}
                        {needsClearance && !canClear && <span className="tiny">Awaiting clearance</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating && <CreatePlantModal onClose={() => setCreating(false)} />}
      {preStartFor && <PreStartModal plant={preStartFor} onClose={() => setPreStartFor(null)} />}
      {clearingFor && <ClearanceModal plant={clearingFor} onClose={() => setClearingFor(null)} />}
    </Layout>
  );
}
