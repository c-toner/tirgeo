import { useEffect, useState } from "react";
import { Layout } from "../../components/Layout.tsx";
import { ProjectSelect } from "../../components/ProjectSelect.tsx";
import { ErrorAlert, Field, Icon, Select, TextArea, TextInput, useToast } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { formatDate, isoDateOnly, todayInput } from "../../lib/format.ts";
import { listRecents, rememberRecent } from "../../lib/recents.ts";
import type { DailyReport } from "../../lib/types.ts";
import { useMutation } from "../../lib/useApi.ts";

interface PersonnelRow {
  name: string;
  role: string;
  hours: string;
}
interface PlantRow {
  asset: string;
  hours: string;
  notes: string;
}
interface ActivityRow {
  description: string;
  location: string;
  progress: string;
}
interface QuantityRow {
  item: string;
  quantity: string;
  unit: string;
}
interface DelayRow {
  cause: string;
  hours: string;
  detail: string;
}
interface VisitorRow {
  name: string;
  company: string;
  purpose: string;
}

const WEATHER_CONDITIONS = ["FINE", "OVERCAST", "RAIN", "STORM", "HIGH_WIND", "EXTREME_HEAT"];
const DRAFT_KEY = "tirgeo.daily-report.draft";

interface DailyReportDraft {
  projectId: string;
  reportDate: string;
  weather: { condition: string; tempMin: string; tempMax: string; rainfallMm: string };
  personnel: PersonnelRow[];
  plant: PlantRow[];
  activities: ActivityRow[];
  quantities: QuantityRow[];
  delays: DelayRow[];
  visitors: VisitorRow[];
  safetyNotes: string;
}

function readDraft(): DailyReportDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as DailyReportDraft) : null;
  } catch {
    return null;
  }
}

function writeDraft(draft: DailyReportDraft) {
  const hasContent =
    draft.projectId ||
    draft.personnel.some((row) => row.name.trim() || row.role.trim() || row.hours.trim()) ||
    draft.plant.some((row) => row.asset.trim() || row.hours.trim() || row.notes.trim()) ||
    draft.activities.some((row) => row.description.trim() || row.location.trim() || row.progress.trim()) ||
    draft.quantities.some((row) => row.item.trim() || row.quantity.trim() || row.unit.trim()) ||
    draft.delays.some((row) => row.cause.trim() || row.hours.trim() || row.detail.trim()) ||
    draft.visitors.some((row) => row.name.trim() || row.company.trim() || row.purpose.trim()) ||
    draft.safetyNotes.trim();
  if (!hasContent) {
    clearDraft();
    return;
  }
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Local storage may be unavailable in private browsing or locked-down devices.
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Ignore storage cleanup failures; the successful server submit is what matters.
  }
}

export function DailyReportPage() {
  const toast = useToast();
  const [projectId, setProjectId] = useState("");
  const [reportDate, setReportDate] = useState(todayInput());
  const [weather, setWeather] = useState({ condition: "FINE", tempMin: "", tempMax: "", rainfallMm: "" });
  const [personnel, setPersonnel] = useState<PersonnelRow[]>([{ name: "", role: "", hours: "" }]);
  const [plant, setPlant] = useState<PlantRow[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([{ description: "", location: "", progress: "" }]);
  const [quantities, setQuantities] = useState<QuantityRow[]>([]);
  const [delays, setDelays] = useState<DelayRow[]>([]);
  const [visitors, setVisitors] = useState<VisitorRow[]>([]);
  const [safetyNotes, setSafetyNotes] = useState("");
  const [draftLoaded, setDraftLoaded] = useState(false);
  const recents = listRecents("daily-reports");

  useEffect(() => {
    const draft = readDraft();
    if (draft) {
      setProjectId(draft.projectId ?? "");
      setReportDate(draft.reportDate || todayInput());
      setWeather(draft.weather ?? { condition: "FINE", tempMin: "", tempMax: "", rainfallMm: "" });
      setPersonnel(draft.personnel?.length ? draft.personnel : [{ name: "", role: "", hours: "" }]);
      setPlant(draft.plant ?? []);
      setActivities(draft.activities?.length ? draft.activities : [{ description: "", location: "", progress: "" }]);
      setQuantities(draft.quantities ?? []);
      setDelays(draft.delays ?? []);
      setVisitors(draft.visitors ?? []);
      setSafetyNotes(draft.safetyNotes ?? "");
    }
    setDraftLoaded(true);
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    writeDraft({ projectId, reportDate, weather, personnel, plant, activities, quantities, delays, visitors, safetyNotes });
  }, [activities, delays, draftLoaded, personnel, plant, projectId, quantities, reportDate, safetyNotes, visitors, weather]);

  const mutation = useMutation(
    () =>
      api<DailyReport>("/api/v1/field/daily-reports", {
        method: "POST",
        body: {
          projectId,
          reportDate: isoDateOnly(reportDate),
          weather: {
            condition: weather.condition,
            tempMinC: weather.tempMin ? Number(weather.tempMin) : undefined,
            tempMaxC: weather.tempMax ? Number(weather.tempMax) : undefined,
            rainfallMm: weather.rainfallMm ? Number(weather.rainfallMm) : undefined,
          },
          personnel: personnel
            .filter((row) => row.name.trim())
            .map((row) => ({ name: row.name.trim(), role: row.role.trim() || undefined, hours: row.hours ? Number(row.hours) : undefined })),
          plant: plant
            .filter((row) => row.asset.trim())
            .map((row) => ({ asset: row.asset.trim(), hours: row.hours ? Number(row.hours) : undefined, notes: row.notes.trim() || undefined })),
          activities: activities
            .filter((row) => row.description.trim())
            .map((row) => ({ description: row.description.trim(), location: row.location.trim() || undefined, progress: row.progress.trim() || undefined })),
          quantities: quantities
            .filter((row) => row.item.trim())
            .map((row) => ({ item: row.item.trim(), quantity: row.quantity ? Number(row.quantity) : undefined, unit: row.unit.trim() || undefined })),
          delays: delays
            .filter((row) => row.cause.trim())
            .map((row) => ({ cause: row.cause.trim(), hours: row.hours ? Number(row.hours) : undefined, detail: row.detail.trim() || undefined })),
          visitors: visitors
            .filter((row) => row.name.trim())
            .map((row) => ({ name: row.name.trim(), company: row.company.trim() || undefined, purpose: row.purpose.trim() || undefined })),
          safetyNotes: safetyNotes.trim() || undefined,
        },
      }),
    [],
  );

  const submit = () =>
    mutation.run({
      onSuccess: (report) => {
        rememberRecent("daily-reports", {
          id: report.id,
          label: `Diary ${formatDate(report.reportDate)}`,
          sublabel: `${personnel.filter((p) => p.name.trim()).length} personnel · ${activities.filter((a) => a.description.trim()).length} activities`,
        });
        toast.push("Daily diary submitted");
        clearDraft();
        setProjectId("");
        setReportDate(todayInput());
        setWeather({ condition: "FINE", tempMin: "", tempMax: "", rainfallMm: "" });
        setPersonnel([{ name: "", role: "", hours: "" }]);
        setPlant([]);
        setActivities([{ description: "", location: "", progress: "" }]);
        setQuantities([]);
        setDelays([]);
        setVisitors([]);
        setSafetyNotes("");
      },
    });

  function rowsEditor<T extends Record<string, string>>(
    title: string,
    rows: T[],
    setRows: (rows: T[]) => void,
    empty: T,
    fields: Array<{ key: keyof T; label: string; type?: string; wide?: boolean }>,
  ) {
    return (
      <section className="card">
        <div className="card-header">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => setRows([...rows, { ...empty }])}>
            <Icon name="plus" size={13} /> Add row
          </button>
        </div>
        <div className="card-pad stack">
          {rows.length === 0 && <span className="muted">None recorded.</span>}
          {rows.map((row, index) => (
            <div key={index} className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
              {fields.map((field) => (
                <div key={String(field.key)} className="field" style={{ flex: field.wide ? 2 : 1, minWidth: field.wide ? 200 : 110 }}>
                  <label>{field.label}</label>
                  <input
                    className="input"
                    type={field.type ?? "text"}
                    value={row[field.key] as string}
                    onChange={(e: { target: { value: string } }) => setRows(rows.map((r, i) => (i === index ? { ...r, [field.key]: e.target.value } : r)))}
                  />
                </div>
              ))}
              <button className="btn-icon" style={{ marginBottom: 4 }} aria-label="Remove row" onClick={() => setRows(rows.filter((_, i) => i !== index))}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <Layout
      title="Daily diary"
      actions={
        <button className="btn btn-accent" onClick={submit} disabled={mutation.running || !projectId || !reportDate}>
          {mutation.running ? "Submitting…" : "Submit diary"}
        </button>
      }
    >
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />

      <section className="card card-pad">
        <div className="form-grid">
          <Field label="Project" required>
            <ProjectSelect value={projectId} onChange={setProjectId} allowEmpty emptyLabel="— Select project —" activeOnly />
          </Field>
          <Field label="Report date" required>
            <TextInput value={reportDate} onChange={setReportDate} type="date" />
          </Field>
          <Field label="Weather">
            <Select value={weather.condition} onChange={(condition) => setWeather((w) => ({ ...w, condition }))} options={WEATHER_CONDITIONS} />
          </Field>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <Field label="Min °C">
              <TextInput value={weather.tempMin} onChange={(tempMin) => setWeather((w) => ({ ...w, tempMin }))} type="number" />
            </Field>
            <Field label="Max °C">
              <TextInput value={weather.tempMax} onChange={(tempMax) => setWeather((w) => ({ ...w, tempMax }))} type="number" />
            </Field>
            <Field label="Rain mm">
              <TextInput value={weather.rainfallMm} onChange={(rainfallMm) => setWeather((w) => ({ ...w, rainfallMm }))} type="number" />
            </Field>
          </div>
        </div>
      </section>

      {rowsEditor("Personnel on site", personnel, setPersonnel, { name: "", role: "", hours: "" }, [
        { key: "name", label: "Name", wide: true },
        { key: "role", label: "Role" },
        { key: "hours", label: "Hours", type: "number" },
      ])}

      {rowsEditor("Plant on site", plant, setPlant, { asset: "", hours: "", notes: "" }, [
        { key: "asset", label: "Asset", wide: true },
        { key: "hours", label: "Hours", type: "number" },
        { key: "notes", label: "Notes", wide: true },
      ])}

      {rowsEditor("Activities", activities, setActivities, { description: "", location: "", progress: "" }, [
        { key: "description", label: "Description", wide: true },
        { key: "location", label: "Location" },
        { key: "progress", label: "Progress" },
      ])}

      {rowsEditor("Quantities", quantities, setQuantities, { item: "", quantity: "", unit: "" }, [
        { key: "item", label: "Item", wide: true },
        { key: "quantity", label: "Qty", type: "number" },
        { key: "unit", label: "Unit" },
      ])}

      {rowsEditor("Delays", delays, setDelays, { cause: "", hours: "", detail: "" }, [
        { key: "cause", label: "Cause", wide: true },
        { key: "hours", label: "Hours lost", type: "number" },
        { key: "detail", label: "Detail", wide: true },
      ])}

      {rowsEditor("Visitors", visitors, setVisitors, { name: "", company: "", purpose: "" }, [
        { key: "name", label: "Name", wide: true },
        { key: "company", label: "Company" },
        { key: "purpose", label: "Purpose" },
      ])}

      <section className="card card-pad">
        <Field label="Safety notes">
          <TextArea value={safetyNotes} onChange={setSafetyNotes} rows={3} placeholder="Toolbox topics, incidents referenced, visitors inducted…" />
        </Field>
      </section>

      <div className="row-between">
        <span className="tiny">
          {recents.length > 0 ? `Last submitted from this device: ${recents[0].label}` : "Diaries submitted from this device will be listed here."}
        </span>
        <button className="btn btn-accent" onClick={submit} disabled={mutation.running || !projectId || !reportDate}>
          {mutation.running ? "Submitting…" : "Submit diary"}
        </button>
      </div>
    </Layout>
  );
}
