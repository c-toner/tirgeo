// Typed fetch client for the TirGeo API.
//
// Security notes:
// - The JWT is held in sessionStorage (cleared when the browser closes) and is
//   only ever sent as an Authorization header to the configured API origin.
// - 401 responses clear the session and bounce to the login screen.
// - Validation errors (Zod, code VALIDATION_ERROR) are surfaced field-by-field.

const TOKEN_KEY = "tirgeo.token";
const USER_KEY = "tirgeo.user";
const ORG_KEY = "tirgeo.organisationId";
const ORG_IDENTIFIER_KEY = "tirgeo.organisation";
const API_BASE_KEY = "tirgeo.apiBase";
const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, "") ?? "";

export interface FieldIssue {
  path: Array<string | number>;
  message: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: FieldIssue[];
  body?: unknown;

  constructor(status: number, message: string, code?: string, details?: FieldIssue[], body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.body = body;
  }

  /** Map of dotted field path -> message for inline form errors. */
  fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const issue of this.details ?? []) {
      map[issue.path.join(".")] = issue.message;
    }
    return map;
  }
}

export function getApiBase(): string {
  // Same-origin by default (vite dev proxy / reverse proxy in production).
  return localStorage.getItem(API_BASE_KEY) ?? DEFAULT_API_BASE;
}

export function setApiBase(base: string) {
  const trimmed = base.trim().replace(/\/+$/, "");
  if (trimmed) localStorage.setItem(API_BASE_KEY, trimmed);
  else localStorage.removeItem(API_BASE_KEY);
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function getStoredUser<T>(): T | null {
  const raw = sessionStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getStoredOrganisationId(): string {
  return localStorage.getItem(ORG_KEY) ?? "";
}

export function getStoredOrganisationIdentifier(): string {
  return localStorage.getItem(ORG_IDENTIFIER_KEY) ?? localStorage.getItem(ORG_KEY) ?? "";
}

export function storeSession(token: string, user: unknown, organisationId: string, organisationIdentifier: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.setItem(ORG_KEY, organisationId);
  localStorage.setItem(ORG_IDENTIFIER_KEY, organisationIdentifier);
}

export function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

let onUnauthorised: (() => void) | null = null;
export function setUnauthorisedHandler(handler: () => void) {
  onUnauthorised = handler;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Raw FormData for multipart uploads; body is ignored when set. */
  formData?: FormData;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, formData, query, signal } = options;
  const url = new URL(getApiBase() + path, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !formData) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "Cannot reach the TirGeo API. Check your connection and API address.");
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown = undefined;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const data = (payload ?? {}) as {
      error?: string;
      message?: string;
      code?: string;
      details?: FieldIssue[];
      issues?: unknown[];
    };
    const isRecoverableAuthCheck =
      path.startsWith("/api/v1/auth/login") ||
      path.endsWith("/verify-signing-pin") ||
      path === "/api/v1/auth/signature-pin";
    if (response.status === 401 && getToken() && !isRecoverableAuthCheck) {
      // Token expired or account revoked — reset the session.
      clearSession();
      onUnauthorised?.();
    }
    const message =
      data.error ?? data.message ?? `Request failed (${response.status} ${response.statusText})`;
    throw new ApiError(response.status, message, data.code, data.details, payload);
  }

  return payload as T;
}

export const HTTP_HINTS: Record<number, string> = {
  0: "Network problem — the API could not be reached.",
  400: "The request was invalid. Check the highlighted fields.",
  401: "Your session is no longer valid. Sign in again.",
  403: "Your role does not allow this action.",
  404: "That record was not found in your organisation.",
  409: "A business rule blocked this change. Refresh and review the record.",
  422: "A required dependency is missing (for example payroll mappings).",
  429: "Too many attempts. Wait a moment and try again.",
};
