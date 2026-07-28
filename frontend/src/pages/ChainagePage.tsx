import { useEffect, useMemo, useRef, useState } from "react";
import { FileImage, FileImageLink } from "../components/FileImage.tsx";
import { Layout } from "../components/Layout.tsx";
import { ProjectSelect } from "../components/ProjectSelect.tsx";
import { EmptyState, ErrorAlert, Field, Icon, Loading, Modal, Select, StatusBadge, TextArea, TextInput, useToast } from "../components/ui.tsx";
import { api, ApiError, getApiBase, getToken } from "../lib/api.ts";
import { CHAINAGE_ASSET_TYPES, CHAINAGE_CATEGORIES, CHAINAGE_DEFECT_CAUSES, CHAINAGE_RECOMMENDED_ACTIONS, CHAINAGE_SEVERITIES, CHAINAGE_SIDES, CHAINAGE_STATUSES, formatChainage, interpolateChainagePosition, nearestChainage, parseChainage, parseGeometry, toNumber } from "../lib/chainage.ts";
import { formatDateTime, titleCase } from "../lib/format.ts";
import { extractImageGpsMetadata, prepareImageForUpload } from "../lib/images.ts";
import type { ChainageAlignment, ChainageObservation, FileAsset } from "../lib/types.ts";
import { useApiQuery, useMutation } from "../lib/useApi.ts";

const TILE_SIZE = 256;
const DEFAULT_CENTER = { latitude: -32.9283, longitude: 151.7817 };
const MIN_MAP_ZOOM = 8;
const MAX_MAP_ZOOM = 18;

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


type WorkMapMarkerItem = { item: ChainageObservation; screen: { left: number; top: number } };
type WorkMapRenderItem =
  | ({ type: "marker"; key: string } & WorkMapMarkerItem)
  | { type: "cluster"; key: string; screen: { left: number; top: number }; count: number };

function WorkMap({
  alignment,
  observations,
  draft,
  focusPoint,
  onPick,
  onUseLocation,
  onSelectObservation,
}: {
  alignment?: ChainageAlignment;
  observations: ChainageObservation[];
  draft?: { latitude: number; longitude: number } | null;
  focusPoint?: { latitude: number; longitude: number; requestId: number } | null;
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
  const [failedTiles, setFailedTiles] = useState<Record<string, true>>({});
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    moved: boolean;
    startCenterWorld: { x: number; y: number };
    startDistance?: number;
    startZoom: number;
    anchorLatLng?: { latitude: number; longitude: number };
    anchorScreen?: { x: number; y: number };
  } | null>(null);
  const [mapSize, setMapSize] = useState({ width: 720, height: 440 });

  useEffect(() => setCenter(initialCenter), [initialCenter]);
  useEffect(() => {
    if (!focusPoint) return;
    setCenter({ latitude: focusPoint.latitude, longitude: focusPoint.longitude });
    setZoom((value) => Math.max(value, 16));
  }, [focusPoint]);
  useEffect(() => setFailedTiles({}), [center.latitude, center.longitude, zoom]);
  useEffect(() => {
    const updateOnlineState = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);
  useEffect(() => {
    const element = mapRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setMapSize({ width: Math.max(280, Math.round(rect.width)), height: Math.max(320, Math.round(rect.height)) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const centerWorld = latLngToWorld(center.latitude, center.longitude, zoom);
  const topLeft = { x: centerWorld.x - mapSize.width / 2, y: centerWorld.y - mapSize.height / 2 };
  const tileMinX = Math.floor(topLeft.x / TILE_SIZE);
  const tileMaxX = Math.floor((topLeft.x + mapSize.width) / TILE_SIZE);
  const tileMinY = Math.floor(topLeft.y / TILE_SIZE);
  const tileMaxY = Math.floor((topLeft.y + mapSize.height) / TILE_SIZE);
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

  const screenPoint = (clientX: number, clientY: number) => {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const pointAtScreen = (screen: { x: number; y: number }) => worldToLatLng(topLeft.x + screen.x, topLeft.y + screen.y, zoom);

  const zoomAt = (screen: { x: number; y: number }, nextZoom: number, anchor = pointAtScreen(screen)) => {
    const clamped = Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, Math.round(nextZoom)));
    const nextWorld = latLngToWorld(anchor.latitude, anchor.longitude, clamped);
    const nextCenterWorld = {
      x: nextWorld.x - (screen.x - mapSize.width / 2),
      y: nextWorld.y - (screen.y - mapSize.height / 2),
    };
    setZoom(clamped);
    setCenter(worldToLatLng(nextCenterWorld.x, nextCenterWorld.y, clamped));
  };

  const pan = (dx: number, dy: number) => {
    const next = worldToLatLng(centerWorld.x + dx, centerWorld.y + dy, zoom);
    setCenter(next);
  };

  const pickAt = (clientX: number, clientY: number) => {
    const screen = screenPoint(clientX, clientY);
    const point = pointAtScreen(screen);
    const nearest = nearestChainage(alignment, point);
    onPick({ ...point, chainageM: nearest?.chainageM, snapDistanceM: nearest?.distanceM });
  };

  return (
    <div className="work-map-shell">
      <div
        ref={mapRef}
        className="work-map"
        onWheel={(event) => {
          event.preventDefault();
          const screen = screenPoint(event.clientX, event.clientY);
          zoomAt(screen, zoom + (event.deltaY < 0 ? 1 : -1));
        }}
        onPointerDown={(event) => {
          if (event.target instanceof Element && event.target.closest("button, a")) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const values = [...pointers.current.values()];
          if (values.length === 1) {
            gesture.current = { moved: false, startCenterWorld: centerWorld, startZoom: zoom };
          }
          if (values.length === 2) {
            const a = values[0];
            const b = values[1];
            const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const screen = screenPoint(midpoint.x, midpoint.y);
            gesture.current = {
              moved: false,
              startCenterWorld: centerWorld,
              startDistance: Math.hypot(a.x - b.x, a.y - b.y),
              startZoom: zoom,
              anchorLatLng: pointAtScreen(screen),
              anchorScreen: screen,
            };
          }
        }}
        onPointerMove={(event) => {
          const previous = pointers.current.get(event.pointerId);
          if (!previous || !gesture.current) return;
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const values = [...pointers.current.values()];
          if (values.length === 1) {
            const dx = event.clientX - previous.x;
            const dy = event.clientY - previous.y;
            if (Math.hypot(dx, dy) > 2) gesture.current.moved = true;
            setCenter((current) => {
              const currentWorld = latLngToWorld(current.latitude, current.longitude, zoom);
              return worldToLatLng(currentWorld.x - dx, currentWorld.y - dy, zoom);
            });
          }
          if (values.length >= 2 && gesture.current.startDistance && gesture.current.anchorLatLng && gesture.current.anchorScreen) {
            const a = values[0];
            const b = values[1];
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            const ratio = distance / Math.max(1, gesture.current.startDistance);
            if (Math.abs(ratio - 1) > 0.02) gesture.current.moved = true;
            zoomAt(gesture.current.anchorScreen, gesture.current.startZoom + Math.log2(ratio), gesture.current.anchorLatLng);
          }
        }}
        onPointerUp={(event) => {
          if (!pointers.current.has(event.pointerId)) return;
          const wasTap = pointers.current.size === 1 && !gesture.current?.moved;
          pointers.current.delete(event.pointerId);
          if (wasTap) pickAt(event.clientX, event.clientY);
          if (pointers.current.size === 0) gesture.current = null;
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          if (pointers.current.size === 0) gesture.current = null;
        }}
      >
        {tiles.map((tile) => {
          const tileKey = `${zoom}-${tile.wrappedX}-${tile.y}`;
          return (
            <img
              alt=""
              className="work-map-tile"
              draggable={false}
              key={tileKey}
              referrerPolicy="origin"
              src={`https://tile.openstreetmap.org/${zoom}/${tile.wrappedX}/${tile.y}.png`}
              style={{ left: tile.left, top: tile.top, visibility: failedTiles[tileKey] ? "hidden" : "visible" }}
              onError={() => setFailedTiles((current) => (current[tileKey] ? current : { ...current, [tileKey]: true }))}
            />
          );
        })}
        {(!isOnline || Object.keys(failedTiles).length > 0) && (
          <div className="work-map-tile-warning">
            {!isOnline ? "Offline reference mode. " : "Base map limited. "}
            Chainage alignments and items are still shown.
          </div>
        )}
        {linePoints.length > 1 && (
          <svg className="work-map-overlay" viewBox={`0 0 ${mapSize.width} ${mapSize.height}`}>
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
              aria-label={`View ${marker.item.title} at ${formatChainage(marker.item.chainageM)}`}
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
        {!isOnline && " Basemap downloads need service, but project chainage remains visible."}
      </div>
    </div>
  );
}

function ChainageObservationDetailModal({ observationId, onClose, onChanged }: { observationId: string; onClose: () => void; onChanged: () => void }) {
  const detailQuery = useApiQuery<ChainageObservation>(`/api/v1/chainage/observations/${observationId}`);
  const toast = useToast();
  const item = detailQuery.data;
  const title = item ? `${formatChainage(item.chainageM)} · ${item.title}` : "Chainage detail";
  const updateStatus = useMutation(
    () =>
      api<ChainageObservation>(`/api/v1/chainage/observations/${observationId}/status`, {
        method: "PATCH",
        body: { status: pendingStatus },
      }),
    ["/api/v1/chainage/observations"],
  );
  const [pendingStatus, setPendingStatus] = useState("");

  useEffect(() => {
    if (item) setPendingStatus(item.status);
  }, [item]);

  return (
    <Modal
      title={title}
      onClose={onClose}
      large
      footer={item && (
        <div className="row-between full-width">
          <Field label="Status">
            <Select value={pendingStatus} onChange={setPendingStatus} options={[...CHAINAGE_STATUSES]} />
          </Field>
          <button
            className="btn btn-primary"
            disabled={updateStatus.running || pendingStatus === item.status}
            onClick={() => updateStatus.run({ onSuccess: () => { toast.push("Chainage status updated"); detailQuery.refresh(); onChanged(); } })}
            type="button"
          >
            {updateStatus.running ? "Updating..." : "Update status"}
          </button>
        </div>
      )}
    >
      <ErrorAlert error={detailQuery.error} />
      <ErrorAlert error={updateStatus.error} onDismiss={updateStatus.reset} />
      {detailQuery.loading && !item ? (
        <Loading />
      ) : item ? (
        <div className="stack chainage-report-detail">
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
            <div><span>Asset</span><b>{item.assetType ? titleCase(item.assetType) : "Not set"}</b></div>
            <div><span>Severity</span><b>{item.severity ? titleCase(item.severity) : "Not set"}</b></div>
            <div><span>Cause</span><b>{item.defectCause ? titleCase(item.defectCause) : "Not set"}</b></div>
            <div><span>Action</span><b>{item.recommendedAction ? titleCase(item.recommendedAction) : "Not set"}</b></div>
            <div><span>Side / offset</span><b>{titleCase(item.side)}{item.offsetM ? ` · ${item.offsetM} m` : ""}</b></div>
            <div><span>Recorded</span><b>{formatDateTime(item.observedAt)}</b></div>
            <div><span>Recorded by</span><b>{item.createdBy?.name ?? "Unknown"}</b></div>
            <div><span>GPS accuracy</span><b>{item.gpsAccuracyM ? `${item.gpsAccuracyM} m` : "Not captured"}</b></div>
          </div>

          <section className="chainage-report-section">
            <h3>Reported detail</h3>
            {item.description ? <p className="chainage-detail-description">{item.description}</p> : <p className="muted">No description was added to this report.</p>}
          </section>

          <section className="chainage-report-section">
            <div className="row-between">
              <h3>Photos</h3>
              <span className="badge no-dot">{item.photos?.length ?? 0}</span>
            </div>
            {item.photos?.length ? (
              <div className="prestart-photo-grid">
                {item.photos.map((photo) => (
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
            ) : (
              <p className="muted">No photos were attached to this report.</p>
            )}
          </section>

          <section className="chainage-report-section">
            <h3>Location</h3>
            <div className="chainage-location-card">
              <div><span>Road</span><b>{item.alignment.name}</b></div>
              <div><span>Chainage</span><b>{formatChainage(item.chainageM)}</b></div>
              <div><span>Latitude</span><b>{item.latitude ?? "Not captured"}</b></div>
              <div><span>Longitude</span><b>{item.longitude ?? "Not captured"}</b></div>
            </div>
          </section>
        </div>
      ) : null}
    </Modal>
  );
}

export function ChainagePage() {
  const toast = useToast();
  const [projectId, setProjectId] = useState("");
  const [selectedAlignmentId, setSelectedAlignmentId] = useState("");
  const [alignmentForm, setAlignmentForm] = useState({ name: "", roadRef: "", direction: "", startLabel: "", endLabel: "", startChainage: "0+000", endChainage: "", geometryText: "", notes: "" });
  const [observationForm, setObservationForm] = useState({ chainage: "", side: "CENTRE", offsetM: "", category: "ISSUE", assetType: "", severity: "", defectCause: "", recommendedAction: "", title: "", description: "", latitude: "", longitude: "", gpsAccuracyM: "" });
  const [snapHint, setSnapHint] = useState("");
  const [photos, setPhotos] = useState<FileAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [selectedObservationId, setSelectedObservationId] = useState<string | null>(null);
  const [filters, setFilters] = useState({ status: "", category: "", assetType: "", severity: "", side: "", search: "", chainageFrom: "", chainageTo: "" });
  const [mapFocusPoint, setMapFocusPoint] = useState<{ latitude: number; longitude: number; requestId: number } | null>(null);

  const alignmentsQuery = useApiQuery<ChainageAlignment[]>("/api/v1/chainage/alignments", { projectId: projectId || undefined });
  const observationQueryParams = useMemo(
    () => ({
      projectId: projectId || undefined,
      alignmentId: selectedAlignmentId || undefined,
      status: filters.status || undefined,
      category: filters.category || undefined,
      assetType: filters.assetType || undefined,
      severity: filters.severity || undefined,
      side: filters.side || undefined,
      search: filters.search.trim() || undefined,
      chainageFromM: filters.chainageFrom ? parseChainage(filters.chainageFrom) : undefined,
      chainageToM: filters.chainageTo ? parseChainage(filters.chainageTo) : undefined,
      limit: 250,
    }),
    [filters, projectId, selectedAlignmentId],
  );
  const observationsQuery = useApiQuery<ChainageObservation[]>("/api/v1/chainage/observations", observationQueryParams);
  const alignments = alignmentsQuery.data ?? [];
  const selectedAlignment = alignments.find((alignment) => alignment.id === selectedAlignmentId) ?? alignments[0];
  const observations = observationsQuery.data ?? [];
  const statusCounts = useMemo(
    () => observations.reduce<Record<string, number>>((counts, item) => ({ ...counts, [item.status]: (counts[item.status] ?? 0) + 1 }), {}),
    [observations],
  );

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
          assetType: observationForm.assetType || undefined,
          severity: observationForm.severity || undefined,
          defectCause: observationForm.defectCause || undefined,
          recommendedAction: observationForm.recommendedAction || undefined,
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
      let gpsMatches = 0;
      for (const file of Array.from(files)) {
        const gps = await extractImageGpsMetadata(file);
        if (gps) gpsMatches += 1;
        const prepared = await prepareImageForUpload(file);
        const formData = new FormData();
        formData.set("file", prepared);
        formData.set("entityType", "ChainageObservation");
        formData.set("metadata", JSON.stringify({ projectId, alignmentId: selectedAlignment?.id, chainage: observationForm.chainage, draft: true, gps }));
        uploaded.push(await api<FileAsset>("/api/v1/files", { method: "POST", formData }));
        if (gps && !observationForm.latitude && !observationForm.longitude) {
          const nearest = nearestChainage(selectedAlignment, gps);
          setObservationForm((form) => ({
            ...form,
            latitude: gps.latitude.toFixed(7),
            longitude: gps.longitude.toFixed(7),
            chainage: nearest ? formatChainage(nearest.chainageM) : form.chainage,
          }));
          setSnapHint(nearest ? `Photo GPS placed at ${formatChainage(nearest.chainageM)} (${Math.round(nearest.distanceM)} m from alignment)` : "Photo GPS captured. Add chainage manually or add road geometry to auto-calculate.");
        }
      }
      setPhotos((current) => [...current, ...uploaded]);
      toast.push(`${uploaded.length === 1 ? "Photo added" : `${uploaded.length} photos added`}${gpsMatches ? `, ${gpsMatches} with GPS` : ""}`);
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
        const point = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        const nearest = nearestChainage(selectedAlignment, point);
        setObservationForm((form) => ({
          ...form,
          latitude: point.latitude.toFixed(7),
          longitude: point.longitude.toFixed(7),
          gpsAccuracyM: Math.round(position.coords.accuracy).toString(),
          chainage: nearest ? formatChainage(nearest.chainageM) : form.chainage,
        }));
        setMapFocusPoint({ ...point, requestId: Date.now() });
        setSnapHint(nearest ? `Current GPS placed at ${formatChainage(nearest.chainageM)} (${Math.round(nearest.distanceM)} m from alignment)` : "Current GPS captured. Add chainage manually or add road geometry to auto-calculate.");
        toast.push("Current location captured");
      },
      () => toast.push("Could not capture current location", "error"),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };

  const exportCsv = async () => {
    const url = new URL("/api/v1/chainage/observations/export.csv", window.location.origin);
    for (const [key, value] of Object.entries(observationQueryParams)) {
      if (value === undefined || value === "") continue;
      if (typeof value === "number" && !Number.isFinite(value)) continue;
      url.searchParams.set(key, String(value));
    }
    try {
      const token = getToken();
      const response = await fetch(new URL(url.pathname + url.search, getApiBase() || window.location.origin), {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) throw new ApiError(response.status, "Could not export chainage observations");
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `chainage-observations-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(href);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : "Could not export chainage observations", "error");
    }
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
          <div className="row-actions">
            <button className="btn btn-ghost" onClick={exportCsv} disabled={!observations.length} type="button">
              <Icon name="download" size={15} /> Export
            </button>
            <Select value={selectedAlignmentId} onChange={setSelectedAlignmentId} options={alignmentOptions} allowEmpty emptyLabel="All roads" />
          </div>
        </div>
        <div className="chainage-status-strip">
          {CHAINAGE_STATUSES.map((status) => (
            <button
              className={`chainage-status-chip ${filters.status === status ? "active" : ""}`}
              key={status}
              onClick={() => setFilters((current) => ({ ...current, status: current.status === status ? "" : status }))}
              type="button"
            >
              <span>{titleCase(status)}</span>
              <b>{statusCounts[status] ?? 0}</b>
            </button>
          ))}
        </div>
        <div className="chainage-filter-grid">
          <Field label="Search">
            <TextInput value={filters.search} onChange={(search) => setFilters((current) => ({ ...current, search }))} placeholder="Title, description or road" />
          </Field>
          <Field label="Category">
            <Select value={filters.category} onChange={(category) => setFilters((current) => ({ ...current, category }))} options={[...CHAINAGE_CATEGORIES]} allowEmpty emptyLabel="All categories" />
          </Field>
          <Field label="Asset">
            <Select value={filters.assetType} onChange={(assetType) => setFilters((current) => ({ ...current, assetType }))} options={[...CHAINAGE_ASSET_TYPES]} allowEmpty emptyLabel="All assets" />
          </Field>
          <Field label="Severity">
            <Select value={filters.severity} onChange={(severity) => setFilters((current) => ({ ...current, severity }))} options={[...CHAINAGE_SEVERITIES]} allowEmpty emptyLabel="All severity" />
          </Field>
          <Field label="Side">
            <Select value={filters.side} onChange={(side) => setFilters((current) => ({ ...current, side }))} options={[...CHAINAGE_SIDES]} allowEmpty emptyLabel="All sides" />
          </Field>
          <Field label="From">
            <TextInput value={filters.chainageFrom} onChange={(chainageFrom) => setFilters((current) => ({ ...current, chainageFrom }))} placeholder="0+000" />
          </Field>
          <Field label="To">
            <TextInput value={filters.chainageTo} onChange={(chainageTo) => setFilters((current) => ({ ...current, chainageTo }))} placeholder="12+500" />
          </Field>
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
            focusPoint={mapFocusPoint}
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
            <Select value={observationForm.side} onChange={(side) => setObservationForm((form) => ({ ...form, side }))} options={[...CHAINAGE_SIDES]} />
          </Field>
          <Field label="Offset metres">
            <TextInput value={observationForm.offsetM} onChange={(offsetM) => setObservationForm((form) => ({ ...form, offsetM }))} type="number" inputMode="decimal" />
          </Field>
          <Field label="Category">
            <Select value={observationForm.category} onChange={(category) => setObservationForm((form) => ({ ...form, category }))} options={[...CHAINAGE_CATEGORIES]} />
          </Field>
          <Field label="Asset type">
            <Select value={observationForm.assetType} onChange={(assetType) => setObservationForm((form) => ({ ...form, assetType }))} options={[...CHAINAGE_ASSET_TYPES]} allowEmpty emptyLabel="Select asset" />
          </Field>
          <Field label="Severity">
            <Select value={observationForm.severity} onChange={(severity) => setObservationForm((form) => ({ ...form, severity }))} options={[...CHAINAGE_SEVERITIES]} allowEmpty emptyLabel="Select severity" />
          </Field>
          <Field label="Cause">
            <Select value={observationForm.defectCause} onChange={(defectCause) => setObservationForm((form) => ({ ...form, defectCause }))} options={[...CHAINAGE_DEFECT_CAUSES]} allowEmpty emptyLabel="Select cause" />
          </Field>
          <Field label="Action">
            <Select value={observationForm.recommendedAction} onChange={(recommendedAction) => setObservationForm((form) => ({ ...form, recommendedAction }))} options={[...CHAINAGE_RECOMMENDED_ACTIONS]} allowEmpty emptyLabel="Select action" />
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
            onClick={() => createObservation.run({ onSuccess: () => { setObservationForm({ chainage: "", side: "CENTRE", offsetM: "", category: "ISSUE", assetType: "", severity: "", defectCause: "", recommendedAction: "", title: "", description: "", latitude: "", longitude: "", gpsAccuracyM: "" }); setPhotos([]); toast.push("Chainage detail recorded"); } })}
          >
            {createObservation.running ? "Recording..." : "Record detail"}
          </button>
        </div>
        {photos.length > 0 && (
          <div className="photo-grid">
            {photos.map((photo) => (
              <div className="photo-chip" key={photo.id}>
                <FileImage file={photo} />
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
      {selectedObservationId && <ChainageObservationDetailModal observationId={selectedObservationId} onClose={() => setSelectedObservationId(null)} onChanged={observationsQuery.refresh} />}
    </Layout>
  );
}
