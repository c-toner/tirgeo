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
import type { Permit, PermitStatus } from "../../lib/types.ts";
import { useApiQuery, useMutation } from "../../lib/useApi.ts";

const PERMIT_TYPES = [
  "HOT_WORK",
  "CONFINED_SPACE",
  "EXCAVATION",
  "WORKING_AT_HEIGHT",
  "LIFTING",
  "ELECTRICAL_ISOLATION",
  "TRAFFIC_CONTROL",
  "ENVIRONMENTAL",
  "OTHER",
];

const BOARD_COLUMNS: Array<{ title: string; statuses: PermitStatus[] }> = [
  { title: "Draft / Requested", statuses: ["DRAFT", "REQUESTED"] },
  { title: "Approved", statuses: ["APPROVED"] },
  { title: "Active", statuses: ["ACTIVE", "SUSPENDED"] },
  { title: "Closed", statuses: ["CLOSED", "CANCELLED"] },
];

// Allowed next moves surfaced in the UI (server enforces its own rules).
const NEXT_STATUS: Record<string, PermitStatus[]> = {
  DRAFT: ["REQUESTED", "CANCELLED"],
  REQUESTED: ["APPROVED", "CANCELLED"],
  APPROVED: ["ACTIVE", "SUSPENDED", "CLOSED", "CANCELLED"],
  ACTIVE: ["SUSPENDED", "CLOSED"],
  SUSPENDED: ["ACTIVE", "CLOSED"],
};

function expiryTone(permit: Permit): "ok" | "soon" | "expired" {
  const expiry = new Date(permit.expiresAt).getTime();
  if (expiry < Date.now()) return "expired";
  if (expiry - Date.now() < 4 * 3600_000) return "soon";
  return "ok";
}

function CreatePermitModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    projectId: "",
    type: "EXCAVATION",
    title: "",
    location: "",
    scope: "",
    startsAt: "",
    expiresAt: "",
    hazards: "",
    controls: "",
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const mutation = useMutation(
    () =>
      api<Permit>("/api/v1/safety/permits", {
        method: "POST",
        body: {
          projectId: form.projectId,
          type: form.type,
          title: form.title.trim(),
          location: form.location.trim(),
          scope: form.scope.trim(),
          startsAt: new Date(form.startsAt).toISOString(),
          expiresAt: new Date(form.expiresAt).toISOString(),
          hazards: form.hazards
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((title) => ({ title })),
          controls: form.controls
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((title) => ({ title })),
          signOns: [],
        },
      }),
    ["/api/v1/safety/permits", "/api/v1/safety/dashboard"],
  );

  const valid =
    form.projectId &&
    form.title.trim().length >= 3 &&
    form.location.trim().length >= 2 &&
    form.scope.trim().length >= 3 &&
    form.startsAt &&
    form.expiresAt &&
    new Date(form.expiresAt) > new Date(form.startsAt);

  return (
    <Modal
      title="New permit to work"
      large
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || !valid}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push("Permit created in draft");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Creating…" : "Create permit"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      {form.startsAt && form.expiresAt && new Date(form.expiresAt) <= new Date(form.startsAt) && (
        <div className="alert alert-warning">Expiry must be after the start time.</div>
      )}
      <div className="form-grid">
        <Field label="Project" required>
          <ProjectSelect value={form.projectId} onChange={set("projectId")} allowEmpty emptyLabel="— Select project —" activeOnly />
        </Field>
        <Field label="Permit type" required>
          <Select value={form.type} onChange={set("type")} options={PERMIT_TYPES} />
        </Field>
        <Field label="Title" required span2>
          <TextInput value={form.title} onChange={set("title")} placeholder="e.g. Excavate stormwater trench" />
        </Field>
        <Field label="Location" required>
          <TextInput value={form.location} onChange={set("location")} />
        </Field>
        <Field label="Scope of work" required>
          <TextInput value={form.scope} onChange={set("scope")} />
        </Field>
        <Field label="Starts" required>
          <TextInput value={form.startsAt} onChange={set("startsAt")} type="datetime-local" />
        </Field>
        <Field label="Expires" required>
          <TextInput value={form.expiresAt} onChange={set("expiresAt")} type="datetime-local" />
        </Field>
        <Field label="Hazards (one per line)" span2>
          <TextArea value={form.hazards} onChange={set("hazards")} rows={3} placeholder={"Live services\nUnstable ground"} />
        </Field>
        <Field label="Controls (one per line)" span2>
          <TextArea value={form.controls} onChange={set("controls")} rows={3} placeholder={"Dial before you dig reviewed\nSpotter in place"} />
        </Field>
      </div>
    </Modal>
  );
}

function PermitCard({ permit, canMove, onMove }: { permit: Permit; canMove: boolean; onMove: (status: PermitStatus) => void }) {
  const tone = expiryTone(permit);
  const projectName = useProjectName(permit.projectId);
  const nextMoves = NEXT_STATUS[permit.status] ?? [];
  return (
    <div className="kanban-card">
      <div className="row-between" style={{ gap: 6 }}>
        <span className="badge no-dot">{titleCase(permit.type)}</span>
        <StatusBadge status={permit.status} />
      </div>
      <b>{permit.title}</b>
      <span className="tiny">
        {projectName} · {permit.location}
      </span>
      <span className="tiny">{permit.scope}</span>
      {(permit.hazards?.length ?? 0) > 0 && (
        <span className="tiny">Hazards: {permit.hazards!.map((h) => h.title).join(", ")}</span>
      )}
      {(permit.controls?.length ?? 0) > 0 && (
        <span className="tiny">Controls: {permit.controls!.map((c) => c.title).join(", ")}</span>
      )}
      <span
        className="tiny"
        style={{
          color: tone === "expired" ? "var(--critical-text)" : tone === "soon" ? "var(--serious-text)" : undefined,
          fontWeight: tone !== "ok" ? 650 : undefined,
        }}
      >
        {formatDateTime(permit.startsAt)} → {formatDateTime(permit.expiresAt)}
        {tone === "expired" && ["APPROVED", "ACTIVE"].includes(permit.status) ? " · EXPIRED" : tone === "soon" ? " · expiring soon" : ""}
      </span>
      {canMove && nextMoves.length > 0 && (
        <div className="row" style={{ gap: 5 }}>
          {nextMoves.map((status) => (
            <button key={status} className="btn btn-ghost btn-sm" onClick={() => onMove(status)}>
              {titleCase(status)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PermitsPage() {
  const { hasRole } = useAuth();
  const canCreate = hasRole(...HSEQ_EDITORS);
  const canMove = hasRole(...HSEQ_VERIFIERS);
  const toast = useToast();
  const [projectId, setProjectId] = useState("");
  const [type, setType] = useState("");
  const { data, loading, error, refresh } = useApiQuery<Permit[]>("/api/v1/safety/permits", {
    projectId: projectId || undefined,
    type: type || undefined,
  });
  const [creating, setCreating] = useState(false);

  const move = async (permit: Permit, status: PermitStatus) => {
    try {
      await api(`/api/v1/safety/permits/${permit.id}/status`, { method: "PATCH", body: { status } });
      toast.push(`Permit ${titleCase(status).toLowerCase()}`);
      refresh();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Could not move permit", "error");
    }
  };

  return (
    <Layout
      title="Permits to work"
      actions={
        canCreate ? (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} /> New permit
          </button>
        ) : undefined
      }
    >
      <div className="filter-row">
        <ProjectSelect value={projectId} onChange={setProjectId} allowEmpty />
        <Select value={type} onChange={setType} allowEmpty emptyLabel="Any type" options={PERMIT_TYPES} />
        {canCreate && (
          <button className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }} onClick={() => setCreating(true)}>
            <Icon name="plus" size={13} /> New
          </button>
        )}
      </div>

      <ErrorAlert error={error} />
      {loading && !data && <Loading />}

      {data && data.length === 0 && (
        <div className="card">
          <EmptyState title="No permits" hint="High-risk work permits (hot work, confined space, excavation…) are managed here through their lifecycle." />
        </div>
      )}

      {data && data.length > 0 && (
        <div className="kanban">
          {BOARD_COLUMNS.map((column) => {
            const permits = data.filter((permit) => column.statuses.includes(permit.status as PermitStatus));
            return (
              <div className="kanban-col" key={column.title}>
                <h3>
                  {column.title} <span>{permits.length}</span>
                </h3>
                {permits.map((permit) => (
                  <PermitCard key={permit.id} permit={permit} canMove={canMove} onMove={(status) => move(permit, status)} />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {creating && <CreatePermitModal onClose={() => setCreating(false)} />}
    </Layout>
  );
}
