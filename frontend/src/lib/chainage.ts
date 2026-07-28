import type { ChainageAlignment } from "./types.ts";

export const CHAINAGE_SIDES = ["LEFT", "CENTRE", "RIGHT", "BOTH", "UNKNOWN"] as const;
export const CHAINAGE_CATEGORIES = ["ISSUE", "DEFECT", "SCOPE", "QUOTE", "PHOTO_RECORD", "ACCESS", "UTILITY", "DRAINAGE"] as const;
export const CHAINAGE_STATUSES = ["OPEN", "IN_REVIEW", "PRICED", "ACTIONED", "CLOSED"] as const;

export type ChainageStatus = (typeof CHAINAGE_STATUSES)[number];

export function toNumber(value?: string | number | null): number {
  if (value === null || value === undefined || value === "") return 0;
  return typeof value === "number" ? value : Number(value);
}

export function formatChainage(metres?: string | number | null): string {
  const value = toNumber(metres);
  if (!Number.isFinite(value)) return "-";
  const km = Math.floor(value / 1000);
  const m = Math.round(value - km * 1000);
  return `${km}+${String(m).padStart(3, "0")}`;
}

export function parseChainage(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;
  if (trimmed.includes("+")) {
    const parts = trimmed.split("+");
    if (parts.length !== 2) return Number.NaN;
    const km = Number(parts[0].trim());
    const metres = Number(parts[1].trim());
    if (!Number.isFinite(km) || !Number.isFinite(metres) || metres < 0 || metres >= 1000) return Number.NaN;
    return km * 1000 + metres;
  }
  return Number(trimmed);
}

export function parseGeometry(text: string): ChainageAlignment["geometry"] | undefined {
  const coordinates = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(",").map((part) => Number(part.trim())))
    .filter((parts) => parts.length >= 2 && parts.every(Number.isFinite))
    .map(([lat, lng]) => [lng, lat] as [number, number])
    .filter(([longitude, latitude]) => longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90);
  return coordinates.length >= 2 ? { type: "LineString", coordinates } : undefined;
}

export function haversineM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const r = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

export function nearestChainage(alignment: ChainageAlignment | undefined, point: { latitude: number; longitude: number }) {
  const coords = alignment?.geometry?.coordinates ?? [];
  if (!alignment || coords.length < 2) return null;
  const points = coords.map(([longitude, latitude]) => ({ latitude, longitude }));
  const total = points.slice(1).reduce((sum, item, index) => sum + haversineM(points[index], item), 0);
  if (total <= 0) return null;
  const originLat = point.latitude;
  const toXY = (p: { latitude: number; longitude: number }) => ({
    x: (p.longitude - point.longitude) * 111320 * Math.cos((originLat * Math.PI) / 180),
    y: (p.latitude - point.latitude) * 110540,
  });
  let best = { distanceM: Number.POSITIVE_INFINITY, alongM: 0 };
  let traversed = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const ax = toXY(a).x;
    const ay = toXY(a).y;
    const bx = toXY(b).x;
    const by = toXY(b).y;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
    const px = ax + dx * t;
    const py = ay + dy * t;
    const distanceM = Math.sqrt(px * px + py * py);
    const segLen = haversineM(a, b);
    if (distanceM < best.distanceM) best = { distanceM, alongM: traversed + segLen * t };
    traversed += segLen;
  }
  const start = toNumber(alignment.startChainageM);
  const end = toNumber(alignment.endChainageM);
  return { chainageM: start + (best.alongM / total) * (end - start), distanceM: best.distanceM };
}

export function interpolateChainagePosition(alignment: ChainageAlignment | undefined, chainageM: string | number) {
  const coords = alignment?.geometry?.coordinates ?? [];
  if (!alignment || coords.length < 2) return null;
  const start = toNumber(alignment.startChainageM);
  const end = toNumber(alignment.endChainageM);
  const fraction = Math.min(1, Math.max(0, (toNumber(chainageM) - start) / Math.max(1, end - start)));
  const points = coords.map(([longitude, latitude]) => ({ latitude, longitude }));
  const lengths = points.slice(1).map((item, index) => haversineM(points[index], item));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  let target = total * fraction;
  for (let i = 0; i < lengths.length; i += 1) {
    if (target <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] > 0 ? target / lengths[i] : 0;
      const a = points[i];
      const b = points[i + 1];
      return { latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t };
    }
    target -= lengths[i];
  }
  return points[0];
}
