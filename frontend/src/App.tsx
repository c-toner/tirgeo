import { AuthProvider, canAccessSection, useAuth } from "./lib/auth.tsx";
import { RouterProvider, matchPath, usePath } from "./lib/router.tsx";
import { ToastProvider } from "./components/ui.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { ProjectsPage } from "./pages/ProjectsPage.tsx";
import { HazardsPage } from "./pages/hseq/HazardsPage.tsx";
import { ObservationsPage } from "./pages/hseq/ObservationsPage.tsx";
import { InspectionsPage } from "./pages/hseq/InspectionsPage.tsx";
import { PermitsPage } from "./pages/hseq/PermitsPage.tsx";
import { ActionsPage } from "./pages/hseq/ActionsPage.tsx";
import { SafetyDocsPage } from "./pages/hseq/SafetyDocsPage.tsx";
import { MySafetyPage } from "./pages/hseq/MySafetyPage.tsx";
import { PlantPage } from "./pages/plant/PlantPage.tsx";
import { TemplatesPage } from "./pages/plant/TemplatesPage.tsx";
import { CompletedPreStartsPage } from "./pages/plant/CompletedPreStartsPage.tsx";
import { PreStartDetailPage } from "./pages/plant/PreStartDetailPage.tsx";
import { DailyReportPage } from "./pages/field/DailyReportPage.tsx";
import { TimesheetsPage } from "./pages/timesheets/TimesheetsPage.tsx";
import { PayrollPage } from "./pages/payroll/PayrollPage.tsx";
import { CommercialPage } from "./pages/commercial/CommercialPage.tsx";
import { CostTrackingPage } from "./pages/commercial/CostTrackingPage.tsx";
import { TenderDetailPage } from "./pages/commercial/TenderDetailPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { ChainagePage } from "./pages/ChainagePage.tsx";
import type { AccountSection } from "./lib/types.ts";

const ROUTE_SECTIONS: Array<[string, AccountSection]> = [
  ["/projects", "PROJECTS"],
  ["/field/daily-report", "DAILY_REPORT"],
  ["/hseq/hazards", "HAZARDS"],
  ["/hseq/observations", "OBSERVATIONS"],
  ["/hseq/inspections", "INSPECTIONS"],
  ["/hseq/permits", "PERMITS"],
  ["/hseq/actions", "CORRECTIVE_ACTIONS"],
  ["/hseq/documents", "SAFETY_DOCUMENTS"],
  ["/hseq/my-safety", "MY_SAFETY"],
  ["/plant/completed-pre-starts", "COMPLETED_PRE_STARTS"],
  ["/plant/pre-starts", "PLANT"],
  ["/plant", "PLANT"],
  ["/chainage", "CHAINAGE"],
  ["/timesheets", "TIMESHEETS"],
  ["/payroll", "PAYROLL"],
  ["/commercial/cost-tracking", "COST_TRACKING"],
  ["/commercial", "COMMERCIAL"],
  ["/settings", "SETTINGS"],
];

function routeSection(path: string): AccountSection {
  return ROUTE_SECTIONS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1] ?? "DASHBOARD";
}

function Routes() {
  const { user } = useAuth();
  const path = usePath();
  const clean = path.split("?")[0];

  if (!user) return <LoginPage />;
  if (clean === "/login") return <LoginPage />;

  const tenderMatch = matchPath("/commercial/tenders/:id", clean);
  const preStartMatch = matchPath("/plant/pre-starts/:id", clean);
  if (preStartMatch) {
    if (!canAccessSection(user, "PLANT") && !canAccessSection(user, "COMPLETED_PRE_STARTS")) return <DashboardPage />;
    return <PreStartDetailPage preStartId={preStartMatch.id} />;
  }
  if (!canAccessSection(user, routeSection(clean))) return <DashboardPage />;
  if (tenderMatch) return <TenderDetailPage tenderId={tenderMatch.id} />;

  switch (clean) {
    case "/":
      return <DashboardPage />;
    case "/projects":
      return <ProjectsPage />;
    case "/hseq/hazards":
      return <HazardsPage />;
    case "/hseq/observations":
      return <ObservationsPage />;
    case "/hseq/inspections":
      return <InspectionsPage />;
    case "/hseq/permits":
      return <PermitsPage />;
    case "/hseq/actions":
      return <ActionsPage />;
    case "/hseq/documents":
      return <SafetyDocsPage />;
    case "/hseq/my-safety":
      return <MySafetyPage />;
    case "/plant":
      return <PlantPage />;
    case "/plant/completed-pre-starts":
      return <CompletedPreStartsPage />;
    case "/plant/templates":
      return <TemplatesPage />;
    case "/chainage":
      return <ChainagePage />;
    case "/field/daily-report":
      return <DailyReportPage />;
    case "/timesheets":
      return <TimesheetsPage />;
    case "/payroll":
      return <PayrollPage />;
    case "/commercial":
      return <CommercialPage />;
    case "/commercial/cost-tracking":
      return <CostTrackingPage />;
    case "/settings":
      return <SettingsPage />;
    default:
      return <DashboardPage />;
  }
}

export default function App() {
  return (
    <RouterProvider>
      <ToastProvider>
        <AuthProvider>
          <Routes />
        </AuthProvider>
      </ToastProvider>
    </RouterProvider>
  );
}
