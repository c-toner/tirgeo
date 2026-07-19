import { useState } from "react";
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
  TextArea,
  TextInput,
  useToast,
} from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { formatDate } from "../../lib/format.ts";
import type { PreStartQuestion, PreStartSection, PreStartTemplate } from "../../lib/types.ts";
import { useApiQuery, useMutation } from "../../lib/useApi.ts";

const QUESTION_TYPES = [
  { value: "PASS_FAIL_NA", label: "Pass / Fail / N.A." },
  { value: "BOOLEAN", label: "Yes / No" },
  { value: "TEXT", label: "Free text" },
  { value: "NUMBER", label: "Number" },
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function emptyQuestion(): PreStartQuestion {
  return { id: "", label: "", guidance: "", type: "PASS_FAIL_NA", required: true, defectOn: ["FAIL"] };
}

function TemplateEditor({
  template,
  onClose,
}: {
  template: PreStartTemplate | null; // null = create new
  onClose: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(template?.name ?? "");
  const [plantType, setPlantType] = useState(template?.plantType ?? "");
  const [sections, setSections] = useState<PreStartSection[]>(
    template?.sections ?? [{ id: "checks", title: "Checks", questions: [emptyQuestion()] }],
  );

  const patchSection = (index: number, patch: Partial<PreStartSection>) =>
    setSections((list) => list.map((section, i) => (i === index ? { ...section, ...patch } : section)));
  const patchQuestion = (sectionIndex: number, questionIndex: number, patch: Partial<PreStartQuestion>) =>
    setSections((list) =>
      list.map((section, i) =>
        i === sectionIndex
          ? { ...section, questions: section.questions.map((question, j) => (j === questionIndex ? { ...question, ...patch } : question)) }
          : section,
      ),
    );

  const preparedSections = sections
    .map((section) => ({
      ...section,
      id: section.id || slugify(section.title) || "section",
      questions: section.questions
        .filter((question) => question.label.trim().length >= 2)
        .map((question) => ({
          ...question,
          id: question.id || slugify(question.label),
          guidance: question.guidance?.trim() || undefined,
          defectOn:
            question.type === "PASS_FAIL_NA" ? ["FAIL"] : question.type === "BOOLEAN" ? question.defectOn.filter((v) => typeof v === "boolean") : [],
        })),
    }))
    .filter((section) => section.questions.length > 0);

  const mutation = useMutation(
    () =>
      template
        ? api<PreStartTemplate>(`/api/v1/plant/pre-start-templates/${template.id}`, {
            method: "PATCH",
            body: { plantType: plantType.trim() || null, sections: preparedSections },
          })
        : api<PreStartTemplate>("/api/v1/plant/pre-start-templates", {
            method: "POST",
            body: { name: name.trim(), plantType: plantType.trim() || undefined, sections: preparedSections },
          }),
    ["/api/v1/plant/pre-start-templates"],
  );

  return (
    <Modal
      title={template ? `Edit draft — ${template.name} v${template.version}` : "New pre-start template"}
      large
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.running || (!template && name.trim().length < 2) || preparedSections.length === 0}
            onClick={() =>
              mutation.run({
                onSuccess: () => {
                  toast.push(template ? "Draft updated" : "Draft template created — publish it to use in the field");
                  onClose();
                },
              })
            }
          >
            {mutation.running ? "Saving…" : template ? "Save draft" : "Create draft"}
          </button>
        </>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <div className="form-grid">
        {!template && (
          <Field label="Template name" required hint="Re-using a name creates the next version.">
            <TextInput value={name} onChange={setName} placeholder="e.g. Excavator Pre-Start" />
          </Field>
        )}
        <Field label="Plant type match (blank = default)" hint="Assets with this plant type automatically use this checklist. Leave blank for the generic fallback.">
          <TextInput value={plantType} onChange={setPlantType} placeholder="Excavator, tracked machine, quick cut saw" />
        </Field>
      </div>

      {sections.map((section, sectionIndex) => (
        <div key={sectionIndex} className="card card-pad stack" style={{ boxShadow: "none" }}>
          <div className="row-between">
            <Field label="Section title">
              <TextInput value={section.title} onChange={(value) => patchSection(sectionIndex, { title: value })} />
            </Field>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setSections((list) => list.filter((_, i) => i !== sectionIndex))}
              disabled={sections.length === 1}
            >
              Remove section
            </button>
          </div>
          {section.questions.map((question, questionIndex) => (
            <div key={questionIndex} className="checklist-q">
              <div className="form-grid">
                <Field label="Question" required>
                  <TextInput value={question.label} onChange={(value) => patchQuestion(sectionIndex, questionIndex, { label: value })} />
                </Field>
                <Field label="Answer type">
                  <Select
                    value={question.type}
                    onChange={(value) =>
                      patchQuestion(sectionIndex, questionIndex, {
                        type: value as PreStartQuestion["type"],
                        defectOn: value === "PASS_FAIL_NA" ? ["FAIL"] : [],
                      })
                    }
                    options={QUESTION_TYPES}
                  />
                </Field>
                <Field label="Guidance" span2>
                  <TextArea value={question.guidance ?? ""} onChange={(value) => patchQuestion(sectionIndex, questionIndex, { guidance: value })} rows={2} />
                </Field>
              </div>
              <div className="row-between">
                <div className="row" style={{ gap: 14 }}>
                  <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
                    <input
                      type="checkbox"
                      checked={question.required}
                      onChange={(e: { target: { checked: boolean } }) => patchQuestion(sectionIndex, questionIndex, { required: e.target.checked })}
                    />
                    Required
                  </label>
                  {question.type === "PASS_FAIL_NA" && <span className="tiny">FAIL answers trigger a defect record.</span>}
                  {question.type === "BOOLEAN" && (
                    <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
                      <input
                        type="checkbox"
                        checked={question.defectOn.includes(true)}
                        onChange={(e: { target: { checked: boolean } }) => patchQuestion(sectionIndex, questionIndex, { defectOn: e.target.checked ? [true] : [] })}
                      />
                      “Yes” triggers a defect
                    </label>
                  )}
                </div>
                <button
                  className="btn-icon"
                  aria-label="Remove question"
                  onClick={() =>
                    patchSection(sectionIndex, { questions: section.questions.filter((_, j) => j !== questionIndex) })
                  }
                  disabled={section.questions.length === 1}
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            </div>
          ))}
          <button
            className="btn btn-ghost btn-sm"
            style={{ alignSelf: "flex-start" }}
            onClick={() => patchSection(sectionIndex, { questions: [...section.questions, emptyQuestion()] })}
          >
            <Icon name="plus" size={13} /> Add question
          </button>
        </div>
      ))}
      <button
        className="btn btn-ghost"
        style={{ alignSelf: "flex-start" }}
        onClick={() => setSections((list) => [...list, { id: "", title: "New section", questions: [emptyQuestion()] }])}
      >
        <Icon name="plus" size={14} /> Add section
      </button>
    </Modal>
  );
}

export function TemplatesPage() {
  const toast = useToast();
  const { data, loading, error, refresh } = useApiQuery<PreStartTemplate[]>("/api/v1/plant/pre-start-templates/manage");
  const [editing, setEditing] = useState<PreStartTemplate | null | "new">(null);

  const publish = async (template: PreStartTemplate) => {
    try {
      await api(`/api/v1/plant/pre-start-templates/${template.id}/publish`, { method: "POST" });
      toast.push(`${template.name} v${template.version} published`);
      refresh();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Publish failed", "error");
    }
  };

  return (
    <Layout
      title="Pre-start templates"
      actions={
        <button className="btn btn-primary" onClick={() => setEditing("new")}>
          <Icon name="plus" size={15} /> New template
        </button>
      }
    >
      <div className="alert alert-info">
        Published versions are immutable — field inspections are always bound to the exact question set the operator
        answered. Editing is only possible while a version is in draft; re-using a name creates the next version.
      </div>

      <ErrorAlert error={error} />
      {loading && !data && <Loading />}
      {data && data.length === 0 && (
        <div className="card">
          <EmptyState title="No templates" hint="Seeded organisations include a Generic Plant Pre-Start; create tailored templates per plant type here." />
        </div>
      )}

      {data && data.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Template</th>
                <th>Plant type</th>
                <th className="num">Version</th>
                <th className="num">Questions</th>
                <th>Status</th>
                <th>Published</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((template) => (
                <tr key={template.id}>
                  <td>
                    <b>{template.name}</b>
                  </td>
                  <td>{template.plantType ?? <span className="badge no-dot">Generic</span>}</td>
                  <td className="num">v{template.version}</td>
                  <td className="num">{template.sections.reduce((sum, section) => sum + section.questions.length, 0)}</td>
                  <td>
                    <StatusBadge status={template.status} />
                  </td>
                  <td className="tiny">{formatDate(template.publishedAt)}</td>
                  <td>
                    {template.status === "DRAFT" && (
                      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(template)}>
                          Edit
                        </button>
                        <button className="btn btn-primary btn-sm" onClick={() => publish(template)}>
                          Publish
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing !== null && <TemplateEditor template={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Layout>
  );
}
