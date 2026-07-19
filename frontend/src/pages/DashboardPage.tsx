import { useState } from "react";
import { Layout } from "../components/Layout.tsx";
import { EmptyState, Loading, RiskBadge, Select, StatTile, StatusBadge, ErrorAlert, Icon } from "../components/ui.tsx";
import { useApiQuery } from "../lib/useApi.ts";
import type { AccountSection, HseqDashboard, Project, Role } from "../lib/types.ts";
import { formatDateTime, titleCase } from "../lib/format.ts";
import { Link } from "../lib/router.tsx";
import { useAuth } from "../lib/auth.tsx";

const CREW_ACTIONS: Array<{ section: AccountSection; to: string; icon: string; title: string; hint: string; tone?: string }> = [
  { section: "PLANT", to: "/plant", icon: "truck", title: "Plant pre-start", hint: "Pick your machine and complete the checklist.", tone: "primary" },
  { section: "TIMESHEETS", to: "/timesheets", icon: "clock", title: "Timecard", hint: "Create, sign or check your time.", tone: "good" },
  { section: "MY_SAFETY", to: "/hseq/my-safety", icon: "pen", title: "SWMS & toolbox", hint: "Read and sign what has been assigned.", tone: "warning" },
  { section: "OBSERVATIONS", to: "/hseq/observations", icon: "alert", title: "Report hazard", hint: "Quickly log something unsafe.", tone: "serious" },
  { section: "PERMITS", to: "/hseq/permits", icon: "file", title: "Permits", hint: "View permits linked to the work.", tone: "neutral" },
  { section: "SETTINGS", to: "/settings", icon: "settings", title: "My details", hint: "Phone, address and payroll details.", tone: "neutral" },
];

type DashboardTileId = "projects" | "pendingTimecards" | "highRiskHazards" | "openHazards" | "openIncidents" | "activePermits" | "pendingDocuments" | "recentInspections";

const DASHBOARD_TILE_LABELS: Record<DashboardTileId, string> = {
  projects: "Projects",
  pendingTimecards: "Pending timecards",
  highRiskHazards: "High-risk hazards",
  openHazards: "Open hazards",
  openIncidents: "Open incidents",
  activePermits: "Active permits",
  pendingDocuments: "Pending safety docs",
  recentInspections: "Recent inspections",
};

const ALL_DASHBOARD_TILES = Object.keys(DASHBOARD_TILE_LABELS) as DashboardTileId[];

function defaultTilesForRole(role?: Role): DashboardTileId[] {
  if (role === "OWNER" || role === "ADMIN") return ["projects", "pendingTimecards", "highRiskHazards", "openIncidents", "activePermits", "pendingDocuments"];
  if (role === "SAFETY_MANAGER") return ["highRiskHazards", "openHazards", "openIncidents", "activePermits", "pendingDocuments", "recentInspections"];
  if (role === "PROJECT_MANAGER" || role === "SUPERVISOR" || role === "SITE_SUPERVISOR" || role === "SITE_ENGINEER" || role === "FOREMAN") return ["projects", "pendingTimecards", "activePermits", "highRiskHazards", "openHazards", "pendingDocuments"];
  return ["projects", "pendingTimecards", "openHazards", "activePermits"];
}

function tileStorageKey(userId?: string) {
  return `tirgeo.dashboard.tiles.${userId ?? "anonymous"}`;
}

function CrewDashboard() {
  const { user } = useAuth();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
  const actions = CREW_ACTIONS.filter(action => user?.sections.includes(action.section));

  return (
    <Layout title="Today">
      <section className="crew-hero">
        <span className="badge badge-primary no-dot">Crew mode</span>
        <h2>{greeting}, {user?.name.split(" ")[0]}.</h2>
        <p>Choose what you need. Big buttons, no office clutter.</p>
      </section>

      <section className="crew-action-grid" aria-label="Crew shortcuts">
        {actions.map(action => (
          <Link key={action.to} to={action.to} className={`crew-action crew-action-${action.tone ?? "neutral"}`}>
            <span className="crew-action-icon">
              <Icon name={action.icon} size={34} />
            </span>
            <span>
              <b>{action.title}</b>
              <small>{action.hint}</small>
            </span>
          </Link>
        ))}
      </section>

      <section className="crew-note">
        <b>On site?</b>
        <span>Start with plant pre-start, then timecard. Safety sign-ons and permits are here when assigned.</span>
      </section>
    </Layout>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const [projectId, setProjectId] = useState("");
  const [customising, setCustomising] = useState(false);
  const [tileIds, setTileIds] = useState<DashboardTileId[]>(() => {
    const saved = localStorage.getItem(tileStorageKey(user?.id));
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as DashboardTileId[];
        return parsed.filter(tile => ALL_DASHBOARD_TILES.includes(tile));
      } catch {
        return defaultTilesForRole(user?.role);
      }
    }
    return defaultTilesForRole(user?.role);
  });
  const { data: projects } = useApiQuery<Project[]>("/api/v1/projects");
  const { data, loading, error } = useApiQuery<HseqDashboard>("/api/v1/safety/dashboard", {
    projectId: projectId || undefined,
  });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const isCrewUser = user?.role === "WORKER" || user?.role === "SUBCONTRACTOR";
  if (isCrewUser) return <CrewDashboard />;

  const setTiles = (next: DashboardTileId[]) => {
    const ordered = ALL_DASHBOARD_TILES.filter(tile => next.includes(tile));
    setTileIds(ordered);
    localStorage.setItem(tileStorageKey(user?.id), JSON.stringify(ordered));
  };

  const renderTile = (tile: DashboardTileId) => {
    if (!data) return null;
    const activeProjects = data.activeProjects ?? projects?.filter((p) => p.status === "ACTIVE").length ?? 0;
    switch (tile) {
      case "projects":
        return <StatTile key={tile} label="Projects" value={activeProjects} tone="neutral" foot="Currently active" href="/projects" />;
      case "pendingTimecards":
        return <StatTile key={tile} label="Pending timecards" value={data.pendingTimecards ?? 0} tone={(data.pendingTimecards ?? 0) > 0 ? "warning" : "good"} foot="Awaiting your signature" href="/timesheets" />;
      case "highRiskHazards":
        return <StatTile key={tile} label="High-risk hazards" value={data.highRiskHazards} tone={data.highRiskHazards > 0 ? "critical" : "good"} foot="Not yet closed" href="/hseq/hazards" />;
      case "openHazards":
        return <StatTile key={tile} label="Open hazards" value={data.openHazards} tone={data.openHazards > 0 ? "warning" : "good"} foot={`${data.highRiskHazards} high or extreme`} href="/hseq/hazards" />;
      case "openIncidents":
        return <StatTile key={tile} label="Open incidents" value={data.openIncidents} tone={data.openIncidents > 0 ? "critical" : "good"} foot="Awaiting closure" href="/hseq/observations?tab=incidents" />;
      case "activePermits":
        return <StatTile key={tile} label="Active permits" value={data.activePermits} tone="primary" foot="Approved or in force" href="/hseq/permits" />;
      case "pendingDocuments":
        return <StatTile key={tile} label="Pending safety docs" value={data.pendingDocuments} tone={data.pendingDocuments > 0 ? "warning" : "good"} foot="Draft or awaiting approval" href="/hseq/documents" />;
      case "recentInspections":
        return <StatTile key={tile} label="Recent inspections" value={data.recentInspections.length} tone="neutral" foot="Latest site walks and QA" href="/hseq/inspections" />;
    }
  };

  return (
    <Layout
      title="Dashboard"
      actions={
        <Select
          value={projectId}
          onChange={setProjectId}
          allowEmpty
          emptyLabel="All projects"
          options={(projects ?? []).map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))}
        />
      }
    >
      <div className="row-between">
        <div>
          <h2 style={{ fontSize: 19 }}>
            {greeting}, {user?.name.split(" ")[0]}.
          </h2>
          <span className="muted">Here's the HSEQ position across {projectId ? "the selected project" : "all projects"}.</span>
        </div>
        <button className="btn btn-ghost" onClick={() => setCustomising(value => !value)}>
          {customising ? "Done" : "Customize tiles"}
        </button>
      </div>

      {customising && (
        <section className="card card-pad stack">
          <h2>Dashboard tiles</h2>
          <div className="grid grid-4">
            {ALL_DASHBOARD_TILES.map(tile => (
              <label key={tile} className="check-card">
                <input type="checkbox" checked={tileIds.includes(tile)} onChange={() => setTiles(tileIds.includes(tile) ? tileIds.filter(item => item !== tile) : [...tileIds, tile])} />
                <span>{DASHBOARD_TILE_LABELS[tile]}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      <ErrorAlert error={error} />
      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="stat-grid">
            {tileIds.map(renderTile)}
          </div>

          <div className="grid grid-2">
            <section className="card">
              <div className="card-header">
                <h2>Recent observations</h2>
                <Link to="/hseq/observations" className="tiny">
                  View all
                </Link>
              </div>
              {data.recentObservations.length === 0 ? (
                <EmptyState title="No observations yet" hint="Field observations raised on any device appear here." />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      {data.recentObservations.map((observation) => (
                        <tr key={observation.id}>
                          <td>
                            <b>{observation.title}</b>
                            <div className="tiny">
                              {titleCase(observation.type)} · {formatDateTime(observation.observedAt)}
                            </div>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <RiskBadge level={observation.riskLevel ?? null} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card">
              <div className="card-header">
                <h2>Recent inspections</h2>
                <Link to="/hseq/inspections" className="tiny">
                  View all
                </Link>
              </div>
              {data.recentInspections.length === 0 ? (
                <EmptyState title="No inspections yet" hint="Site walks and audits show here as they are completed." />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      {data.recentInspections.map((inspection) => {
                        const defects = inspection.items.filter((item) => item.result !== "PASS").length;
                        return (
                          <tr key={inspection.id}>
                            <td>
                              <b>{inspection.title}</b>
                              <div className="tiny">
                                {titleCase(inspection.type)} · {inspection.items.length} items
                                {defects > 0 ? ` · ${defects} flagged` : ""}
                              </div>
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <StatusBadge status={inspection.status} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </Layout>
  );
}
