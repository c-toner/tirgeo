import { useEffect, useMemo, useState } from "react";
import { Layout } from "../../components/Layout.tsx";
import { FileImage } from "../../components/FileImage.tsx";
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
import { formatDate, formatDateTime, titleCase } from "../../lib/format.ts";
import { prepareImageForUpload } from "../../lib/images.ts";
import { Link } from "../../lib/router.tsx";
import type { FileAsset, InspectionResult, PaginatedResult, Plant, PlantPreStartSummary, PreStartDefect, PreStartTemplate } from "../../lib/types.ts";
import { useApiQuery, useMutation } from "../../lib/useApi.ts";

const DEFECT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const PRE_START_PAGE_SIZE = 10;

function bestTemplateForPlant(templates: PreStartTemplate[] | undefined, plantType: string): PreStartTemplate | undefined {
  if (!templates?.length) return undefined;
  const exact = templates.find((template) => template.plantType?.toLowerCase() === plantType.toLowerCase());
  return exact ?? templates.find((template) => !template.plantType) ?? templates[0];
}

function CreatePlantModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ assetNumber: "", type: "", make: "", model: "", registration: "", currentProjectId: "", nextServiceAt: "" });
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
          currentProjectId: form.currentProjectId || undefined,
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
        <Field label="Current project" hint="Pre-starts will default to this location.">
          <ProjectSelect value={form.currentProjectId} onChange={set("currentProjectId")} allowEmpty emptyLabel="Not assigned yet" activeOnly />
        </Field>
        <Field label="Next service due">
          <TextInput value={form.nextServiceAt} onChange={set("nextServiceAt")} type="date" />
        </Field>
      </div>
    </Modal>
  );
}

function PreStartModal({ plant: initialPlant, onClose }: { plant?: Plant | null; onClose: () => void }) {
  const toast = useToast();
  const { data: plants, loading: plantsLoading } = useApiQuery<Plant[]>("/api/v1/plant");
  const [plantId, setPlantId] = useState(initialPlant?.id ?? "");
  const plant = plants?.find((item) => item.id === plantId) ?? initialPlant ?? null;
  const { data: templates, loading } = useApiQuery<PreStartTemplate[]>(plant ? "/api/v1/plant/pre-start-templates" : null, {
    plantType: plant?.type,
  });
  const [templateId, setTemplateId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [projectId, setProjectId] = useState(initialPlant?.currentProjectId ?? "");
  const [hourMeter, setHourMeter] = useState("");
  const [answers, setAnswers] = useState<Record<string, boolean | string | number | null>>({});
  const [defects, setDefects] = useState<Record<string, PreStartDefect>>({});
  const [photos, setPhotos] = useState<FileAsset[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [signedName, setSignedName] = useState("");

  const template = plant ? templates?.find((t) => t.id === templateId) ?? bestTemplateForPlant(templates, plant.type) : undefined;

  useEffect(() => {
    if (!plantId && initialPlant?.id) setPlantId(initialPlant.id);
  }, [initialPlant?.id, plantId]);

  useEffect(() => {
    if (plant?.currentProjectId && !projectId) setProjectId(plant.currentProjectId);
  }, [plant?.currentProjectId, projectId]);

  useEffect(() => {
    if (!plant) return;
    const nextTemplate = bestTemplateForPlant(templates, plant.type);
    if (nextTemplate && nextTemplate.id !== templateId) {
      setTemplateId(nextTemplate.id);
      setAnswers({});
      setDefects({});
    }
  }, [plant, templateId, templates]);

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

  const uploadPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadingPhotos(true);
    try {
      const uploaded: FileAsset[] = [];
      for (const file of Array.from(files)) {
        const prepared = await prepareImageForUpload(file);
        const formData = new FormData();
        formData.set("file", prepared);
        formData.set("entityType", "PlantPreStart");
        if (projectId) formData.set("projectId", projectId);
        formData.set("metadata", JSON.stringify({ plantId: plant?.id, assetNumber: plant?.assetNumber, draft: true }));
        const asset = await api<FileAsset>("/api/v1/files", { method: "POST", formData });
        uploaded.push(asset);
      }
      setPhotos(current => [...current, ...uploaded]);
      toast.push(uploaded.length === 1 ? "Photo added" : `${uploaded.length} photos added`);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : "Photo upload failed", "error");
    } finally {
      setUploadingPhotos(false);
    }
  };

  const mutation = useMutation(
    () =>
      api(`/api/v1/plant/${plant?.id}/pre-starts`, {
        method: "POST",
        body: {
          workerId: workerId.trim(),
          projectId: projectId || undefined,
          inspectedAt: new Date().toISOString(),
          hourMeter: hourMeter ? Number(hourMeter) : undefined,
          checklistTemplateId: template?.id,
          answers,
          result,
          photoIds: photos.map(photo => photo.id),
          defects: triggering.map((id) => defects[id]).filter(Boolean),
          signature: signature?.signature ?? "",
        },
      }),
    ["/api/v1/plant"],
  );

  const canSubmit =
    plant &&
    template &&
    workerId.trim() &&
    missingRequired.length === 0 &&
    missingDefectDetails.length === 0 &&
    signature &&
    !mutation.running &&
    (result !== "OUT_OF_SERVICE" || lockedOut);

  return (
    <Modal
      title={plant ? `Pre-start — ${plant.assetNumber} (${plant.type})` : "New pre-start"}
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
      {plantsLoading && <Loading />}
      {!plantsLoading && (
        <div className="form-grid">
          <Field label="Project / location" hint="Choose where this pre-start is being completed.">
            <ProjectSelect value={projectId} onChange={setProjectId} allowEmpty emptyLabel="Not project-specific" activeOnly />
          </Field>
          <Field label="Plant" required>
            <Select
              value={plantId}
              onChange={(nextPlantId) => {
                setPlantId(nextPlantId);
                setTemplateId("");
                setAnswers({});
                setDefects({});
                const nextPlant = plants?.find((item) => item.id === nextPlantId);
                setProjectId(nextPlant?.currentProjectId ?? projectId);
              }}
              allowEmpty
              emptyLabel="Select plant"
              options={(plants ?? []).map((item) => ({
                value: item.id,
                label: `${item.assetNumber} ${item.type}${[item.make, item.model].filter(Boolean).length ? ` - ${[item.make, item.model].filter(Boolean).join(" ")}` : ""}`,
              }))}
            />
          </Field>
        </div>
      )}
      {plant && loading && <Loading />}
      {plant && !loading && (templates?.length ?? 0) === 0 && (
        <div className="alert alert-warning">
          No published pre-start template is available. An owner or administrator can publish a generic default under{" "}
          <Link to="/plant/templates">Templates</Link>.
        </div>
      )}

      {plant && <div className="form-grid">
        <Field label="Worker" required hint="Your linked worker is selected by default.">
          <WorkerSelect value={workerId} onChange={setWorkerId} />
        </Field>
        <Field label="Checklist">
          <TextInput
            value={
              template
                ? `${template.name} v${template.version}${template.plantType ? ` (${template.plantType})` : " (default)"}`
                : loading
                  ? "Loading checklist..."
                  : "No checklist available"
            }
            onChange={() => undefined}
            disabled
          />
        </Field>
        <Field
          label={`Hour meter${plant.hourMeter !== null && plant.hourMeter !== undefined ? ` (last ${plant.hourMeter})` : ""}`}
          hint="Cannot move backwards."
        >
          <TextInput value={hourMeter} onChange={setHourMeter} type="number" min={0} inputMode="decimal" />
        </Field>
      </div>}

      {plant && <section className="stack">
        <div className="row-between">
          <div>
            <h3>Photos</h3>
            <span className="tiny">Add machine condition, hour meter, defect or lockout photos.</span>
          </div>
          <label className={"btn btn-ghost" + (uploadingPhotos ? " disabled" : "")}>
            <Icon name="upload" size={15} /> {uploadingPhotos ? "Uploading..." : "Add photos"}
            <input
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              disabled={uploadingPhotos}
              onChange={(event) => {
                uploadPhotos(event.target.files);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
        {photos.length > 0 && (
          <div className="photo-grid">
            {photos.map(photo => (
              <div className="photo-chip" key={photo.id}>
                <FileImage file={photo} />
                <button className="btn-icon" type="button" aria-label="Remove photo" onClick={() => setPhotos(current => current.filter(item => item.id !== photo.id))}>
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>}

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

function PlantLocationModal({ plant, onClose }: { plant: Plant; onClose: () => void }) {
  const toast = useToast();
  const [projectId, setProjectId] = useState(plant.currentProjectId ?? "");
  const mutation = useMutation(
    () => api<Plant>(`/api/v1/plant/${plant.id}/location`, { method: "PATCH", body: { projectId: projectId || null } }),
    ["/api/v1/plant"],
  );
  return (
    <Modal
      title={`Move plant — ${plant.assetNumber}`}
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
                  toast.push("Plant location updated");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Saving..." : "Save location"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <Field label="Current project" hint="Workers can still correct this during a pre-start if the plant has moved.">
        <ProjectSelect value={projectId} onChange={setProjectId} allowEmpty emptyLabel="Not assigned to a project" activeOnly />
      </Field>
    </Modal>
  );
}

function WorkerPreStartHistory({
  page,
  onPageChange,
  onNewPreStart,
}: {
  page: number;
  onPageChange: (page: number) => void;
  onNewPreStart: () => void;
}) {
  const { data, loading, error } = useApiQuery<PaginatedResult<PlantPreStartSummary>>("/api/v1/plant/my-pre-starts", {
    page,
    pageSize: PRE_START_PAGE_SIZE,
  });
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PRE_START_PAGE_SIZE));
  const rows = data?.items ?? [];

  useEffect(() => {
    if (page > pageCount) onPageChange(pageCount);
  }, [onPageChange, page, pageCount]);

  return (
    <section className="stack">
      <ErrorAlert error={error} />
      {loading && !data && <Loading />}
      {!loading && rows.length === 0 && (
        <div className="card">
          <EmptyState
            title="No pre-starts yet"
            hint="Your submitted pre-starts will appear here after you complete one."
            action={
              <button className="btn btn-accent" onClick={onNewPreStart}>
                <Icon name="plus" size={15} /> New pre-start
              </button>
            }
          />
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="prestart-history-list">
            {rows.map((item) => {
              const plant = item.plant;
              const makeModel = [plant.make, plant.model].filter(Boolean).join(" ") || "Make / model not recorded";
              const location = plant.currentProject ? `${plant.currentProject.code} · ${plant.currentProject.name}` : "Location not recorded";
              return (
                <Link className="prestart-history-row" key={item.id} to={`/plant/pre-starts/${item.id}`}>
                  <div>
                    <b className="mono">{plant.assetNumber}</b>
                    <span>{plant.type}</span>
                  </div>
                  <div>
                    <span className="tiny">Make / model</span>
                    <b>{makeModel}</b>
                  </div>
                  <div>
                    <span className="tiny">Location</span>
                    <b>{location}</b>
                  </div>
                  <div className="prestart-history-meta">
                    <span className="tiny">{formatDateTime(item.inspectedAt)}</span>
                    <StatusBadge status={item.result} />
                  </div>
                </Link>
              );
            })}
          </div>
          <div className="pager">
            <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              Previous
            </button>
            <span className="tiny">
              Page {page} of {pageCount} · {total} pre-start{total === 1 ? "" : "s"}
            </span>
            <button className="btn btn-ghost btn-sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
              Next
            </button>
          </div>
        </>
      )}
    </section>
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
  const { user, hasRole } = useAuth();
  const canManagePlant = hasRole(...PROJECT_LEADERS) || !!user?.sections.includes("PLANT_MANAGEMENT");
  const canClear = hasRole(...PLANT_CLEARERS);
  const canManageTemplates = hasRole(...TEMPLATE_ADMINS);
  const { data, loading, error } = useApiQuery<Plant[]>("/api/v1/plant");
  const [creating, setCreating] = useState(false);
  const [preStartFor, setPreStartFor] = useState<Plant | "new" | null>(null);
  const [locationFor, setLocationFor] = useState<Plant | null>(null);
  const [clearingFor, setClearingFor] = useState<Plant | null>(null);
  const [filter, setFilter] = useState("");
  const [historyPage, setHistoryPage] = useState(1);

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
          {canManagePlant && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={15} /> Add asset
            </button>
          )}
          {!canManagePlant && (
            <button className="btn btn-accent" onClick={() => setPreStartFor("new")}>
              <Icon name="plus" size={15} /> New pre-start
            </button>
          )}
        </div>
      }
    >
      {!canManagePlant ? (
        <WorkerPreStartHistory page={historyPage} onPageChange={setHistoryPage} onNewPreStart={() => setPreStartFor("new")} />
      ) : (
        <>
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
              canManagePlant && !filter ? (
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
                <th>Current project</th>
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
                    <td className="tiny">
                      {plant.currentProject ? `${plant.currentProject.code} · ${plant.currentProject.name}` : "Not assigned"}
                    </td>
                    <td className="num">{plant.hourMeter ?? "—"}</td>
                    <td className="tiny">{formatDate(plant.nextServiceAt)}</td>
                    <td>
                      <StatusBadge status={plant.status} />
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: "nowrap", justifyContent: "flex-end" }}>
                        <button className="btn btn-accent btn-sm" onClick={() => setPreStartFor(plant)}>
                          Pre-start
                        </button>
                        {canManagePlant && (
                          <button className="btn btn-ghost btn-sm" onClick={() => setLocationFor(plant)}>
                            Move
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
        </>
      )}

      {creating && <CreatePlantModal onClose={() => setCreating(false)} />}
      {preStartFor && <PreStartModal plant={preStartFor === "new" ? null : preStartFor} onClose={() => setPreStartFor(null)} />}
      {locationFor && <PlantLocationModal plant={locationFor} onClose={() => setLocationFor(null)} />}
      {clearingFor && <ClearanceModal plant={clearingFor} onClose={() => setClearingFor(null)} />}
    </Layout>
  );
}
