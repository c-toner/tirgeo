import { useEffect, useMemo, useState } from "react";
import { Layout } from "../components/Layout.tsx";
import { ProjectSelect } from "../components/ProjectSelect.tsx";
import { EmptyState, ErrorAlert, Field, Icon, Loading, Modal, Select, StatusBadge, TextArea, TextInput, useToast } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { formatDateTime, titleCase } from "../lib/format.ts";
import type { ChainageAlignment, ChainageObservation, FileAsset } from "../lib/types.ts";
import { useApiQuery, useMutation } from "../lib/useApi.ts";

const SIDES = ["LEFT", "CENTRE", "RIGHT", "BOTH", "UNKNOWN"];
const CATEGORIES = ["ISSUE", "DEFECT", "SCOPE", "QUOTE", "PHOTO_RECORD", "ACCESS", "UTILITY", "DRAINAGE"];
const TILE_SIZE = 256;
const MAP_W = 720;
const MAP_H = 440;
const DEFAULT_CENTER = { latitude: -32.9283, longitude: 151.7817 };

function toNumber(value?: string | number | null): number {
  if (value === null || value === undefined || value === "") return 0;
  return typeof value === "number" ? value : Number(value);
}

function formatChainage(metres?: string | number | null): string {
  const value = toNumber(metres);
  if (!Number.isFinite(value)) return "-";
  const km = Math.floor(value / 1000);
  const m = Math.round(value - km * 1000);
  return `${km}+${String(m).padStart(3, "0")}`;
}

function parseChainage(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;
  if (trimmed.includes("+")) {
    const [km, metres] = trimmed.split("+").map((part) => Number(part.trim()));
    return km * 1000 + metres;
  }
  return Number(trimmed);
}

function parseGeometry(text: string): ChainageAlignment["geometry"] | undefined {
  const coordinates = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(",").map((part) => Number(part.trim())))
    .filter((parts) => parts.length >= 2 && parts.every(Number.isFinite))
    .map(([lat, lng]) => [lng, lat] as [number, number]);
  return coordinates.length >= 2 ? { type: "LineString", coordinates } : undefined;
}

function latLngToWorld(latitude: number, longitude: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const sinLat = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

function worldToLatLng(x: number, y: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const longitude = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const latitude = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { latitude, longitude };
}

function haversineM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const r = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function nearestChainage(alignment: ChainageAlignment | undefined, point: { latitude: number; longitude: number }) {
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

function interpolateChainagePosition(alignment: ChainageAlignment | undefined, chainageM: string | number) {
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

type WorkMapMarkerItem = { item: ChainageObservation; screen: { left: number; top: number } };
type WorkMapRenderItem =
  | ({ type: "marker"; key: string } & WorkMapMarkerItem)
  | { type: "cluster"; key: string; screen: { left: number; top: number }; count: number };

function WorkMap({
  alignment,
  observations,
  draft,
  onPick,
  onUseLocation,
  onSelectObservation,
}: {
  alignment?: ChainageAlignment;
  observations: ChainageObservation[];
  draft?: { latitude: number; longitude: number } | null;
  onPick: (point: { latitude: number; longitude: number; chainageM?: number; snapDistanceM?: number }) => void;
  onUseLocation: () => void;
  onSelectObservation?: (id: string) => void;
}) {
  const initialCenter = useMemo(() => {
    const firstCoord = alignment?.geometry?.coordinates?.[0];
    const firstObservation = observations.find((item) => item.latitude && item.longitude);
    if (firstObservation) return { latitude: toNumber(firstObservation.latitude), longitude: toNumber(firstObservation.longitude) };
    if (firstCoord) return { latitude: firstCoord[1], longitude: firstCoord[0] };
    return DEFAULT_CENTER;
  }, [alignment, observations]);
  const [center, setCenter] = useState(initialCenter);
  const [zoom, setZoom] = useState(15);

  useEffect(() => setCenter(initialCenter), [initialCenter]);

  const centerWorld = latLngToWorld(center.latitude, center.longitude, zoom);
  const topLeft = { x: centerWorld.x - MAP_W / 2, y: centerWorld.y - MAP_H / 2 };
  const tileMinX = Math.floor(topLeft.x / TILE_SIZE);
  const tileMaxX = Math.floor((topLeft.x + MAP_W) / TILE_SIZE);
  const tileMinY = Math.floor(topLeft.y / TILE_SIZE);
  const tileMaxY = Math.floor((topLeft.y + MAP_H) / TILE_SIZE);
  const tileCount = 2 ** zoom;
  const tiles = [];
  for (let x = tileMinX; x <= tileMaxX; x += 1) {
    for (let y = tileMinY; y <= tileMaxY; y += 1) {
      if (y < 0 || y >= tileCount) continue;
      const wrappedX = ((x % tileCount) + tileCount) % tileCount;
      tiles.push({ x, y, wrappedX, left: x * TILE_SIZE - topLeft.x, top: y * TILE_SIZE - topLeft.y });
    }
  }
  const toScreen = (latitude: number, longitude: number) => {
    const world = latLngToWorld(latitude, longitude, zoom);
    return { left: world.x - topLeft.x, top: world.y - topLeft.y };
  };
  const linePoints = alignment?.geometry?.coordinates?.map(([longitude, latitude]) => toScreen(latitude, longitude)) ?? [];
  const markerItems = observations
    .map((item) => {
      const latLng = item.latitude && item.longitude ? { latitude: toNumber(item.latitude), longitude: toNumber(item.longitude) } : interpolateChainagePosition(item.alignment, item.chainageM);
      return latLng ? { item, screen: toScreen(latLng.latitude, latLng.longitude) } : null;
    })
    .filter(Boolean) as WorkMapMarkerItem[];
  const mapMarkers = useMemo(() => {
    if (zoom > 13) return markerItems.map((marker): WorkMapRenderItem => ({ type: "marker", key: marker.item.id, ...marker }));
    const groups = new Map<string, Array<{ item: ChainageObservation; screen: { left: number; top: number } }>>();
    const cellSize = 86;
    markerItems.forEach((marker) => {
      const key = `${Math.floor(marker.screen.left / cellSize)}:${Math.floor(marker.screen.top / cellSize)}`;
      groups.set(key, [...(groups.get(key) ?? []), marker]);
    });
    return Array.from(groups.entries()).flatMap<WorkMapRenderItem>(([key, group]) => {
      if (group.length === 1) return [{ type: "marker" as const, key: group[0].item.id, ...group[0] }];
      const screen = group.reduce(
        (sum, marker) => ({ left: sum.left + marker.screen.left / group.length, top: sum.top + marker.screen.top / group.length }),
        { left: 0, top: 0 },
      );
      return [{ type: "cluster" as const, key, screen, count: group.length }];
    });
  }, [markerItems, zoom]);
  const draftScreen = draft ? toScreen(draft.latitude, draft.longitude) : null;

  const pan = (dx: number, dy: number) => {
    const next = worldToLatLng(centerWorld.x + dx, centerWorld.y + dy, zoom);
    setCenter(next);
  };

  return (
    <div className="work-map-shell">
      <div
        className="work-map"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = topLeft.x + ((event.clientX - rect.left) / rect.width) * MAP_W;
          const y = topLeft.y + ((event.clientY - rect.top) / rect.height) * MAP_H;
          const point = worldToLatLng(x, y, zoom);
          const nearest = nearestChainage(alignment, point);
          onPick({ ...point, chainageM: nearest?.chainageM, snapDistanceM: nearest?.distanceM });
        }}
      >
        {tiles.map((tile) => (
          <img
            alt=""
            className="work-map-tile"
            draggable={false}
            key={`${tile.x}-${tile.y}`}
            src={`https://tile.openstreetmap.org/${zoom}/${tile.wrappedX}/${tile.y}.png`}
            style={{ left: tile.left, top: tile.top }}
          />
        ))}
        {linePoints.length > 1 && (
          <svg className="work-map-overlay" viewBox={`0 0 ${MAP_W} ${MAP_H}`}>
            <polyline points={linePoints.map((point) => `${point.left},${point.top}`).join(" ")} className="work-map-alignment" />
          </svg>
        )}
        {mapMarkers.map((marker) =>
          marker.type === "cluster" ? (
            <button
              className="work-map-cluster"
              key={marker.key}
              style={{ left: marker.screen.left, top: marker.screen.top }}
              onClick={(event) => {
                event.stopPropagation();
                setZoom((value) => Math.min(18, value + 2));
              }}
              type="button"
            >
              {marker.count}
            </button>
          ) : (
            <button
              className={`work-map-marker ${marker.item.status.toLowerCase()}`}
              key={marker.item.id}
              style={{ left: marker.screen.left, top: marker.screen.top }}
              onClick={(event) => {
                event.stopPropagation();
                onSelectObservation?.(marker.item.id);
              }}
              type="button"
            >
              <b>{formatChainage(marker.item.chainageM)}</b>
              <span>{marker.item.title}</span>
            </button>
          ),
        )}
        {draftScreen && (
          <div className="work-map-draft-marker" style={{ left: draftScreen.left, top: draftScreen.top }}>
            Draft
          </div>
        )}
        <div className="work-map-attribution">
          &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors
        </div>
      </div>
      <div className="work-map-controls" aria-label="Map controls">
        <button className="btn-icon" onClick={() => setZoom((value) => Math.min(18, value + 1))} aria-label="Zoom in">+</button>
        <button className="btn-icon" onClick={() => setZoom((value) => Math.max(8, value - 1))} aria-label="Zoom out">-</button>
        <button className="btn-icon" onClick={() => pan(0, -160)} aria-label="Pan north">N</button>
        <button className="btn-icon" onClick={() => pan(0, 160)} aria-label="Pan south">S</button>
        <button className="btn-icon" onClick={() => pan(-160, 0)} aria-label="Pan west">W</button>
        <button className="btn-icon" onClick={() => pan(160, 0)} aria-label="Pan east">E</button>
        <button className="btn-icon" onClick={onUseLocation} aria-label="Use current location">GPS</button>
      </div>
      <div className="work-map-caption">
        Tap the map to place a draft work item. If the selected road has geometry, TirGeo will calculate the nearest chainage.
      </div>
    </div>
  );
}

function ChainageObservationDetailModal({ observationId, onClose }: { observationId: string; onClose: () => void }) {
  const [tab, setTab] = useState<"details" | "images" | "location">("details");
  const detailQuery = useApiQuery<ChainageObservation>(`/api/v1/chainage/observations/${observationId}`);
  const item = detailQuery.data;
  const title = item ? `${formatChainage(item.chainageM)} · ${item.title}` : "Chainage detail";

  return (
    <Modal title={title} onClose={onClose} large>
      <div className="tabs chainage-detail-tabs">
        <button className={`tab ${tab === "details" ? "active" : ""}`} onClick={() => setTab("details")} type="button">Details</button>
        <button className={`tab ${tab === "images" ? "active" : ""}`} onClick={() => setTab("images")} type="button">Images ({item?.photos?.length ?? 0})</button>
        <button className={`tab ${tab === "location" ? "active" : ""}`} onClick={() => setTab("location")} type="button">Location</button>
      </div>
      <ErrorAlert error={detailQuery.error} />
      {detailQuery.loading && !item ? (
        <Loading />
      ) : item ? (
        <>
          {tab === "details" && (
            <div className="stack">
              <div className="chainage-detail-hero">
                <div>
                  <span className="tiny">Chainage</span>
                  <b>{formatChainage(item.chainageM)}</b>
                  <span>{item.alignment.name}{item.alignment.roadRef ? ` · ${item.alignment.roadRef}` : ""}</span>
                </div>
                <StatusBadge status={item.status} />
              </div>
              <div className="detail-grid chainage-detail-grid">
                <div><span>Project</span><b>{item.project ? `${item.project.code} · ${item.project.name}` : "Not linked"}</b></div>
                <div><span>Category</span><b>{titleCase(item.category)}</b></div>
                <div><span>Side / offset</span><b>{titleCase(item.side)}{item.offsetM ? ` · ${item.offsetM} m` : ""}</b></div>
                <div><span>Recorded</span><b>{formatDateTime(item.observedAt)}</b></div>
                <div><span>Recorded by</span><b>{item.createdBy?.name ?? "Unknown"}</b></div>
                <div><span>GPS accuracy</span><b>{item.gpsAccuracyM ? `${item.gpsAccuracyM} m` : "Not captured"}</b></div>
              </div>
              {item.description ? <p className="chainage-detail-description">{item.description}</p> : <p className="muted">No description added.</p>}
            </div>
          )}
          {tab === "images" && (
            item.photos?.length ? (
              <div className="prestart-photo-grid">
                {item.photos.map((photo) => (
                  <a key={photo.id} href={photo.downloadUrl ?? photo.url} target="_blank" rel="noreferrer" className="prestart-photo">
                    <img src={photo.downloadUrl ?? photo.url} alt={photo.originalName} />
                    <span>{photo.originalName}</span>
                  </a>
                ))}
              </div>
            ) : (
              <EmptyState title="No images attached" hint="Photos added in the field will show here." />
            )
          )}
          {tab === "location" && (
            <div className="chainage-location-card">
              <div>
                <span>Road</span>
                <b>{item.alignment.name}</b>
              </div>
              <div>
                <span>Chainage</span>
                <b>{formatChainage(item.chainageM)}</b>
              </div>
              <div>
                <span>Latitude</span>
                <b>{item.latitude ?? "Not captured"}</b>
              </div>
              <div>
                <span>Longitude</span>
                <b>{item.longitude ?? "Not captured"}</b>
              </div>
            </div>
          )}
        </>
      ) : null}
    </Modal>
  );
}

export function ChainagePage() {
  const toast = useToast();
  const [projectId, setProjectId] = useState("");
  const [selectedAlignmentId, setSelectedAlignmentId] = useState("");
  const [alignmentForm, setAlignmentForm] = useState({ name: "", roadRef: "", direction: "", startLabel: "", endLabel: "", startChainage: "0+000", endChainage: "", geometryText: "", notes: "" });
  const [observationForm, setObservationForm] = useState({ chainage: "", side: "CENTRE", offsetM: "", category: "ISSUE", title: "", description: "", latitude: "", longitude: "", gpsAccuracyM: "" });
  const [snapHint, setSnapHint] = useState("");
  const [photos, setPhotos] = useState<FileAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [selectedObservationId, setSelectedObservationId] = useState<string | null>(null);

  const alignmentsQuery = useApiQuery<ChainageAlignment[]>("/api/v1/chainage/alignments", { projectId: projectId || undefined });
  const observationsQuery = useApiQuery<ChainageObservation[]>("/api/v1/chainage/observations", { projectId: projectId || undefined, limit: 100 });
  const alignments = alignmentsQuery.data ?? [];
  const selectedAlignment = alignments.find((alignment) => alignment.id === selectedAlignmentId) ?? alignments[0];
  const observations = observationsQuery.data ?? [];

  const alignmentOptions = useMemo(
    () => alignments.map((alignment) => ({ value: alignment.id, label: `${alignment.name} (${formatChainage(alignment.startChainageM)}-${formatChainage(alignment.endChainageM)})` })),
    [alignments],
  );

  const createAlignment = useMutation(
    () =>
      api<ChainageAlignment>("/api/v1/chainage/alignments", {
        method: "POST",
        body: {
          projectId,
          name: alignmentForm.name.trim(),
          roadRef: alignmentForm.roadRef.trim() || undefined,
          direction: alignmentForm.direction.trim() || undefined,
          startLabel: alignmentForm.startLabel.trim() || undefined,
          endLabel: alignmentForm.endLabel.trim() || undefined,
          startChainageM: parseChainage(alignmentForm.startChainage),
          endChainageM: parseChainage(alignmentForm.endChainage),
          geometry: parseGeometry(alignmentForm.geometryText),
          notes: alignmentForm.notes.trim() || undefined,
        },
      }),
    ["/api/v1/chainage/alignments"],
  );

  const createObservation = useMutation(
    () =>
      api<ChainageObservation>("/api/v1/chainage/observations", {
        method: "POST",
        body: {
          projectId,
          alignmentId: selectedAlignment?.id,
          chainageM: parseChainage(observationForm.chainage),
          side: observationForm.side,
          offsetM: observationForm.offsetM ? Number(observationForm.offsetM) : undefined,
          latitude: observationForm.latitude ? Number(observationForm.latitude) : undefined,
          longitude: observationForm.longitude ? Number(observationForm.longitude) : undefined,
          gpsAccuracyM: observationForm.gpsAccuracyM ? Number(observationForm.gpsAccuracyM) : undefined,
          category: observationForm.category,
          title: observationForm.title.trim(),
          description: observationForm.description.trim() || undefined,
          photoIds: photos.map((photo) => photo.id),
        },
      }),
    ["/api/v1/chainage/observations", "/api/v1/chainage/alignments"],
  );

  const uploadPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded: FileAsset[] = [];
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.set("file", file);
        formData.set("entityType", "ChainageObservation");
        formData.set("metadata", JSON.stringify({ projectId, alignmentId: selectedAlignment?.id, chainage: observationForm.chainage, draft: true }));
        uploaded.push(await api<FileAsset>("/api/v1/files", { method: "POST", formData }));
      }
      setPhotos((current) => [...current, ...uploaded]);
      toast.push(uploaded.length === 1 ? "Photo added" : `${uploaded.length} photos added`);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : "Photo upload failed", "error");
    } finally {
      setUploading(false);
    }
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.push("Location is not available in this browser", "error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setObservationForm((form) => ({
          ...form,
          latitude: position.coords.latitude.toFixed(7),
          longitude: position.coords.longitude.toFixed(7),
          gpsAccuracyM: Math.round(position.coords.accuracy).toString(),
        }));
        toast.push("Current location captured");
      },
      () => toast.push("Could not capture current location", "error"),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };

  return (
    <Layout title="Chainage">
      <section className="card card-pad stack">
        <div className="row-between">
          <div>
            <h2>Road chainage reference</h2>
            <p className="muted">Record issues by road, chainage, side and offset, with GPS/photos as supporting evidence.</p>
          </div>
          <Field label="Project">
            <ProjectSelect value={projectId} onChange={(value) => { setProjectId(value); setSelectedAlignmentId(""); }} allowEmpty emptyLabel="Select project" activeOnly />
          </Field>
        </div>
      </section>

      <ErrorAlert error={alignmentsQuery.error ?? observationsQuery.error} />
      {(alignmentsQuery.loading || observationsQuery.loading) && !alignmentsQuery.data && <Loading />}

      <section className="card card-pad stack">
        <div className="row-between">
          <div>
            <h2>Work items</h2>
            <p className="muted">Switch between a chainage map and a field list. Tap any item to view details, location and photos.</p>
          </div>
          <Select value={selectedAlignment?.id ?? ""} onChange={setSelectedAlignmentId} options={alignmentOptions} allowEmpty emptyLabel="Select road" />
        </div>
        <div className="tabs">
          <button className={`tab ${viewMode === "map" ? "active" : ""}`} onClick={() => setViewMode("map")} type="button">Map ({observations.length})</button>
          <button className={`tab ${viewMode === "list" ? "active" : ""}`} onClick={() => setViewMode("list")} type="button">List ({observations.length})</button>
        </div>
        {viewMode === "map" ? (
          <WorkMap
            alignment={selectedAlignment}
            observations={observations}
            draft={observationForm.latitude && observationForm.longitude ? { latitude: Number(observationForm.latitude), longitude: Number(observationForm.longitude) } : null}
            onUseLocation={useCurrentLocation}
            onSelectObservation={setSelectedObservationId}
            onPick={(point) => {
              setObservationForm((form) => ({
                ...form,
                latitude: point.latitude.toFixed(7),
                longitude: point.longitude.toFixed(7),
                chainage: point.chainageM !== undefined ? formatChainage(point.chainageM) : form.chainage,
              }));
              setSnapHint(point.chainageM !== undefined ? `Nearest ${formatChainage(point.chainageM)} (${Math.round(point.snapDistanceM ?? 0)} m from alignment)` : "Point captured. Add chainage manually or add road geometry to auto-calculate.");
            }}
          />
        ) : observations.length === 0 ? (
          <EmptyState title="No chainage details yet" hint="Captured defects, scope notes and quote items will appear here." />
        ) : (
          <div className="chainage-list">
            {observations.map((item) => (
              <button className="chainage-observation" key={item.id} onClick={() => setSelectedObservationId(item.id)} type="button">
                <div>
                  <b>{formatChainage(item.chainageM)}</b>
                  <span>{item.alignment.name} · {titleCase(item.side)}</span>
                </div>
                <div>
                  <b>{item.title}</b>
                  <span className="tiny">{titleCase(item.category)} · {formatDateTime(item.observedAt)}{item.createdBy ? ` · ${item.createdBy.name}` : ""}</span>
                  {item.description && <p className="muted">{item.description}</p>}
                </div>
                <StatusBadge status={item.status} />
              </button>
            ))}
          </div>
        )}
        {snapHint && <div className="alert alert-info">{snapHint}</div>}
      </section>

      <section className="chainage-grid">
        <div className="card card-pad stack">
          <h2>Add road alignment</h2>
          <div className="form-grid">
            <Field label="Road / alignment" required>
              <TextInput value={alignmentForm.name} onChange={(name) => setAlignmentForm((form) => ({ ...form, name }))} placeholder="Hinton Road culverts" />
            </Field>
            <Field label="Road ref">
              <TextInput value={alignmentForm.roadRef} onChange={(roadRef) => setAlignmentForm((form) => ({ ...form, roadRef }))} placeholder="MR-104" />
            </Field>
            <Field label="Start chainage" required>
              <TextInput value={alignmentForm.startChainage} onChange={(startChainage) => setAlignmentForm((form) => ({ ...form, startChainage }))} placeholder="0+000" />
            </Field>
            <Field label="End chainage" required>
              <TextInput value={alignmentForm.endChainage} onChange={(endChainage) => setAlignmentForm((form) => ({ ...form, endChainage }))} placeholder="12+500" />
            </Field>
            <Field label="Start reference">
              <TextInput value={alignmentForm.startLabel} onChange={(startLabel) => setAlignmentForm((form) => ({ ...form, startLabel }))} placeholder="Intersection with..." />
            </Field>
            <Field label="End reference">
              <TextInput value={alignmentForm.endLabel} onChange={(endLabel) => setAlignmentForm((form) => ({ ...form, endLabel }))} />
            </Field>
            <Field label="Geometry points" span2 hint="Optional: one latitude,longitude pair per line to sketch the road.">
              <TextArea value={alignmentForm.geometryText} onChange={(geometryText) => setAlignmentForm((form) => ({ ...form, geometryText }))} rows={3} />
            </Field>
          </div>
          <button
            className="btn btn-primary"
            disabled={!projectId || createAlignment.running || !alignmentForm.name.trim() || Number.isNaN(parseChainage(alignmentForm.endChainage))}
            onClick={() => createAlignment.run({ onSuccess: (alignment) => { setSelectedAlignmentId(alignment.id); setAlignmentForm({ name: "", roadRef: "", direction: "", startLabel: "", endLabel: "", startChainage: "0+000", endChainage: "", geometryText: "", notes: "" }); toast.push("Alignment added"); } })}
          >
            <Icon name="plus" size={15} /> Add alignment
          </button>
          <ErrorAlert error={createAlignment.error} onDismiss={createAlignment.reset} />
        </div>

        <div className="card card-pad stack">
        <div className="row-between">
          <h2>Record chainage detail</h2>
          <button className="btn btn-ghost btn-sm" onClick={useCurrentLocation}>
            Capture GPS
          </button>
        </div>
        <div className="form-grid">
          <Field label="Road" required>
            <Select value={selectedAlignment?.id ?? ""} onChange={setSelectedAlignmentId} options={alignmentOptions} allowEmpty emptyLabel="Select road" />
          </Field>
          <Field label="Chainage" required hint="Use construction notation like 2+500.">
            <TextInput value={observationForm.chainage} onChange={(chainage) => setObservationForm((form) => ({ ...form, chainage }))} placeholder="2+500" />
          </Field>
          <Field label="Side">
            <Select value={observationForm.side} onChange={(side) => setObservationForm((form) => ({ ...form, side }))} options={SIDES} />
          </Field>
          <Field label="Offset metres">
            <TextInput value={observationForm.offsetM} onChange={(offsetM) => setObservationForm((form) => ({ ...form, offsetM }))} type="number" inputMode="decimal" />
          </Field>
          <Field label="Category">
            <Select value={observationForm.category} onChange={(category) => setObservationForm((form) => ({ ...form, category }))} options={CATEGORIES} />
          </Field>
          <Field label="Title" required>
            <TextInput value={observationForm.title} onChange={(title) => setObservationForm((form) => ({ ...form, title }))} placeholder="Headwall undermined" />
          </Field>
          <Field label="Description" span2>
            <TextArea value={observationForm.description} onChange={(description) => setObservationForm((form) => ({ ...form, description }))} rows={3} />
          </Field>
          <Field label="Latitude">
            <TextInput value={observationForm.latitude} onChange={(latitude) => setObservationForm((form) => ({ ...form, latitude }))} mono />
          </Field>
          <Field label="Longitude">
            <TextInput value={observationForm.longitude} onChange={(longitude) => setObservationForm((form) => ({ ...form, longitude }))} mono />
          </Field>
        </div>
        <div className="row-between">
          <label className={"btn btn-ghost" + (uploading ? " disabled" : "")}>
            <Icon name="upload" size={15} /> {uploading ? "Uploading..." : "Add photos"}
            <input type="file" accept="image/*" multiple style={{ display: "none" }} disabled={uploading} onChange={(event) => { uploadPhotos(event.target.files); event.currentTarget.value = ""; }} />
          </label>
          <button
            className="btn btn-accent"
            disabled={!projectId || !selectedAlignment || createObservation.running || Number.isNaN(parseChainage(observationForm.chainage)) || !observationForm.title.trim()}
            onClick={() => createObservation.run({ onSuccess: () => { setObservationForm({ chainage: "", side: "CENTRE", offsetM: "", category: "ISSUE", title: "", description: "", latitude: "", longitude: "", gpsAccuracyM: "" }); setPhotos([]); toast.push("Chainage detail recorded"); } })}
          >
            {createObservation.running ? "Recording..." : "Record detail"}
          </button>
        </div>
        {photos.length > 0 && (
          <div className="photo-grid">
            {photos.map((photo) => (
              <div className="photo-chip" key={photo.id}>
                <img src={photo.downloadUrl ?? photo.url} alt={photo.originalName} />
                <button className="btn-icon" type="button" aria-label="Remove photo" onClick={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))}>
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <ErrorAlert error={createObservation.error} onDismiss={createObservation.reset} />
        </div>
      </section>
      {selectedObservationId && <ChainageObservationDetailModal observationId={selectedObservationId} onClose={() => setSelectedObservationId(null)} />}
    </Layout>
  );
}
