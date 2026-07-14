import { useState } from "react";
import { Layout } from "../../components/Layout.tsx";
import { EmptyState, ErrorAlert, Loading, Modal, StatusBadge, useToast } from "../../components/ui.tsx";
import { SignaturePad } from "../../components/SignaturePad.tsx";
import type { SignatureValue } from "../../components/SignaturePad.tsx";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth.tsx";
import { formatDate, formatDateTime, isOverdue, titleCase } from "../../lib/format.ts";
import type { SafetyAssignment } from "../../lib/types.ts";
import { useApiQuery, useMutation } from "../../lib/useApi.ts";

function AcknowledgeModal({ assignment, onClose }: { assignment: SafetyAssignment; onClose: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const [signedName, setSignedName] = useState(user?.name ?? "");
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [consent, setConsent] = useState(false);

  const mutation = useMutation(
    () =>
      api(`/api/v1/safety/documents/${assignment.safetyDocumentId}/acknowledge`, {
        method: "POST",
        body: {
          signedName: signedName.trim(),
          signature: signature!.signature,
          signatureMethod: signature!.signatureMethod,
          consent: true,
        },
      }),
    ["/api/v1/safety/my-assignments"],
  );

  return (
    <Modal
      title={`Sign on — ${assignment.document.title}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-accent"
            disabled={mutation.running || !signature || signedName.trim().length < 2 || !consent}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push("Signed on — acknowledgement recorded");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Signing…" : "Sign on"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <div className="card card-pad stack" style={{ boxShadow: "none", gap: 6 }}>
        <div className="row-between">
          <b>
            {assignment.document.type} v{assignment.document.version}
          </b>
          <StatusBadge status={assignment.document.status} />
        </div>
        <span className="muted">{assignment.document.title}</span>
        <span className="tiny mono">Content hash: {assignment.document.contentHash?.slice(0, 24)}…</span>
        <span className="tiny">
          Approved {formatDate(assignment.document.approvedAt)} · Published {formatDate(assignment.document.publishedAt)}
        </span>
      </div>
      <SignaturePad signedName={signedName} onNameChange={setSignedName} onChange={setSignature} />
      <label className="row" style={{ gap: 8, alignItems: "flex-start", fontSize: 13 }}>
        <input type="checkbox" checked={consent} onChange={(e: { target: { checked: boolean } }) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
        <span>I confirm I have read, understood and agree to follow this document.</span>
      </label>
    </Modal>
  );
}

export function MySafetyPage() {
  const { data, loading, error } = useApiQuery<SafetyAssignment[]>("/api/v1/safety/my-assignments");
  const [signing, setSigning] = useState<SafetyAssignment | null>(null);

  const pending = (data ?? []).filter((assignment) => !assignment.acknowledgement);
  const done = (data ?? []).filter((assignment) => assignment.acknowledgement);

  return (
    <Layout title="My sign-ons">
      <ErrorAlert error={error} />
      {loading && !data && <Loading />}

      {data && data.length === 0 && (
        <div className="card">
          <EmptyState
            title="Nothing assigned to you"
            hint="When a SWMS, JSA or toolbox talk is published to you, it appears here for signature."
          />
        </div>
      )}

      {pending.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>Awaiting your signature ({pending.length})</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {pending.map((assignment) => (
                  <tr key={assignment.id}>
                    <td>
                      <b>{assignment.document.title}</b>
                      <div className="tiny">
                        {titleCase(assignment.document.type)} v{assignment.document.version} · assigned{" "}
                        {formatDate(assignment.assignedAt)}
                      </div>
                    </td>
                    <td className={"tiny" + (isOverdue(assignment.dueAt) ? " field-error" : "")}>
                      {assignment.dueAt ? `Due ${formatDate(assignment.dueAt)}` : "No due date"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {assignment.document.publishedAt && assignment.document.contentHash ? (
                        <button className="btn btn-accent btn-sm" onClick={() => setSigning(assignment)}>
                          Read & sign
                        </button>
                      ) : (
                        <span className="badge badge-warning">Awaiting approval</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {done.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>Signed ({done.length})</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {done.map((assignment) => (
                  <tr key={assignment.id}>
                    <td>
                      <b>{assignment.document.title}</b>
                      <div className="tiny">
                        {titleCase(assignment.document.type)} v{assignment.document.version}
                      </div>
                    </td>
                    <td className="tiny">
                      Signed by {assignment.acknowledgement!.signedName}
                      {assignment.acknowledgement!.createdAt || assignment.acknowledgement!.signedAt
                        ? ` · ${formatDateTime(assignment.acknowledgement!.createdAt ?? assignment.acknowledgement!.signedAt)}`
                        : ""}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span className="badge badge-good">Acknowledged</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {signing && <AcknowledgeModal assignment={signing} onClose={() => setSigning(null)} />}
    </Layout>
  );
}
