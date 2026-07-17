import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/auth.tsx";
import type { WorkerSummary } from "../lib/types.ts";
import { useApiQuery } from "../lib/useApi.ts";
import { Icon, TextInput } from "./ui.tsx";

function workerName(worker: WorkerSummary): string {
  return `${worker.firstName} ${worker.lastName}`.trim();
}

function workerLabel(worker: WorkerSummary): string {
  const bits = [worker.employeeNumber, worker.classification].filter(Boolean);
  return `${workerName(worker)}${bits.length ? ` (${bits.join(" · ")})` : ""}`;
}

function matches(worker: WorkerSummary, query: string): boolean {
  const haystack = [worker.firstName, worker.lastName, worker.employeeNumber, worker.classification, worker.employmentType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

function sortWorkers(workers: WorkerSummary[], currentWorkerId?: string | null): WorkerSummary[] {
  return [...workers].sort((a, b) => {
    const aCurrent = a.isCurrentUser || a.id === currentWorkerId;
    const bCurrent = b.isCurrentUser || b.id === currentWorkerId;
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
    return workerName(a).localeCompare(workerName(b)) || a.employeeNumber.localeCompare(b.employeeNumber);
  });
}

export function WorkerSelect({
  value,
  onChange,
  allowEmpty,
  emptyLabel = "No worker selected",
  placeholder = "Search workers",
  autoSelectCurrent = true,
}: {
  value: string;
  onChange: (workerId: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  placeholder?: string;
  autoSelectCurrent?: boolean;
}) {
  const { user } = useAuth();
  const { data } = useApiQuery<WorkerSummary[]>("/api/v1/workers");
  const [query, setQuery] = useState("");
  const currentWorker = data?.find((worker) => worker.isCurrentUser) ?? user?.worker ?? null;
  const currentWorkerId = currentWorker?.id;
  const workers = useMemo(() => sortWorkers(data ?? [], currentWorkerId), [data, currentWorkerId]);
  const selected = workers.find((worker) => worker.id === value) ?? (currentWorker?.id === value ? currentWorker : null);
  const filtered = query ? workers.filter((worker) => matches(worker, query)) : workers;

  useEffect(() => {
    if (autoSelectCurrent && !allowEmpty && !value && currentWorkerId) onChange(currentWorkerId);
  }, [allowEmpty, autoSelectCurrent, currentWorkerId, onChange, value]);

  return (
    <div className="worker-select">
      <TextInput value={query} onChange={setQuery} placeholder={selected ? workerLabel(selected) : placeholder} />
      <div className="worker-options" role="listbox">
        {allowEmpty && (
          <button type="button" className={!value ? "active" : ""} onClick={() => onChange("")}>
            <span>{emptyLabel}</span>
          </button>
        )}
        {filtered.map((worker) => (
          <button
            key={worker.id}
            type="button"
            className={worker.id === value ? "active" : ""}
            onClick={() => {
              onChange(worker.id);
              setQuery("");
            }}
          >
            <span>
              {workerName(worker)}
              {(worker.isCurrentUser || worker.id === currentWorkerId) && <em>Me</em>}
            </span>
            <small>
              {worker.employeeNumber}
              {worker.classification ? ` · ${worker.classification}` : ""}
            </small>
          </button>
        ))}
        {filtered.length === 0 && <div className="worker-empty">No workers match that search.</div>}
      </div>
    </div>
  );
}

export function WorkerMultiSelect({
  value,
  onChange,
  placeholder = "Search workers",
}: {
  value: string[];
  onChange: (workerIds: string[]) => void;
  placeholder?: string;
}) {
  const { user } = useAuth();
  const { data } = useApiQuery<WorkerSummary[]>("/api/v1/workers");
  const [query, setQuery] = useState("");
  const currentWorkerId = data?.find((worker) => worker.isCurrentUser)?.id ?? user?.worker?.id;
  const workers = useMemo(() => sortWorkers(data ?? [], currentWorkerId), [data, currentWorkerId]);
  const selected = workers.filter((worker) => value.includes(worker.id));
  const filtered = (query ? workers.filter((worker) => matches(worker, query)) : workers).filter((worker) => !value.includes(worker.id));
  const remove = (id: string) => onChange(value.filter((workerId) => workerId !== id));

  return (
    <div className="worker-select">
      {selected.length > 0 && (
        <div className="worker-chips">
          {selected.map((worker) => (
            <button type="button" key={worker.id} onClick={() => remove(worker.id)} aria-label={`Remove ${workerName(worker)}`}>
              {workerName(worker)}
              <Icon name="x" size={12} />
            </button>
          ))}
        </div>
      )}
      <TextInput value={query} onChange={setQuery} placeholder={placeholder} />
      <div className="worker-options" role="listbox">
        {filtered.map((worker) => (
          <button
            key={worker.id}
            type="button"
            onClick={() => {
              onChange([...value, worker.id]);
              setQuery("");
            }}
          >
            <span>
              {workerName(worker)}
              {(worker.isCurrentUser || worker.id === currentWorkerId) && <em>Me</em>}
            </span>
            <small>
              {worker.employeeNumber}
              {worker.classification ? ` · ${worker.classification}` : ""}
            </small>
          </button>
        ))}
        {filtered.length === 0 && <div className="worker-empty">No more workers match that search.</div>}
      </div>
    </div>
  );
}
