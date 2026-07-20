import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { canAccessSection, useAuth } from "../lib/auth.tsx";
import { Link, usePath } from "../lib/router.tsx";
import { useApiQuery, invalidate } from "../lib/useApi.ts";
import { api } from "../lib/api.ts";
import type { AccountSection, AppNotification } from "../lib/types.ts";
import { Icon, useToast } from "./ui.tsx";
import { formatDateTime } from "../lib/format.ts";

interface NavEntry {
  to: string;
  label: string;
  icon: string;
  section?: AccountSection;
}

interface NavGroup {
  title: string;
  items: NavEntry[];
}

const NAV: NavGroup[] = [
  {
    title: "Operate",
    items: [
      { to: "/", label: "Dashboard", icon: "dashboard", section: "DASHBOARD" },
      { to: "/projects", label: "Projects", icon: "projects", section: "PROJECTS" },
      { to: "/field/daily-report", label: "Daily diary", icon: "clipboard", section: "DAILY_REPORT" },
    ],
  },
  {
    title: "HSEQ",
    items: [
      { to: "/hseq/hazards", label: "Hazard register", icon: "alert", section: "HAZARDS" },
      { to: "/hseq/observations", label: "Observations", icon: "search", section: "OBSERVATIONS" },
      { to: "/hseq/inspections", label: "Inspections", icon: "check", section: "INSPECTIONS" },
      { to: "/hseq/permits", label: "Permits to work", icon: "file", section: "PERMITS" },
      { to: "/hseq/actions", label: "Corrective actions", icon: "clipboard", section: "CORRECTIVE_ACTIONS" },
      { to: "/hseq/documents", label: "Safety documents", icon: "shield", section: "SAFETY_DOCUMENTS" },
      { to: "/hseq/my-safety", label: "My sign-ons", icon: "pen", section: "MY_SAFETY" },
    ],
  },
  {
    title: "Resources",
    items: [
      { to: "/plant", label: "Plant & pre-starts", icon: "truck", section: "PLANT" },
      { to: "/plant/completed-pre-starts", label: "Completed pre-starts", icon: "clipboard", section: "COMPLETED_PRE_STARTS" },
      { to: "/chainage", label: "Chainage", icon: "projects", section: "CHAINAGE" },
      { to: "/timesheets", label: "Timesheets", icon: "clock", section: "TIMESHEETS" },
      {
        to: "/payroll",
        label: "Payroll export",
        icon: "dollars",
        section: "PAYROLL",
      },
    ],
  },
  {
    title: "Commercial",
    items: [
      { to: "/commercial", label: "Tenders & claims", icon: "briefcase", section: "COMMERCIAL" },
    ],
  },
];

const MOBILE_NAV: NavEntry[] = [
  { to: "/", label: "Home", icon: "dashboard", section: "DASHBOARD" },
  { to: "/field/daily-report", label: "Diary", icon: "clipboard", section: "DAILY_REPORT" },
  { to: "/hseq/observations", label: "HSEQ", icon: "shield", section: "OBSERVATIONS" },
  { to: "/plant", label: "Plant", icon: "truck", section: "PLANT" },
  { to: "/timesheets", label: "Time", icon: "clock", section: "TIMESHEETS" },
];

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => localStorage.getItem("tirgeo.theme") ?? "light");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("tirgeo.theme", theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function NotificationsDrawer({ onClose }: { onClose: () => void }) {
  const { data, loading } = useApiQuery<AppNotification[]>("/api/v1/notifications");
  const toast = useToast();

  const markRead = async (notification: AppNotification) => {
    if (notification.readAt) return;
    try {
      await api(`/api/v1/notifications/${notification.id}/read`, { method: "POST" });
      invalidate("/api/v1/notifications");
    } catch {
      toast.push("Could not mark as read", "error");
    }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" aria-label="Notifications">
        <div className="card-header">
          <h2>Notifications</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close notifications">
            <Icon name="x" />
          </button>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {loading && <div className="spinner" />}
          {!loading && (!data || data.length === 0) && (
            <div className="empty">
              <Icon name="bell" size={26} />
              <b>No notifications yet</b>
              <span>Timecard approvals and safety assignments will land here.</span>
            </div>
          )}
          {data?.map((notification) => (
            <div
              key={notification.id}
              className={"notif" + (notification.readAt ? "" : " unread")}
              onClick={() => markRead(notification)}
              role="button"
              tabIndex={0}
            >
              <b>{notification.title}</b>
              {notification.body && <p>{notification.body}</p>}
              <span className="tiny">
                {formatDateTime(notification.createdAt)}
                {notification.entityType === "Timesheet" && notification.entityId && (
                  <>
                    {" · "}
                    <Link to={`/timesheets?open=${notification.entityId}`} onClick={onClose}>
                      Open timecard
                    </Link>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}

export function Layout({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const { user, logout } = useAuth();
  const path = usePath();
  const [theme, toggleTheme] = useTheme();
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const { data: notifications } = useApiQuery<AppNotification[]>("/api/v1/notifications");
  const unread = notifications?.filter((n) => !n.readAt).length ?? 0;

  useEffect(() => {
    document.title = `${title} · TirGeo`;
  }, [title]);

  useEffect(() => {
    const setMobileViewportOffset = () => {
      const viewport = window.visualViewport;
      const bottomOffset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      document.documentElement.style.setProperty("--visual-viewport-bottom", `${bottomOffset}px`);
    };
    setMobileViewportOffset();
    window.visualViewport?.addEventListener("resize", setMobileViewportOffset);
    window.visualViewport?.addEventListener("scroll", setMobileViewportOffset);
    window.addEventListener("resize", setMobileViewportOffset);
    return () => {
      window.visualViewport?.removeEventListener("resize", setMobileViewportOffset);
      window.visualViewport?.removeEventListener("scroll", setMobileViewportOffset);
      window.removeEventListener("resize", setMobileViewportOffset);
    };
  }, []);

  useEffect(() => {
    setMobileMenu(false);
  }, [path]);

  const visibleGroups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.section || canAccessSection(user, item.section)),
  })).filter((group) => group.items.length > 0);

  const isActive = (to: string) => (to === "/" ? path === "/" : path.startsWith(to));

  const sidebar = (
    <>
      <Link to="/" className="sidebar-logo">
        <span className="logo-mark">T</span>
        <span>
          TirGeo
          <small>Civil operations</small>
        </span>
      </Link>
      {visibleGroups.map((group) => (
        <nav className="nav-section" key={group.title} aria-label={group.title}>
          <div className="nav-section-title">{group.title}</div>
          {group.items.map((item) => (
            <Link key={item.to} to={item.to} className={"nav-item" + (isActive(item.to) ? " active" : "")}>
              <Icon name={item.icon} size={16} />
              {item.label}
            </Link>
          ))}
        </nav>
      ))}
      <nav className="nav-section" aria-label="Account">
        <div className="nav-section-title">Account</div>
        <Link to="/settings" className={"nav-item" + (isActive("/settings") ? " active" : "")}>
          <Icon name="settings" size={16} />
          Settings
        </Link>
        <button
          className="nav-item"
          style={{ width: "100%", background: "none", border: "none", cursor: "pointer", font: "inherit", textAlign: "left" }}
          onClick={() => setNotifOpen(true)}
        >
          <span style={{ position: "relative", display: "inline-flex" }}>
            <Icon name="bell" size={16} />
            {unread > 0 && <span className="unread-dot" style={{ top: -3, right: -3 }} />}
          </span>
          Notifications{unread > 0 ? ` (${unread})` : ""}
        </button>
      </nav>
      <div className="sidebar-footer">
        <span className="avatar">{user ? initials(user.name) : "?"}</span>
        <span className="who">
          <b>{user?.name}</b>
          <span>{user?.role.replaceAll("_", " ")}</span>
        </span>
        <button className="btn-icon" style={{ color: "rgba(244,246,248,0.7)" }} onClick={toggleTheme} aria-label="Toggle dark mode" title="Toggle theme">
          <Icon name={theme === "dark" ? "sun" : "moon"} size={15} />
        </button>
        <button className="btn-icon" style={{ color: "rgba(244,246,248,0.7)" }} onClick={logout} aria-label="Sign out" title="Sign out">
          <Icon name="logout" size={15} />
        </button>
      </div>
    </>
  );

  return (
    <div className="shell">
      <aside className="sidebar">{sidebar}</aside>

      <div className="mobile-topbar">
        <button className="btn-icon" style={{ color: "inherit" }} onClick={() => setMobileMenu(true)} aria-label="Open menu">
          <Icon name="menu" size={20} />
        </button>
        <span className="logo-mark mobile-topbar-logo">T</span>
        <b className="mobile-topbar-title">{title}</b>
        <button className="btn-icon" style={{ color: "inherit", position: "relative" }} onClick={() => setNotifOpen(true)} aria-label="Notifications">
          <Icon name="bell" size={18} />
          {unread > 0 && <span className="unread-dot" />}
        </button>
      </div>

      {mobileMenu && (
        <>
          <div className="drawer-backdrop" onClick={() => setMobileMenu(false)} />
          <aside className="drawer" style={{ left: 0, right: "auto", background: "var(--brand)", color: "var(--brand-ink)" }}>
            <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", flex: 1 }}>{sidebar}</div>
          </aside>
        </>
      )}

      <main className="main">
        <header className="topbar">
          <h1>{title}</h1>
          {actions}
        </header>
        <div className="construction-banner" role="status">
          <Icon name="alert" size={16} />
          <span>
            <b>Under construction.</b> Some functions are still being built and may not be available yet.
          </span>
        </div>
        <div className="content">
          {/* Actions repeated for mobile since the topbar is hidden there */}
          {actions && <div className="row mobile-actions-slot">{null}</div>}
          {children}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Primary">
        {MOBILE_NAV.filter((item) => !item.section || canAccessSection(user, item.section)).map((item) => (
          <Link key={item.to} to={item.to} className={isActive(item.to) ? "active" : ""}>
            <Icon name={item.icon} size={19} />
            {item.label}
          </Link>
        ))}
      </nav>

      {notifOpen && <NotificationsDrawer onClose={() => setNotifOpen(false)} />}
    </div>
  );
}
