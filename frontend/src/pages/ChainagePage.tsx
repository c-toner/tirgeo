import { useMemo, useState } from "react";
import { Layout } from "../components/Layout.tsx";
import { ProjectSelect } from "../components/ProjectSelect.tsx";
import { EmptyState, ErrorAlert, Field, Icon, Loading, Select, StatusBadge, TextArea, TextInput, useToast } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { formatDateTime, titleCase } from "../lib/format.ts";
import type { ChainageAlignment, ChainageObservation, FileAsset } from "../lib/types.ts";
import { useApiQuery, useMutation } from "../lib/useApi.ts";

const SIDES = ["LEFT", "CENTRE", "RIGHT", "BOTH", "UNKNOWN"];
const CATEGORIES = ["ISSUE", "DEFECT", "SCOPE", "QUOTE", "PHOTO_RECORD", "ACCESS", "UTILITY", "DRAINAGE"];

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

function AlignmentMap({ alignment, observations }: { alignment?: ChainageAlignment; observations: ChainageObservation[] }) {
  if (!alignment) return <div className="chainage-map empty-map">Select or create a road alignment.</div>;
  const start = toNumber(alignment.startChainageM);
  const end = toNumber(alignment.endChainageM);
  const span = Math.max(1, end - start);
  const markers = observations.filter((item) => item.alignmentId === alignment.id);
  const coordinates = alignment.geometry?.coordinates ?? [];
  const xs = coordinates.map(([lng]) => lng);
  const ys = coordinates.map(([, lat]) => lat);
  const minX = coordinates.length ? Math.min(...xs) : 0;
  const maxX = coordinates.length ? Math.max(...xs) : 1;
  const minY = coordinates.length ? Math.min(...ys) : 0;
  const maxY = coordinates.length ? Math.max(...ys) : 1;
  const path = coordinates.length
    ? coordinates
        .map(([lng, lat], index) => {
          const x = 24 + ((lng - minX) / Math.max(0.000001, maxX - minX)) * 552;
          const y = 188 - ((lat - minY) / Math.max(0.000001, maxY - minY)) * 148;
          return `${index === 0 ? "M" : "L"} ${x} ${y}`;
        })
        .join(" ")
    : "M 24 112 L 576 112";
  return (
    <div className="chainage-map">
      <svg viewBox="0 0 600 220" role="img" aria-label={`${alignment.name} chainage map`}>
        <path d={path} className="chainage-line" />
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <g key={fraction}>
            <line x1={24 + fraction * 552} x2={24 + fraction * 552} y1={102} y2={122} className="chainage-tick" />
            <text x={24 + fraction * 552} y={148} textAnchor="middle">
              {formatChainage(start + span * fraction)}
            </text>
          </g>
        ))}
        {markers.map((item) => {
          const fraction = Math.min(1, Math.max(0, (toNumber(item.chainageM) - start) / span));
          const x = 24 + fraction * 552;
          const y = item.side === "LEFT" ? 82 : item.side === "RIGHT" ? 142 : 112;
          return (
            <g key={item.id}>
              <circle cx={x} cy={y} r="8" className={`chainage-marker ${item.status.toLowerCase()}`} />
              <text x={x} y={y - 14} textAnchor="middle">
                {formatChainage(item.chainageM)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="chainage-map-foot">
        <b>{alignment.name}</b>
        <span>
          {formatChainage(alignment.startChainageM)} to {formatChainage(alignment.endChainageM)}
        </span>
      </div>
    </div>
  );
}

export function ChainagePage() {
  const toast = useToast();
  const [projectId, setProjectId] = useState("");
  const [selectedAlignmentId, setSelectedAlignmentId] = useState("");
  const [alignmentForm, setAlignmentForm] = useState({ name: "", roadRef: "", direction: "", startLabel: "", endLabel: "", startChainage: "0+000", endChainage: "", geometryText: "", notes: "" });
  const [observationForm, setObservationForm] = useState({ chainage: "", side: "CENTRE", offsetM: "", category: "ISSUE", title: "", description: "", latitude: "", longitude: "", gpsAccuracyM: "" });
  const [photos, setPhotos] = useState<FileAsset[]>([]);
  const [uploading, setUploading] = useState(false);

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

      <section className="chainage-grid">
        <div className="card card-pad stack">
          <div className="row-between">
            <h2>Alignment map</h2>
            <Select value={selectedAlignment?.id ?? ""} onChange={setSelectedAlignmentId} options={alignmentOptions} allowEmpty emptyLabel="Select road" />
          </div>
          <AlignmentMap alignment={selectedAlignment} observations={observations} />
        </div>

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
      </section>

      <section className="card card-pad stack">
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
      </section>

      <section className="card card-pad stack">
        <h2>Recorded details</h2>
        {observations.length === 0 ? (
          <EmptyState title="No chainage details yet" hint="Captured defects, scope notes and quote items will appear here." />
        ) : (
          <div className="chainage-list">
            {observations.map((item) => (
              <article className="chainage-observation" key={item.id}>
                <div>
                  <b>{formatChainage(item.chainageM)}</b>
                  <span>{item.alignment.name} - {titleCase(item.side)}</span>
                </div>
                <div>
                  <b>{item.title}</b>
                  <span className="tiny">{titleCase(item.category)} - {formatDateTime(item.observedAt)}{item.createdBy ? ` - ${item.createdBy.name}` : ""}</span>
                  {item.description && <p className="muted">{item.description}</p>}
                </div>
                <StatusBadge status={item.status} />
              </article>
            ))}
          </div>
        )}
      </section>
    </Layout>
  );
}
