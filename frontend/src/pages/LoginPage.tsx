import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../lib/auth.tsx";
import { navigate } from "../lib/router.tsx";
import { ApiError, getApiBase, getStoredOrganisationIdentifier, setApiBase } from "../lib/api.ts";
import { ErrorAlert, Field, Icon, TextInput } from "../components/ui.tsx";

export function LoginPage() {
  const { login } = useAuth();
  const [organisation, setOrganisation] = useState(getStoredOrganisationIdentifier());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [apiBase, setApiBaseState] = useState(getApiBase());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setApiBase(apiBase);
    try {
      await login(organisation.trim(), email.trim(), password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
    } finally {
      setBusy(false);
    }
  };

  const fieldErrors = error?.fieldErrors() ?? {};

  return (
    <div className="login-wrap">
      <div className="login-panel">
        <div className="row" style={{ gap: 12 }}>
          <span className="logo-mark" style={{ width: 40, height: 40, fontSize: 20, borderRadius: 10 }}>T</span>
          <div>
            <h1 style={{ fontSize: 24 }}>TirGeo</h1>
            <span className="muted">Civil construction operations</span>
          </div>
        </div>

        <form className="stack" style={{ gap: 14 }} onSubmit={submit}>
          <ErrorAlert error={error} onDismiss={() => setError(null)} />
          <Field
            label="Organisation"
            required
            error={fieldErrors["organisation"]}
            hint="Use your company name"
          >
            <TextInput value={organisation} onChange={setOrganisation} placeholder="Tirgeo Civil" autoComplete="organization" />
          </Field>
          <Field label="Email" required error={fieldErrors["email"]}>
            <TextInput value={email} onChange={setEmail} type="email" placeholder="you@company.com.au" autoComplete="username" inputMode="email" />
          </Field>
          <Field label="Password" required error={fieldErrors["password"]}>
            <TextInput value={password} onChange={setPassword} type="password" autoComplete="current-password" />
          </Field>

          <button className="btn btn-primary" style={{ padding: "11px 14px", fontSize: 14.5 }} disabled={busy || !organisation || !email || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ alignSelf: "flex-start" }}
            onClick={() => setShowAdvanced((s) => !s)}
          >
            <Icon name="settings" size={13} /> {showAdvanced ? "Hide" : "Advanced"} connection settings
          </button>

          {showAdvanced && (
            <Field
              label="API address"
              hint="Leave blank to use this site's own origin (recommended — the dev server proxies to localhost:3000). Set only when the API runs on a different origin listed in its CORS_ORIGINS."
            >
              <TextInput value={apiBase} onChange={setApiBaseState} mono placeholder="https://api.example.com.au" />
            </Field>
          )}
        </form>

        <p className="tiny">
          Sessions last 12 hours and are held only in this browser tab's session storage. Signing in
          re-checks your account and role on every request.
        </p>
      </div>

      <div className="login-hero">
        <h2>Every shift, signed and defensible.</h2>
        <p>
          Pre-starts, SWMS sign-ons, cost-coded timecards and payroll exports — captured in the field,
          verified in the office, evidenced end to end.
        </p>
      </div>
    </div>
  );
}
