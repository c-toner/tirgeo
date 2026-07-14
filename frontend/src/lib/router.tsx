// Minimal dependency-free hash router.
// Routes look like "#/hseq/hazards"; parameters are matched with ":name".

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode, MouseEvent } from "react";

function currentPath(): string {
  const hash = window.location.hash.replace(/^#/, "");
  return hash.startsWith("/") ? hash : "/" + hash;
}

const RouteContext = createContext<{ path: string }>({ path: "/" });

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const onChange = () => setPath(currentPath());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const value = useMemo(() => ({ path }), [path]);
  return <RouteContext.Provider value={value}>{children}</RouteContext.Provider>;
}

export function usePath(): string {
  return useContext(RouteContext).path;
}

export function navigate(to: string) {
  window.location.hash = to.startsWith("#") ? to : "#" + to;
}

/** Match a pattern like "/commercial/tenders/:id" against the current path. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("?")[0].split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const p = patternParts[i];
    if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(pathParts[i]);
    else if (p !== pathParts[i]) return null;
  }
  return params;
}

export function Link({
  to,
  children,
  className,
  onClick,
  title,
  style,
  "aria-label": ariaLabel,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  title?: string;
  style?: Record<string, string | number>;
  "aria-label"?: string;
}) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    onClick?.();
    navigate(to);
  };
  return (
    <a href={"#" + to} className={className} onClick={handle} title={title} style={style} aria-label={ariaLabel}>
      {children}
    </a>
  );
}
