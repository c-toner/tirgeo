import { useEffect, useRef, useState } from "react";
import { Layout } from "../../components/Layout.tsx";
import {
  EmptyState,
  ErrorAlert,
  Field,
  Icon,
  Loading,
  Modal,
  Select,
  StatusBadge,
  TextInput,
  useToast,
} from "../../components/ui.tsx";
import { WorkerSelect } from "../../components/WorkerSelect.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { formatDate, formatDateTime, titleCase } from "../../lib/format.ts";
import { rememberRecent } from "../../lib/recents.ts";
import { Link } from "../../lib/router.tsx";
import type { Tender, TenderChecklistItem, TenderRequirement, WorkerSummary } from "../../lib/types.ts";
import { useApiQuery, useMutation } from "../../lib/useApi.ts";

const CHECKLIST_STATUSES = ["TODO", "IN_PROGRESS", "COMPLETE", "NOT_APPLICABLE"];

function UploadCard({ tenderId, onUploaded }: { tenderId: string; onUploaded: () => void }) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [duplicate, setDuplicate] = useState<{ file: File; warning: string } | null>(null);

  const upload = async (file: File, resetDuplicate = false) => {
    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      await api(`/api/v1/commercial/tenders/${tenderId}/documents`, {
        method: "POST",
        formData,
        query: resetDuplicate ? { resetDuplicate: true } : undefined,
      });
      toast.push(resetDuplicate ? "Document re-analysed — progress has been reset" : "Document analysed — review the suggested requirements");
      setDuplicate(null);
      onUploaded();
    } catch (err) {
      if (!resetDuplicate && err instanceof ApiError && err.status === 409 && err.code === "DUPLICATE_TENDER_DOCUMENT") {
        const body = (err.body ?? {}) as { warning?: string };
        setDuplicate({
          file,
          warning: body.warning ?? "You have already uploaded this document. Re-uploading will reset extracted requirements and checklist progress for this document.",
        });
      } else {
        setDuplicate(null);
        setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="stack">
      <ErrorAlert error={error} onDismiss={() => setError(null)} />
      {duplicate && (
        <Modal
          title="Re-upload document?"
          onClose={() => setDuplicate(null)}
          footer={
            <>
              <button className="btn btn-ghost" disabled={uploading} onClick={() => setDuplicate(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={uploading} onClick={() => upload(duplicate.file, true)}>
                {uploading ? "Re-analysing…" : "Proceed and reset progress"}
              </button>
            </>
          }
        >
          <p>{duplicate.warning}</p>
          <p className="muted">
            This only resets requirements and checklist items extracted from this uploaded file. Manual tender checklist items are kept.
          </p>
        </Modal>
      )}
      <div
        className="card card-pad row"
        style={{ borderStyle: "dashed", justifyContent: "center", padding: 26, boxShadow: "none" }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.xlsx,.csv,.txt"
          style={{ display: "none" }}
          onChange={(event: { target: { files: FileList | null } }) => {
            const file = event.target.files?.[0];
            if (file) upload(file);
          }}
        />
        <button className="btn btn-primary" disabled={uploading} onClick={() => inputRef.current?.click()}>
          <Icon name="upload" size={15} /> {uploading ? "Analysing…" : "Upload tender document"}
        </button>
        <span className="tiny">PDF, DOCX, XLSX, CSV or text · max 25 MB</span>
      </div>
    </div>
  );
}

function ChecklistModal({
  tenderId,
  item,
  onClose,
}: {
  tenderId: string;
  item: TenderChecklistItem;
  onClose: () => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState(item.status);
  const [workerId, setWorkerId] = useState(item.ownerId ?? "");
  const [dueAt, setDueAt] = useState(item.dueAt ? item.dueAt.slice(0, 10) : "");
  const mutation = useMutation(
    () =>
      api(`/api/v1/commercial/tenders/${tenderId}/checklist/${item.id}`, {
        method: "PATCH",
        body: { status, ownerId: workerId || null, dueAt: dueAt ? new Date(dueAt).toISOString() : null },
      }),
    [`/api/v1/commercial/tenders/${tenderId}`],
  );
  return (
    <Modal
      title="Update checklist item"
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
                  toast.push("Checklist updated");
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
      <p className="muted">{item.title}</p>
      <Field label="Status">
        <Select value={status} onChange={setStatus} options={CHECKLIST_STATUSES} />
      </Field>
      <Field label="Assign to worker" hint="Assign parsed RFT tasks to the person who will own the action.">
        <WorkerSelect value={workerId} onChange={setWorkerId} allowEmpty emptyLabel="Unassigned" autoSelectCurrent={false} />
      </Field>
      <Field label="Due">
        <TextInput value={dueAt} onChange={setDueAt} type="date" />
      </Field>
    </Modal>
  );
}

export function TenderDetailPage({ tenderId }: { tenderId: string }) {
  const toast = useToast();
  const { data: tender, loading, error, refresh } = useApiQuery<Tender>(`/api/v1/commercial/tenders/${tenderId}`);
  const { data: workers } = useApiQuery<WorkerSummary[]>("/api/v1/workers");
  const [checklistItem, setChecklistItem] = useState<TenderChecklistItem | null>(null);

  useEffect(() => {
    if (tender) {
      rememberRecent("tenders", {
        id: tender.id,
        label: `${tender.reference} — ${tender.title}`,
        sublabel: `Closes ${formatDate(tender.closesAt)}`,
      });
    }
  }, [tender]);

  const review = async (requirement: TenderRequirement, reviewStatus: "CONFIRMED" | "REJECTED") => {
    try {
      await api(`/api/v1/commercial/tenders/${tenderId}/requirements/${requirement.id}`, {
        method: "PATCH",
        body: { reviewStatus },
      });
      toast.push(reviewStatus === "CONFIRMED" ? "Requirement confirmed" : "Requirement rejected");
      refresh();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Review failed", "error");
    }
  };

  const suggested = (tender?.requirements ?? []).filter((requirement) => requirement.reviewStatus === "SUGGESTED");
  const reviewed = (tender?.requirements ?? []).filter((requirement) => requirement.reviewStatus !== "SUGGESTED");
  const checklist = tender?.checklistItems ?? [];
  const complete = checklist.filter((item) => item.status === "COMPLETE" || item.status === "NOT_APPLICABLE").length;
  const workerNames = new Map((workers ?? []).map((worker) => [worker.id, `${worker.firstName} ${worker.lastName}`.trim()]));

  return (
    <Layout
      title={tender ? `${tender.reference}` : "Tender"}
      actions={
        <Link to="/commercial" className="btn btn-ghost">
          All tenders
        </Link>
      }
    >
      <ErrorAlert error={error} />
      {loading && !tender && <Loading />}

      {tender && (
        <>
          <section className="card card-pad">
            <div className="row-between">
              <div>
                <h2 style={{ fontSize: 18 }}>{tender.title}</h2>
                <span className="muted">
                  {tender.clientName} · {tender.jurisdiction} · closes {formatDateTime(tender.closesAt)}
                </span>
                {tender.scope && <p className="muted" style={{ marginTop: 6 }}>{tender.scope}</p>}
              </div>
              <div className="stat-tile tone-primary" style={{ minWidth: 160 }}>
                <span className="stat-label">Checklist progress</span>
                <span className="stat-value">
                  {complete}/{checklist.length || "0"}
                </span>
                <span className="stat-foot">items complete or N/A</span>
              </div>
            </div>
          </section>

          <UploadCard tenderId={tenderId} onUploaded={refresh} />

          {(tender.documents ?? []).length > 0 && (
            <section className="card">
              <div className="card-header">
                <h2>Documents</h2>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th className="num">Size</th>
                      <th className="num">Pages</th>
                      <th>Uploaded</th>
                      <th>Analysis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tender.documents!.map((document) => (
                      <tr key={document.id}>
                        <td>
                          <b>{document.name}</b>
                          <div className="mono tiny">sha256 {document.sha256.slice(0, 16)}…</div>
                        </td>
                        <td className="num">{(document.sizeBytes / 1024).toFixed(0)} KB</td>
                        <td className="num">{document.pageCount ?? "—"}</td>
                        <td className="tiny">{formatDateTime(document.uploadedAt)}</td>
                        <td>
                          <StatusBadge status={document.processingStatus} />
                          {document.processingError && <div className="tiny field-error">{document.processingError}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {suggested.length > 0 && (
            <section className="card">
              <div className="card-header">
                <h2>Suggested requirements ({suggested.length})</h2>
                <span className="hint">Extraction assists review — it is not contract advice.</span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {suggested.map((requirement) => (
                      <tr key={requirement.id}>
                        <td>
                          <b>{requirement.title}</b>
                          {requirement.detail && <div className="tiny">{requirement.detail}</div>}
                          <div className="tiny">
                            {requirement.category && <span className="badge no-dot">{titleCase(requirement.category)}</span>}{" "}
                            {requirement.mandatory && <span className="badge badge-serious">Mandatory</span>}{" "}
                            {requirement.sourcePage != null && `p.${requirement.sourcePage}`}
                            {requirement.sourceReference && ` · ${requirement.sourceReference}`}
                          </div>
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <div className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "nowrap" }}>
                            <button className="btn btn-primary btn-sm" onClick={() => review(requirement, "CONFIRMED")}>
                              <Icon name="check" size={13} /> Confirm
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => review(requirement, "REJECTED")}>
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="card">
            <div className="card-header">
              <h2>Submission checklist</h2>
            </div>
            {checklist.length === 0 ? (
              <EmptyState title="No checklist yet" hint="Upload a tender document — confirmed requirements become checklist items." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Mandatory</th>
                      <th>Assignee</th>
                      <th>Due</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {checklist.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <b>{item.title}</b>
                          {item.description && <div className="tiny">{item.description}</div>}
                        </td>
                        <td>{item.mandatory ? <span className="badge badge-serious">Mandatory</span> : <span className="muted">—</span>}</td>
                        <td className="tiny">{item.ownerId ? workerNames.get(item.ownerId) ?? "Assigned" : <span className="muted">Unassigned</span>}</td>
                        <td className="tiny">{formatDate(item.dueAt)}</td>
                        <td>
                          <StatusBadge status={item.status} />
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setChecklistItem(item)}>
                            Update
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {reviewed.length > 0 && (
            <details>
              <summary className="muted" style={{ cursor: "pointer" }}>
                Reviewed requirements ({reviewed.length})
              </summary>
              <div className="card table-wrap" style={{ marginTop: 10 }}>
                <table className="table">
                  <tbody>
                    {reviewed.map((requirement) => (
                      <tr key={requirement.id}>
                        <td>
                          <b>{requirement.title}</b>
                          {requirement.detail && <div className="tiny">{requirement.detail}</div>}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <StatusBadge status={requirement.reviewStatus} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}

      {checklistItem && <ChecklistModal tenderId={tenderId} item={checklistItem} onClose={() => setChecklistItem(null)} />}
    </Layout>
  );
}
