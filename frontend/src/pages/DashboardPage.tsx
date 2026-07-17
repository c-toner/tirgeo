import { useState } from "react";
import { Layout } from "../components/Layout.tsx";
import { EmptyState, Loading, RiskBadge, Select, StatTile, StatusBadge, ErrorAlert, Icon } from "../components/ui.tsx";
import { useApiQuery } from "../lib/useApi.ts";
import type { AccountSection, HseqDashboard, Project } from "../lib/types.ts";
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
  const { data: projects } = useApiQuery<Project[]>("/api/v1/projects");
  const { data, loading, error } = useApiQuery<HseqDashboard>("/api/v1/safety/dashboard", {
    projectId: projectId || undefined,
  });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const isCrewUser = user?.role === "WORKER" || user?.role === "SUBCONTRACTOR";
  if (isCrewUser) return <CrewDashboard />;

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
      </div>

      <ErrorAlert error={error} />
      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="stat-grid">
            <StatTile
              label="Open hazards"
              value={data.openHazards}
              tone={data.openHazards > 0 ? "warning" : "good"}
              foot={`${data.highRiskHazards} high or extreme`}
              href="/hseq/hazards"
            />
            <StatTile
              label="High-risk hazards"
              value={data.highRiskHazards}
              tone={data.highRiskHazards > 0 ? "critical" : "good"}
              foot="Not yet closed"
              href="/hseq/hazards"
            />
            <StatTile
              label="Overdue controls"
              value={data.overdueControls}
              tone={data.overdueControls > 0 ? "serious" : "good"}
              foot="Unverified past review date"
              href="/hseq/hazards?tab=controls"
            />
            <StatTile
              label="Open incidents"
              value={data.openIncidents}
              tone={data.openIncidents > 0 ? "critical" : "good"}
              foot="Awaiting closure"
              href="/hseq/observations?tab=incidents"
            />
            <StatTile
              label="Corrective actions"
              value={data.openActions}
              tone={data.overdueActions > 0 ? "serious" : data.openActions > 0 ? "warning" : "good"}
              foot={`${data.overdueActions} overdue`}
              href="/hseq/actions"
            />
            <StatTile
              label="Active permits"
              value={data.activePermits}
              tone="primary"
              foot="Approved or in force"
              href="/hseq/permits"
            />
            <StatTile
              label="Pending safety docs"
              value={data.pendingDocuments}
              tone={data.pendingDocuments > 0 ? "warning" : "good"}
              foot="Draft or awaiting approval"
              href="/hseq/documents"
            />
            <StatTile
              label="Projects"
              value={projects?.filter((p) => p.status === "ACTIVE").length ?? "—"}
              tone="neutral"
              foot="Currently active"
              href="/projects"
            />
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
