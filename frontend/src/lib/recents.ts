// The backend does not yet expose list endpoints for some records (tenders,
// timesheets, incidents, daily reports, safety documents). Until it does, the
// app keeps a per-organisation "recent records" index in localStorage so work
// created on this device stays reachable. This is a UX convenience only — the
// server remains the source of truth and any record can be opened by ID.

import { getStoredOrganisationId } from "./api.ts";

export interface RecentRecord {
  id: string;
  label: string;
  sublabel?: string;
  status?: string;
  savedAt: string;
}

function storageKey(kind: string): string {
  return `tirgeo.recent.${getStoredOrganisationId() || "default"}.${kind}`;
}

export function listRecents(kind: string): RecentRecord[] {
  try {
    const raw = localStorage.getItem(storageKey(kind));
    return raw ? (JSON.parse(raw) as RecentRecord[]) : [];
  } catch {
    return [];
  }
}

export function rememberRecent(kind: string, record: Omit<RecentRecord, "savedAt">) {
  const existing = listRecents(kind).filter((r) => r.id !== record.id);
  const next = [{ ...record, savedAt: new Date().toISOString() }, ...existing].slice(0, 50);
  localStorage.setItem(storageKey(kind), JSON.stringify(next));
}

export function updateRecent(kind: string, id: string, patch: Partial<RecentRecord>) {
  const next = listRecents(kind).map((r) => (r.id === id ? { ...r, ...patch } : r));
  localStorage.setItem(storageKey(kind), JSON.stringify(next));
}

export function forgetRecent(kind: string, id: string) {
  localStorage.setItem(storageKey(kind), JSON.stringify(listRecents(kind).filter((r) => r.id !== id)));
}

// Optional per-device worker override. Normal forms use the worker directory and
// the signed-in user's linked worker by default.
const WORKER_KEY = "tirgeo.workerId";

export function getMyWorkerId(): string {
  return localStorage.getItem(`${WORKER_KEY}.${getStoredOrganisationId() || "default"}`) ?? "";
}

export function setMyWorkerId(id: string) {
  const key = `${WORKER_KEY}.${getStoredOrganisationId() || "default"}`;
  if (id.trim()) localStorage.setItem(key, id.trim());
  else localStorage.removeItem(key);
}
