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
  TextArea,
  TextInput,
  useToast,
} from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { formatDate, isoDateOnly } from "../../lib/format.ts";
import { listRecents, rememberRecent } from "../../lib/recents.ts";
import { Link, navigate } from "../../lib/router.tsx";
import type { Tender } from "../../lib/types.ts";
import { useMutation } from "../../lib/useApi.ts";

const JURISDICTIONS = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];

function CreateTenderModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    reference: "",
    title: "",
    clientName: "",
    jurisdiction: "NSW",
    closesAt: "",
    scope: "",
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const mutation = useMutation(
    () =>
      api<Tender>("/api/v1/commercial/tenders", {
        method: "POST",
        body: {
          reference: form.reference.trim(),
          title: form.title.trim(),
          clientName: form.clientName.trim(),
          jurisdiction: form.jurisdiction,
          closesAt: new Date(form.closesAt).toISOString(),
          scope: form.scope.trim() || undefined,
        },
      }),
    [],
  );
  return (
    <Modal
      title="New tender"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || !form.reference.trim() || !form.title.trim() || !form.clientName.trim() || !form.closesAt}
            onClick={() =>
              mutation.run({
                onSuccess: (tender) => {
                  rememberRecent("tenders", {
                    id: tender.id,
                    label: `${tender.reference} — ${tender.title}`,
                    sublabel: `Closes ${formatDate(tender.closesAt)}`,
                  });
                  toast.push("Tender created — upload documents to extract requirements");
                  onClose();
                  navigate(`/commercial/tenders/${tender.id}`);
                },
              })
            }
          >
            {mutation.running ? "Creating…" : "Create tender"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <div className="form-grid">
        <Field label="Reference" required>
          <TextInput value={form.reference} onChange={set("reference")} placeholder="e.g. RFT-2026-101" mono />
        </Field>
        <Field label="Jurisdiction" required>
          <Select value={form.jurisdiction} onChange={set("jurisdiction")} options={JURISDICTIONS.map((j) => ({ value: j, label: j }))} />
        </Field>
        <Field label="Title" required span2>
          <TextInput value={form.title} onChange={set("title")} />
        </Field>
        <Field label="Client" required>
          <TextInput value={form.clientName} onChange={set("clientName")} />
        </Field>
        <Field label="Closes at" required>
          <TextInput value={form.closesAt} onChange={set("closesAt")} type="datetime-local" />
        </Field>
        <Field label="Scope" span2>
          <TextArea value={form.scope} onChange={set("scope")} />
        </Field>
      </div>
    </Modal>
  );
}

function ProgressClaimModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ projectId: "", claimNumber: "1", periodEnd: "", claimedAmount: "", retentionAmount: "", dueAt: "", breakdown: "" });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const mutation = useMutation(
    () =>
      api("/api/v1/commercial/progress-claims", {
        method: "POST",
        body: {
          projectId: form.projectId,
          claimNumber: Number(form.claimNumber),
          periodEnd: isoDateOnly(form.periodEnd),
          claimedAmount: Number(form.claimedAmount),
          retentionAmount: form.retentionAmount ? Number(form.retentionAmount) : undefined,
          dueAt: form.dueAt ? isoDateOnly(form.dueAt) : undefined,
          breakdown: form.breakdown
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
              const [item, amount] = line.split("|").map((part) => part.trim());
              return { item, amount: amount ? Number(amount) : undefined };
            }),
        },
      }),
    [],
  );
  return (
    <Modal
      title="New progress claim"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || !form.projectId || !form.periodEnd || !form.claimedAmount}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push("Progress claim recorded");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Saving…" : "Record claim"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <div className="form-grid">
        <Field label="Project" required>
          <ProjectSelect value={form.projectId} onChange={set("projectId")} allowEmpty emptyLabel="— Select project —" />
        </Field>
        <Field label="Claim number" required>
          <TextInput value={form.claimNumber} onChange={set("claimNumber")} type="number" min={1} inputMode="numeric" />
        </Field>
        <Field label="Period end" required>
          <TextInput value={form.periodEnd} onChange={set("periodEnd")} type="date" />
        </Field>
        <Field label="Claimed amount (AUD)" required>
          <TextInput value={form.claimedAmount} onChange={set("claimedAmount")} type="number" min={0} inputMode="decimal" />
        </Field>
        <Field label="Retention (AUD)">
          <TextInput value={form.retentionAmount} onChange={set("retentionAmount")} type="number" min={0} inputMode="decimal" />
        </Field>
        <Field label="Payment due">
          <TextInput value={form.dueAt} onChange={set("dueAt")} type="date" />
        </Field>
        <Field label="Breakdown (item | amount, one per line)" span2>
          <TextArea value={form.breakdown} onChange={set("breakdown")} rows={4} placeholder={"Earthworks | 42000\nDrainage | 18500"} />
        </Field>
      </div>
    </Modal>
  );
}

function VariationModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ projectId: "", reference: "", title: "", description: "", cause: "", quotedAmount: "", extensionDays: "" });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const mutation = useMutation(
    () =>
      api("/api/v1/commercial/variations", {
        method: "POST",
        body: {
          projectId: form.projectId,
          reference: form.reference.trim(),
          title: form.title.trim(),
          description: form.description.trim(),
          cause: form.cause.trim() || undefined,
          noticeDate: new Date().toISOString(),
          quotedAmount: form.quotedAmount ? Number(form.quotedAmount) : undefined,
          extensionDays: form.extensionDays ? Number(form.extensionDays) : undefined,
        },
      }),
    [],
  );
  return (
    <Modal
      title="New variation"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || !form.projectId || !form.reference.trim() || !form.title.trim() || !form.description.trim()}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push("Variation recorded");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Saving…" : "Record variation"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <div className="form-grid">
        <Field label="Project" required>
          <ProjectSelect value={form.projectId} onChange={set("projectId")} allowEmpty emptyLabel="— Select project —" />
        </Field>
        <Field label="Reference" required>
          <TextInput value={form.reference} onChange={set("reference")} placeholder="e.g. VO-004" mono />
        </Field>
        <Field label="Title" required span2>
          <TextInput value={form.title} onChange={set("title")} />
        </Field>
        <Field label="Description" required span2>
          <TextArea value={form.description} onChange={set("description")} />
        </Field>
        <Field label="Cause">
          <TextInput value={form.cause} onChange={set("cause")} placeholder="e.g. Latent condition" />
        </Field>
        <Field label="Quoted amount (AUD)">
          <TextInput value={form.quotedAmount} onChange={set("quotedAmount")} type="number" inputMode="decimal" />
        </Field>
        <Field label="EOT days">
          <TextInput value={form.extensionDays} onChange={set("extensionDays")} type="number" inputMode="numeric" />
        </Field>
      </div>
    </Modal>
  );
}

export function CommercialPage() {
  const [creatingTender, setCreatingTender] = useState(false);
  const [creatingClaim, setCreatingClaim] = useState(false);
  const [creatingVariation, setCreatingVariation] = useState(false);
  const [openId, setOpenId] = useState("");
  const tenders = listRecents("tenders");

  return (
    <Layout
      title="Tenders & claims"
      actions={
        <div className="row">
          <button className="btn btn-ghost" onClick={() => setCreatingClaim(true)}>
            Progress claim
          </button>
          <button className="btn btn-ghost" onClick={() => setCreatingVariation(true)}>
            Variation
          </button>
          <button className="btn btn-primary" onClick={() => setCreatingTender(true)}>
            <Icon name="plus" size={15} /> New tender
          </button>
        </div>
      }
    >
      <section className="card">
        <div className="card-header">
          <h2>Tenders (this device)</h2>
          <span className="hint">Upload tender documents to auto-extract a review checklist.</span>
        </div>
        <div className="card-pad stack">
          <div className="row">
            <input
              className="input mono"
              style={{ maxWidth: 340 }}
              placeholder="Open tender by ID…"
              value={openId}
              onChange={(e: { target: { value: string } }) => setOpenId(e.target.value)}
            />
            <button className="btn btn-ghost" disabled={!openId.trim()} onClick={() => navigate(`/commercial/tenders/${openId.trim()}`)}>
              Open
            </button>
          </div>
          {tenders.length === 0 ? (
            <EmptyState
              title="No tenders tracked on this device"
              hint="Create a tender, upload RFT documents (PDF, DOCX, XLSX, CSV) and review the extracted requirements."
              action={
                <button className="btn btn-primary" onClick={() => setCreatingTender(true)}>
                  <Icon name="plus" size={15} /> New tender
                </button>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {tenders.map((tender) => (
                    <tr key={tender.id}>
                      <td>
                        <b>{tender.label}</b>
                        <div className="mono tiny">{tender.id}</div>
                      </td>
                      <td className="tiny">{tender.sublabel}</td>
                      <td style={{ textAlign: "right" }}>
                        <Link to={`/commercial/tenders/${tender.id}`} className="btn btn-ghost btn-sm">
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-2">
        <section className="card card-pad stack">
          <h2>Progress claims</h2>
          <p className="muted">
            Record claims with retention and payment dates per project. Security-of-payment timing rules vary by
            state — configure per project and check with your advisers.
          </p>
          <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setCreatingClaim(true)}>
            <Icon name="plus" size={14} /> Record claim
          </button>
        </section>
        <section className="card card-pad stack">
          <h2>Variations</h2>
          <p className="muted">Capture variation notices with cause, quoted amount and extension-of-time days.</p>
          <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setCreatingVariation(true)}>
            <Icon name="plus" size={14} /> Record variation
          </button>
        </section>
      </div>

      {creatingTender && <CreateTenderModal onClose={() => setCreatingTender(false)} />}
      {creatingClaim && <ProgressClaimModal onClose={() => setCreatingClaim(false)} />}
      {creatingVariation && <VariationModal onClose={() => setCreatingVariation(false)} />}
    </Layout>
  );
}
