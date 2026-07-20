import { useEffect, useState } from "react";
import { Layout } from "../../components/Layout.tsx";
import { EmptyState, ErrorAlert, Loading, Select, StatusBadge, TextInput } from "../../components/ui.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { Link } from "../../lib/router.tsx";
import type { InspectionResult, PaginatedResult, PlantPreStartSummary } from "../../lib/types.ts";
import { useApiQuery } from "../../lib/useApi.ts";

const PAGE_SIZE = 10;
const RESULT_OPTIONS: InspectionResult[] = ["PASS", "DEFECT", "OUT_OF_SERVICE"];

function workerName(item: PlantPreStartSummary) {
  return item.worker ? `${item.worker.firstName} ${item.worker.lastName}`.trim() : "Worker";
}

export function CompletedPreStartsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [result, setResult] = useState("");
  const { data, loading, error } = useApiQuery<PaginatedResult<PlantPreStartSummary>>("/api/v1/plant/completed-pre-starts", {
    page,
    pageSize: PAGE_SIZE,
    search: search.trim() || undefined,
    result: result || undefined,
  });
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => setPage(1), [search, result]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  return (
    <Layout title="Completed Pre-starts">
      <div className="filter-row">
        <TextInput value={search} onChange={setSearch} placeholder="Search asset, plant type or worker" />
        <Select value={result} onChange={setResult} options={RESULT_OPTIONS} allowEmpty emptyLabel="All results" />
      </div>
      <ErrorAlert error={error} />
      {loading && !data && <Loading />}
      {!loading && rows.length === 0 && (
        <div className="card">
          <EmptyState title="No completed pre-starts" hint="Submitted pre-starts will appear here when they match your filters." />
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
                <Link className="prestart-history-row completed" key={item.id} to={`/plant/pre-starts/${item.id}`}>
                  <div>
                    <b className="mono">{plant.assetNumber}</b>
                    <span>{plant.type}</span>
                  </div>
                  <div>
                    <span className="tiny">Make / model</span>
                    <b>{makeModel}</b>
                  </div>
                  <div>
                    <span className="tiny">Worker</span>
                    <b>{workerName(item)}</b>
                    {item.worker?.employeeNumber && <span className="muted">{item.worker.employeeNumber}</span>}
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
            <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span className="tiny">
              Page {page} of {pageCount} · {total} pre-start{total === 1 ? "" : "s"}
            </span>
            <button className="btn btn-ghost btn-sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        </>
      )}
    </Layout>
  );
}
