import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode, ChangeEvent } from "react";
import type { ApiError } from "../lib/api.ts";
import { HTTP_HINTS } from "../lib/api.ts";
import { titleCase } from "../lib/format.ts";
import type { RiskLevel } from "../lib/types.ts";

/* ---------- Toasts ---------- */

interface Toast {
  id: number;
  text: string;
  kind: "success" | "error" | "info";
}

const ToastContext = createContext<{ push: (text: string, kind?: Toast["kind"]) => void }>({
  push: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast["kind"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, text, kind }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 4600);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            <span className="toast-dot" />
            <span>{toast.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/* ---------- Error alert ---------- */

export function ErrorAlert({ error, onDismiss }: { error: ApiError | null; onDismiss?: () => void }) {
  if (!error) return null;
  const hint = HTTP_HINTS[error.status];
  return (
    <div className="alert alert-error" role="alert">
      <div style={{ flex: 1 }}>
        <b>{error.message}</b>
        {hint && error.message !== hint && <div style={{ fontWeight: 400, marginTop: 2 }}>{hint}</div>}
      </div>
      {onDismiss && (
        <button className="btn-icon" onClick={onDismiss} aria-label="Dismiss">
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

/* ---------- Form field ---------- */

export function Field({
  label,
  required,
  error,
  hint,
  children,
  span2,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
  span2?: boolean;
}) {
  return (
    <div className={"field" + (span2 ? " span-2" : "")}>
      <label>
        {label} {required && <span className="req">*</span>}
      </label>
      {children}
      {error && <span className="field-error">{error}</span>}
      {!error && hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  type = "text",
  placeholder,
  invalid,
  mono,
  autoFocus,
  min,
  max,
  step,
  disabled,
  autoComplete,
  inputMode,
  maxLength,
}: {
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  invalid?: boolean;
  mono?: boolean;
  autoFocus?: boolean;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  disabled?: boolean;
  autoComplete?: string;
  inputMode?: "numeric" | "decimal" | "text" | "email";
  maxLength?: number;
}) {
  return (
    <input
      className={"input" + (invalid ? " invalid" : "") + (mono ? " mono" : "")}
      type={type}
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      autoComplete={autoComplete}
      inputMode={inputMode}
      maxLength={maxLength}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  invalid,
  rows,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  rows?: number;
}) {
  return (
    <textarea
      className={"input" + (invalid ? " invalid" : "")}
      value={value}
      rows={rows ?? 3}
      placeholder={placeholder}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  allowEmpty,
  emptyLabel,
  invalid,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }> | string[];
  allowEmpty?: boolean;
  emptyLabel?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const items = options.map((option) =>
    typeof option === "string" ? { value: option, label: titleCase(option) } : option,
  );
  return (
    <select
      className={"input" + (invalid ? " invalid" : "")}
      value={value}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
    >
      {allowEmpty && <option value="">{emptyLabel ?? "— Select —"}</option>}
      {items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  );
}

/* ---------- Badges ---------- */

const STATUS_TONES: Record<string, string> = {
  DRAFT: "",
  SUBMITTED: "badge-warning",
  APPROVED: "badge-good",
  REJECTED: "badge-critical",
  ACTIVE: "badge-good",
  INACTIVE: "",
  CLOSED: "",
  CANCELLED: "badge-critical",
  // Projects
  TENDER: "badge-primary",
  AWARDED: "badge-primary",
  MOBILISING: "badge-warning",
  ON_HOLD: "badge-serious",
  PRACTICAL_COMPLETION: "badge-good",
  DEFECTS_LIABILITY: "badge-warning",
  // Permits
  REQUESTED: "badge-warning",
  SUSPENDED: "badge-serious",
  // Plant
  AVAILABLE: "badge-good",
  IN_USE: "badge-primary",
  DEFECT_REPORTED: "badge-serious",
  OUT_OF_SERVICE: "badge-critical",
  PASS: "badge-good",
  DEFECT: "badge-serious",
  // Hazards
  IDENTIFIED: "badge-serious",
  ASSESSED: "badge-warning",
  CONTROLLED: "badge-good",
  // Payroll
  READY: "badge-primary",
  SENDING: "badge-warning",
  SENT: "badge-good",
  RECONCILED: "badge-good",
  FAILED: "badge-critical",
  QUEUED: "badge-warning",
  // Docs / tender
  PROCESSING: "badge-warning",
  REVIEW_REQUIRED: "badge-warning",
  NO_REQUIREMENTS_FOUND: "",
  CONFIRMED: "badge-good",
  SUGGESTED: "badge-warning",
  TODO: "",
  IN_PROGRESS: "badge-primary",
  COMPLETE: "badge-good",
  NOT_APPLICABLE: "",
  PUBLISHED: "badge-good",
  CONFIGURED: "badge-primary",
  CONNECTED: "badge-good",
  PENDING: "badge-warning",
};

export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="muted">—</span>;
  return <span className={`badge ${STATUS_TONES[status] ?? ""}`}>{titleCase(status)}</span>;
}

const RISK_TONES: Record<RiskLevel, string> = {
  LOW: "badge-good",
  MEDIUM: "badge-warning",
  HIGH: "badge-serious",
  EXTREME: "badge-critical",
};

export function RiskBadge({ level }: { level?: RiskLevel | null }) {
  if (!level) return <span className="muted">—</span>;
  return <span className={`badge ${RISK_TONES[level]}`}>{titleCase(level)}</span>;
}

/* ---------- Modal ---------- */

export function Modal({
  title,
  onClose,
  children,
  footer,
  large,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  large?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event: { target: unknown; currentTarget: unknown }) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={"modal" + (large ? " modal-lg" : "")} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close dialog">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Empty & loading ---------- */

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name="inbox" size={30} />
      <b>{title}</b>
      {hint && <span style={{ maxWidth: 420 }}>{hint}</span>}
      {action}
    </div>
  );
}

export function Loading() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}

/* ---------- Icons (inline SVG, stroke style) ---------- */

const PATHS: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  projects: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9 21v-6h6v6" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  truck: (
    <>
      <path d="M1 8h13v8H1z" />
      <path d="M14 11h4l3 3v2h-7" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2" />
      <path d="M3 13h18" />
    </>
  ),
  dollars: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v12M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 1-3 2.3c0 3.4 6 1.6 6 5 0 1.3-1.3 2.2-3 2.2s-3-1-3-2.4" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4a2 2 0 012-2h2a2 2 0 012 2" />
      <path d="M9 10h6M9 14h6M9 18h3" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 20a2 2 0 004 0" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1 1.55V21a2 2 0 11-4 0v-.09a1.7 1.7 0 00-1-1.55 1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.55-1H3a2 2 0 110-4h.09a1.7 1.7 0 001.55-1 1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06a1.7 1.7 0 001.87.34h.01a1.7 1.7 0 001-1.55V3a2 2 0 114 0v.09a1.7 1.7 0 001 1.55h.01a1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.87v.01a1.7 1.7 0 001.55 1H21a2 2 0 110 4h-.09a1.7 1.7 0 00-1.55 1z" />
    </>
  ),
  x: <path d="M18 6L6 18M6 6l12 12" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M4 12.5l5 5L20 7" />,
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5 4h14l3 8v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6z" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v4M12 17.5v.5" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </>
  ),
  chevron: <path d="M9 6l6 6-6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" />
    </>
  ),
  upload: (
    <>
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <path d="M12 3v12M7 8l5-5 5 5" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
    </>
  ),
  hardhat: (
    <>
      <path d="M2 17h20v3H2z" />
      <path d="M4 17v-2a8 8 0 0116 0v2" />
      <path d="M10 5h4v4h-4z" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  pen: (
    <>
      <path d="M17 3l4 4L8 20l-5 1 1-5z" />
    </>
  ),
};

export function Icon({ name, size = 17 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name] ?? <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}

/* ---------- Stat tile ---------- */

export function StatTile({
  label,
  value,
  tone = "neutral",
  foot,
  href,
}: {
  label: string;
  value: number | string;
  tone?: "critical" | "serious" | "warning" | "good" | "neutral" | "primary";
  foot?: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {foot && <span className="stat-foot">{foot}</span>}
    </>
  );
  if (href) {
    return (
      <a className={`stat-tile tone-${tone}`} href={"#" + href}>
        {body}
      </a>
    );
  }
  return <div className={`stat-tile tone-${tone}`}>{body}</div>;
}
