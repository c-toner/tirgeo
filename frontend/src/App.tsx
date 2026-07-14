import { AuthProvider, useAuth } from "./lib/auth.tsx";
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
import { DailyReportPage } from "./pages/field/DailyReportPage.tsx";
import { TimesheetsPage } from "./pages/timesheets/TimesheetsPage.tsx";
import { PayrollPage } from "./pages/payroll/PayrollPage.tsx";
import { CommercialPage } from "./pages/commercial/CommercialPage.tsx";
import { TenderDetailPage } from "./pages/commercial/TenderDetailPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";

function Routes() {
  const { user } = useAuth();
  const path = usePath();
  const clean = path.split("?")[0];

  if (!user) return <LoginPage />;
  if (clean === "/login") return <LoginPage />;

  const tenderMatch = matchPath("/commercial/tenders/:id", clean);
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
    case "/plant/templates":
      return <TemplatesPage />;
    case "/field/daily-report":
      return <DailyReportPage />;
    case "/timesheets":
      return <TimesheetsPage />;
    case "/payroll":
      return <PayrollPage />;
    case "/commercial":
      return <CommercialPage />;
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
