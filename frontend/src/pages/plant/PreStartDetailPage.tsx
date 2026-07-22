import { Layout } from "../../components/Layout.tsx";
import { FileImageLink } from "../../components/FileImage.tsx";
import { EmptyState, ErrorAlert, Loading, StatusBadge } from "../../components/ui.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { Link } from "../../lib/router.tsx";
import type { PlantPreStartDetail, PreStartDefect, PreStartQuestion } from "../../lib/types.ts";
import { useApiQuery } from "../../lib/useApi.ts";

function workerName(preStart: PlantPreStartDetail) {
  return `${preStart.worker.firstName} ${preStart.worker.lastName}`.trim();
}

function answerText(question: PreStartQuestion, value: boolean | string | number | null | undefined): string {
  if (value === undefined || value === null || value === "") return "Not answered";
  if (question.type === "BOOLEAN") return value ? "Yes" : "No";
  return String(value);
}

function answerTone(question: PreStartQuestion, value: boolean | string | number | null | undefined): string {
  return question.defectOn.some((trigger) => trigger === value) ? "answer-fail" : value === undefined || value === null || value === "" ? "" : "answer-pass";
}

function defectsForQuestion(defects: PreStartDefect[] | null | undefined, questionId: string) {
  return (defects ?? []).filter((defect) => defect.questionId === questionId);
}

export function PreStartDetailPage({ preStartId }: { preStartId: string }) {
  const { data, loading, error } = useApiQuery<PlantPreStartDetail>(`/api/v1/plant/pre-starts/${preStartId}`);

  return (
    <Layout title="Pre-start detail">
      <div className="row">
        <Link to="/plant" className="btn btn-ghost btn-sm">
          Back to plant
        </Link>
      </div>
      <ErrorAlert error={error} />
      {loading && !data && <Loading />}
      {!loading && !data && !error && <EmptyState title="Pre-start not found" hint="It may have been removed or you may not have permission to view it." />}
      {data && (
        <article className="stack prestart-detail">
          <section className="card card-pad stack">
            <div className="row-between">
              <div>
                <h2>
                  {data.plant.assetNumber} · {data.plant.type}
                </h2>
                <p className="muted">{[data.plant.make, data.plant.model].filter(Boolean).join(" ") || "Make / model not recorded"}</p>
              </div>
              <StatusBadge status={data.result} />
            </div>
            <div className="detail-grid">
              <div>
                <span className="tiny">Completed</span>
                <b>{formatDateTime(data.inspectedAt)}</b>
              </div>
              <div>
                <span className="tiny">Worker</span>
                <b>{workerName(data)}</b>
                <span className="muted">{data.worker.employeeNumber}</span>
              </div>
              <div>
                <span className="tiny">Location</span>
                <b>{data.project ? `${data.project.code} · ${data.project.name}` : data.plant.currentProject ? `${data.plant.currentProject.code} · ${data.plant.currentProject.name}` : "Not project-specific"}</b>
              </div>
              <div>
                <span className="tiny">Hour meter</span>
                <b>{data.hourMeter ?? "Not recorded"}</b>
              </div>
              <div>
                <span className="tiny">Checklist</span>
                <b>{data.checklistVersion}</b>
              </div>
            </div>
          </section>

          {data.checklistTemplate ? (
            data.checklistTemplate.sections.map((section) => (
              <section className="card card-pad stack" key={section.id}>
                <h3>{section.title}</h3>
                <div className="answer-list">
                  {section.questions.map((question) => {
                    const value = data.answers[question.id];
                    const defects = defectsForQuestion(data.defects, question.id);
                    return (
                      <div className="answer-row" key={question.id}>
                        <div>
                          <b>{question.label}</b>
                          {question.guidance && <span className="tiny">{question.guidance}</span>}
                        </div>
                        <span className={`answer-pill ${answerTone(question, value)}`}>{answerText(question, value)}</span>
                        {defects.length > 0 && (
                          <div className="defect-detail">
                            {defects.map((defect, index) => (
                              <div key={`${defect.questionId}-${index}`}>
                                <b>{defect.item}</b>
                                <StatusBadge status={defect.severity} />
                                <p>{defect.detail}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          ) : (
            <section className="card card-pad stack">
              <h3>Checklist answers</h3>
              <pre className="json-block">{JSON.stringify(data.answers, null, 2)}</pre>
            </section>
          )}

          <section className="card card-pad stack">
            <h3>Pictures</h3>
            {data.photos.length === 0 ? (
              <p className="muted">No pictures were attached to this pre-start.</p>
            ) : (
              <div className="prestart-photo-grid">
                {data.photos.map((photo) => (
                  <FileImageLink key={photo.id} file={photo} className="prestart-photo">
                    {(url) => (
                      <>
                        <img src={url} alt={photo.originalName} />
                        <span>{photo.originalName}</span>
                      </>
                    )}
                  </FileImageLink>
                ))}
              </div>
            )}
          </section>
        </article>
      )}
    </Layout>
  );
}
