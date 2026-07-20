import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, clearSession, getStoredOrganisationId, getStoredUser, getToken, setUnauthorisedHandler, storeSession } from "./api.ts";
import { invalidate } from "./useApi.ts";
import type { AccountSection, AuthUser, LoginResponse, Role } from "./types.ts";
import { navigate } from "./router.tsx";

interface AuthContextValue {
  user: AuthUser | null;
  organisationId: string;
  login: (organisation: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => (getToken() ? getStoredUser<AuthUser>() : null));

  useEffect(() => {
    setUnauthorisedHandler(() => {
      setUser(null);
      invalidate();
      navigate("/login");
    });
  }, []);

  const login = useCallback(async (organisation: string, email: string, password: string) => {
    const result = await api<LoginResponse>("/api/v1/auth/login", {
      method: "POST",
      body: { organisation, email, password },
    });
    storeSession(result.token, result.user, result.organisation.id, result.organisation.slug);
    invalidate();
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    invalidate();
    setUser(null);
    navigate("/login");
  }, []);

  const hasRole = useCallback(
    (...roles: Role[]) => (user ? roles.includes(user.role) : false),
    [user],
  );

  const value = useMemo(
    () => ({ user, organisationId: getStoredOrganisationId(), login, logout, hasRole }),
    [user, login, logout, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

// Role groups mirrored from backend route guards.
export const PROJECT_LEADERS: Role[] = ["OWNER", "ADMIN", "PROJECT_MANAGER", "OPERATIONS_MANAGER"];
export const TIMESHEET_APPROVERS: Role[] = ["OWNER", "ADMIN", "PROJECT_MANAGER", "OPERATIONS_MANAGER", "SUPERVISOR", "SITE_SUPERVISOR", "FOREMAN"];
export const HSEQ_EDITORS: Role[] = ["OWNER", "ADMIN", "PROJECT_MANAGER", "OPERATIONS_MANAGER", "SUPERVISOR", "SITE_SUPERVISOR", "SITE_ENGINEER", "FOREMAN", "SAFETY_MANAGER"];
export const HSEQ_VERIFIERS: Role[] = ["OWNER", "ADMIN", "PROJECT_MANAGER", "OPERATIONS_MANAGER", "SUPERVISOR", "SITE_SUPERVISOR", "SITE_ENGINEER", "SAFETY_MANAGER"];
export const DOCUMENT_AUTHORS: Role[] = ["OWNER", "ADMIN", "PROJECT_MANAGER", "OPERATIONS_MANAGER", "SUPERVISOR", "SITE_SUPERVISOR", "SITE_ENGINEER", "SAFETY_MANAGER"];
export const DOCUMENT_APPROVERS: Role[] = ["OWNER", "ADMIN", "SAFETY_MANAGER"];
export const PAYROLL_MANAGERS: Role[] = ["OWNER", "ADMIN", "PAYROLL"];
export const PLANT_CLEARERS: Role[] = ["OWNER", "ADMIN", "PROJECT_MANAGER", "OPERATIONS_MANAGER", "SAFETY_MANAGER"];
export const TEMPLATE_ADMINS: Role[] = ["OWNER", "ADMIN"];

const COMPLETED_PRE_START_ROLES: Role[] = ["OWNER", "ADMIN", "PROJECT_MANAGER", "OPERATIONS_MANAGER", "SUPERVISOR", "SITE_SUPERVISOR", "SITE_ENGINEER", "FOREMAN", "SAFETY_MANAGER"];
const CHAINAGE_ROLES: Role[] = COMPLETED_PRE_START_ROLES;

export function canAccessSection(user: AuthUser | null | undefined, section: AccountSection): boolean {
  if (!user) return false;
  if (user.sections.includes(section)) return true;
  if (section === "COMPLETED_PRE_STARTS") return COMPLETED_PRE_START_ROLES.includes(user.role);
  if (section === "CHAINAGE") return CHAINAGE_ROLES.includes(user.role);
  return false;
}
