import { useState } from "react";
import { Layout } from "../../components/Layout.tsx";
import { ProjectSelect } from "../../components/ProjectSelect.tsx";
import {
  EmptyState,
  ErrorAlert,
  Field,
  Icon,
  Modal,
  Select,
  StatusBadge,
  TextArea,
  TextInput,
  useToast,
} from "../../components/ui.tsx";
import { WorkerMultiSelect } from "../../components/WorkerSelect.tsx";
import { api } from "../../lib/api.ts";
import { DOCUMENT_APPROVERS, DOCUMENT_AUTHORS, useAuth } from "../../lib/auth.tsx";
import { formatDate, titleCase } from "../../lib/format.ts";
import { forgetRecent, listRecents, rememberRecent, updateRecent } from "../../lib/recents.ts";
import type { SafetyDocument, SafetyDocumentType } from "../../lib/types.ts";
import { useMutation } from "../../lib/useApi.ts";

const DOC_TYPES: SafetyDocumentType[] = [
  "SWMS",
  "JSA",
  "TOOLBOX_TALK",
  "RISK_ASSESSMENT",
  "ENVIRONMENTAL_PLAN",
  "TRAFFIC_PLAN",
  "EMERGENCY_PLAN",
];
const RISKS = ["LOW", "MEDIUM", "HIGH", "EXTREME"];

function linesToItems(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function CreateDocumentModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    projectId: "",
    type: "SWMS",
    title: "",
    riskLevel: "",
    activities: "",
    hazards: "",
    controls: "",
    reviewDueAt: "",
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const mutation = useMutation(
    () =>
      api<SafetyDocument>("/api/v1/safety/documents", {
        method: "POST",
        body: {
          projectId: form.projectId,
          type: form.type,
          title: form.title.trim(),
          riskLevel: form.riskLevel || undefined,
          activities: linesToItems(form.activities).map((title) => ({ title })),
          hazards: linesToItems(form.hazards).map((title) => ({ title })),
          controls: linesToItems(form.controls).map((title) => ({ title })),
          reviewDueAt: form.reviewDueAt ? new Date(form.reviewDueAt).toISOString() : undefined,
        },
      }),
    [],
  );

  return (
    <Modal
      title="Draft safety document"
      large
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || !form.projectId || !form.title.trim()}
            onClick={() =>
              mutation.run({
                onSuccess: (doc) => {
                  rememberRecent("safety-docs", {
                    id: doc.id,
                    label: `${doc.type} — ${doc.title}`,
                    sublabel: `v${doc.version}`,
                    status: "DRAFT",
                  });
                  toast.push("Draft created — approve it to lock the content hash");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Creating…" : "Create draft"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <div className="form-grid">
        <Field label="Project" required>
          <ProjectSelect value={form.projectId} onChange={set("projectId")} allowEmpty emptyLabel="— Select project —" activeOnly />
        </Field>
        <Field label="Document type" required>
          <Select value={form.type} onChange={set("type")} options={DOC_TYPES.map((t) => ({ value: t, label: titleCase(t) }))} />
        </Field>
        <Field label="Title" required span2>
          <TextInput value={form.title} onChange={set("title")} placeholder="e.g. SWMS — Trenching adjacent to live services" />
        </Field>
        <Field label="Overall risk level">
          <Select value={form.riskLevel} onChange={set("riskLevel")} allowEmpty emptyLabel="Unrated" options={RISKS} />
        </Field>
        <Field label="Review due">
          <TextInput value={form.reviewDueAt} onChange={set("reviewDueAt")} type="date" />
        </Field>
        <Field label="Activities (one per line)" span2>
          <TextArea value={form.activities} onChange={set("activities")} rows={3} />
        </Field>
        <Field label="Hazards (one per line)" span2>
          <TextArea value={form.hazards} onChange={set("hazards")} rows={3} />
        </Field>
        <Field label="Controls (one per line)" span2>
          <TextArea value={form.controls} onChange={set("controls")} rows={3} />
        </Field>
      </div>
    </Modal>
  );
}

function PublishModal({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const toast = useToast();
  const [workerIds, setWorkerIds] = useState<string[]>([]);
  const [dueAt, setDueAt] = useState("");
  const mutation = useMutation(
    () =>
      api(`/api/v1/safety/documents/${documentId}/publish`, {
        method: "POST",
        body: { workerIds, dueAt: dueAt ? new Date(dueAt).toISOString() : undefined },
      }),
    [],
  );
  return (
    <Modal
      title="Publish to workers"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || workerIds.length === 0}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  updateRecent("safety-docs", documentId, { status: "PUBLISHED" });
                  toast.push(`Assigned to ${workerIds.length} worker(s)`);
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Publishing…" : `Publish to ${workerIds.length || "…"} worker(s)`}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <Field label="Workers" required hint="Search by name, employee number or classification.">
        <WorkerMultiSelect value={workerIds} onChange={setWorkerIds} />
      </Field>
      <Field label="Acknowledgement due">
        <TextInput value={dueAt} onChange={setDueAt} type="date" />
      </Field>
    </Modal>
  );
}

export function SafetyDocsPage() {
  const { hasRole } = useAuth();
  const canAuthor = hasRole(...DOCUMENT_AUTHORS);
  const canApprove = hasRole(...DOCUMENT_APPROVERS);
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [publishFor, setPublishFor] = useState<string | null>(null);
  const [openById, setOpenById] = useState("");
  const [, forceRender] = useState(0);
  const docs = listRecents("safety-docs");

  const approve = async (id: string) => {
    try {
      const doc = await api<SafetyDocument>(`/api/v1/safety/documents/${id}/approve`, { method: "POST" });
      updateRecent("safety-docs", id, { status: "APPROVED", sublabel: `v${doc.version} · hash ${doc.contentHash?.slice(0, 10)}…` });
      toast.push("Approved — content hash locked");
      forceRender((n) => n + 1);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Approval failed", "error");
    }
  };

  const track = (id: string) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    rememberRecent("safety-docs", { id: trimmed, label: `Document ${trimmed.slice(0, 8)}…`, status: "DRAFT" });
    setOpenById("");
    forceRender((n) => n + 1);
  };

  return (
    <Layout
      title="Safety documents"
      actions={
        canAuthor ? (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} /> Draft document
          </button>
        ) : undefined
      }
    >
      <div className="alert alert-info">
        Lifecycle: <b>draft → approve (locks a SHA-256 content hash) → publish to workers → workers sign on</b>. The
        API does not list documents yet, so this page tracks documents handled on this device; any document can be
        added by ID.
      </div>

      <div className="row">
        <input
          className="input"
          style={{ maxWidth: 340 }}
          placeholder="Track existing document by ID…"
          value={openById}
          onChange={(e: { target: { value: string } }) => setOpenById(e.target.value)}
        />
        <button className="btn btn-ghost" onClick={() => track(openById)} disabled={!openById.trim()}>
          Track
        </button>
      </div>

      {docs.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No documents tracked on this device"
            hint="Draft a SWMS/JSA or paste an existing document ID to manage its approval and publication."
            action={
              canAuthor ? (
                <button className="btn btn-primary" onClick={() => setCreating(true)}>
                  <Icon name="plus" size={15} /> Draft document
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Detail</th>
                <th>Status</th>
                <th>Tracked</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <b>{doc.label}</b>
                    <div className="mono tiny">{doc.id}</div>
                  </td>
                  <td className="tiny">{doc.sublabel ?? "—"}</td>
                  <td>
                    <StatusBadge status={doc.status} />
                  </td>
                  <td className="tiny">{formatDate(doc.savedAt)}</td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      {canApprove && doc.status === "DRAFT" && (
                        <button className="btn btn-ghost btn-sm" onClick={() => approve(doc.id)}>
                          Approve
                        </button>
                      )}
                      {canAuthor && (doc.status === "APPROVED" || doc.status === "PUBLISHED") && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setPublishFor(doc.id)}>
                          Publish
                        </button>
                      )}
                      <button
                        className="btn-icon"
                        aria-label="Stop tracking"
                        onClick={() => {
                          forgetRecent("safety-docs", doc.id);
                          forceRender((n) => n + 1);
                        }}
                      >
                        <Icon name="x" size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="tiny">
        Workers see their assigned documents (and sign on) under <b>My sign-ons</b>. Signatures capture the exact
        approved content hash, consent statement, method, IP and user agent for defensible evidence.
      </p>

      {creating && <CreateDocumentModal onClose={() => setCreating(false)} />}
      {publishFor && <PublishModal documentId={publishFor} onClose={() => setPublishFor(null)} />}
    </Layout>
  );
}
