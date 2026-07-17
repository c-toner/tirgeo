import { useState } from "react";
import { Layout } from "../components/Layout.tsx";
import { ErrorAlert, Field, TextInput, useToast } from "../components/ui.tsx";
import { WorkerSelect } from "../components/WorkerSelect.tsx";
import { api, getApiBase, setApiBase } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { getMyWorkerId, setMyWorkerId } from "../lib/recents.ts";
import { useMutation } from "../lib/useApi.ts";

export function SettingsPage() {
  const { user, organisationId } = useAuth();
  const toast = useToast();

  const [pin, setPin] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const pinMutation = useMutation(
    () =>
      api("/api/v1/auth/signature-pin", {
        method: "PUT",
        body: { pin, currentPin: currentPin || undefined },
      }),
    [],
  );

  const [workerId, setWorkerId] = useState(() => getMyWorkerId() || user?.worker?.id || "");
  const [apiBase, setApiBaseState] = useState(getApiBase());

  return (
    <Layout title="Settings">
      <section className="card card-pad stack">
        <h2>Account</h2>
        <div className="grid grid-2">
          <div className="field">
            <label>Signed in as</label>
            <span>
              {user?.name} <span className="badge no-dot">{user?.role.replaceAll("_", " ")}</span>
            </span>
          </div>
          <div className="field">
            <label>Organisation</label>
            <span className="mono" style={{ fontSize: 13 }}>{organisationId || "—"}</span>
          </div>
        </div>
      </section>

      <section className="card card-pad stack">
        <div>
          <h2>Signing PIN</h2>
          <p className="muted">
            Your 4-digit PIN unlocks on-site countersigning on a shared device — the approval is audited to you, not
            the logged-in worker. Five failed attempts locks the PIN for 15 minutes.
          </p>
        </div>
        <ErrorAlert error={pinMutation.error} onDismiss={pinMutation.reset} />
        <div className="row" style={{ alignItems: "flex-end" }}>
          {!user?.signaturePinRequired && (
            <Field label="Current PIN" hint="Required when changing an existing PIN.">
              <TextInput value={currentPin} onChange={setCurrentPin} type="password" inputMode="numeric" maxLength={4} placeholder="••••" />
            </Field>
          )}
          <Field label={user?.signaturePinRequired ? "Create PIN" : "New PIN"} required>
            <TextInput value={pin} onChange={setPin} type="password" inputMode="numeric" maxLength={4} placeholder="••••" />
          </Field>
          <button
            className="btn btn-primary"
            style={{ marginBottom: 4 }}
            disabled={pinMutation.running || !/^\d{4}$/.test(pin)}
            onClick={() =>
              pinMutation.run({
                onSuccess: () => {
                  toast.push("Signing PIN saved");
                  setPin("");
                  setCurrentPin("");
                },
              })
            }
          >
            {pinMutation.running ? "Saving…" : "Save PIN"}
          </button>
        </div>
      </section>

      <section className="card card-pad stack">
        <div>
          <h2>My worker record</h2>
          <p className="muted">
            Timecards, plant pre-starts and action ownership use worker records. Your linked worker is listed first;
            save an override on this device only if an administrator asks you to.
          </p>
        </div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <Field label="Worker">
            <WorkerSelect value={workerId} onChange={setWorkerId} allowEmpty autoSelectCurrent={false} emptyLabel="Use linked worker" />
          </Field>
          <button
            className="btn btn-primary"
            style={{ marginBottom: 4 }}
            onClick={() => {
              setMyWorkerId(workerId);
              toast.push(workerId.trim() ? "Worker preference saved on this device" : "Worker preference cleared");
            }}
          >
            Save
          </button>
        </div>
      </section>

      <section className="card card-pad stack">
        <div>
          <h2>Connection</h2>
          <p className="muted">
            Leave blank to call the API on this site's own origin (the dev server proxies to localhost:3000). Set only
            for cross-origin deployments allowed by the API's CORS_ORIGINS.
          </p>
        </div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <Field label="API address">
            <TextInput value={apiBase} onChange={setApiBaseState} mono placeholder="https://api.example.com.au" />
          </Field>
          <button
            className="btn btn-primary"
            style={{ marginBottom: 4 }}
            onClick={() => {
              setApiBase(apiBase);
              toast.push("API address saved");
            }}
          >
            Save
          </button>
        </div>
      </section>
    </Layout>
  );
}
