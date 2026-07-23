import { lazy, Suspense, useEffect } from "react";
import { AuthProvider, canAccessSection, useAuth } from "./lib/auth.tsx";
import { RouterProvider, matchPath, usePath } from "./lib/router.tsx";
import { ToastProvider } from "./components/ui.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import type { AccountSection } from "./lib/types.ts";

const ProjectsPage = lazy(() => import("./pages/ProjectsPage.tsx").then(module => ({ default: module.ProjectsPage })));
const HazardsPage = lazy(() => import("./pages/hseq/HazardsPage.tsx").then(module => ({ default: module.HazardsPage })));
const ObservationsPage = lazy(() => import("./pages/hseq/ObservationsPage.tsx").then(module => ({ default: module.ObservationsPage })));
const InspectionsPage = lazy(() => import("./pages/hseq/InspectionsPage.tsx").then(module => ({ default: module.InspectionsPage })));
const PermitsPage = lazy(() => import("./pages/hseq/PermitsPage.tsx").then(module => ({ default: module.PermitsPage })));
const ActionsPage = lazy(() => import("./pages/hseq/ActionsPage.tsx").then(module => ({ default: module.ActionsPage })));
const SafetyDocsPage = lazy(() => import("./pages/hseq/SafetyDocsPage.tsx").then(module => ({ default: module.SafetyDocsPage })));
const MySafetyPage = lazy(() => import("./pages/hseq/MySafetyPage.tsx").then(module => ({ default: module.MySafetyPage })));
const PlantPage = lazy(() => import("./pages/plant/PlantPage.tsx").then(module => ({ default: module.PlantPage })));
const TemplatesPage = lazy(() => import("./pages/plant/TemplatesPage.tsx").then(module => ({ default: module.TemplatesPage })));
const CompletedPreStartsPage = lazy(() => import("./pages/plant/CompletedPreStartsPage.tsx").then(module => ({ default: module.CompletedPreStartsPage })));
const PreStartDetailPage = lazy(() => import("./pages/plant/PreStartDetailPage.tsx").then(module => ({ default: module.PreStartDetailPage })));
const DailyReportPage = lazy(() => import("./pages/field/DailyReportPage.tsx").then(module => ({ default: module.DailyReportPage })));
const DocketsPage = lazy(() => import("./pages/field/DocketsPage.tsx").then(module => ({ default: module.DocketsPage })));
const TimesheetsPage = lazy(() => import("./pages/timesheets/TimesheetsPage.tsx").then(module => ({ default: module.TimesheetsPage })));
const PayrollPage = lazy(() => import("./pages/payroll/PayrollPage.tsx").then(module => ({ default: module.PayrollPage })));
const CommercialPage = lazy(() => import("./pages/commercial/CommercialPage.tsx").then(module => ({ default: module.CommercialPage })));
const CostTrackingPage = lazy(() => import("./pages/commercial/CostTrackingPage.tsx").then(module => ({ default: module.CostTrackingPage })));
const TenderDetailPage = lazy(() => import("./pages/commercial/TenderDetailPage.tsx").then(module => ({ default: module.TenderDetailPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage.tsx").then(module => ({ default: module.SettingsPage })));
const ChainagePage = lazy(() => import("./pages/ChainagePage.tsx").then(module => ({ default: module.ChainagePage })));

const ROUTE_SECTIONS: Array<[string, AccountSection]> = [
  ["/projects", "PROJECTS"],
  ["/field/daily-report", "DAILY_REPORT"],
  ["/field/dockets", "DOCKETS"],
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
    case "/field/dockets":
      return <DocketsPage />;
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

const BUSY_BUTTON_TEXT = /\b(adding|analysing|building|checking pin|closing|creating|publishing|re-analysing|recording|rejecting|saving|signing|submitting|updating|uploading)\b|…|\.{3}/i;

function BusyButtonObserver() {
  useEffect(() => {
    const sync = () => {
      document.querySelectorAll<HTMLElement>(".btn").forEach((button) => {
        const disabled = button.matches("button:disabled") || button.classList.contains("disabled") || button.getAttribute("aria-disabled") === "true";
        const busy = disabled && BUSY_BUTTON_TEXT.test(button.textContent ?? "");
        button.classList.toggle("btn-busy", busy);
        if (busy) button.setAttribute("aria-busy", "true");
        else if (button.getAttribute("aria-busy") === "true") button.removeAttribute("aria-busy");
      });
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "disabled", "aria-disabled"] });
    return () => observer.disconnect();
  }, []);
  return null;
}

export default function App() {
  return (
    <RouterProvider>
      <ToastProvider>
        <AuthProvider>
          <BusyButtonObserver />
          <Suspense fallback={<div className="page-loading"><span className="spinner" /></div>}>
            <Routes />
          </Suspense>
        </AuthProvider>
      </ToastProvider>
    </RouterProvider>
  );
}
