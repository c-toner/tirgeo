import { useEffect, useState } from "react";
import { Layout } from "../components/Layout.tsx";
import { EmptyState, ErrorAlert, Field, Loading, Modal, Select, TextArea, TextInput, useToast } from "../components/ui.tsx";
import { WorkerSelect } from "../components/WorkerSelect.tsx";
import { api, getApiBase, setApiBase } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { getMyWorkerId, setMyWorkerId } from "../lib/recents.ts";
import { invalidate, useApiQuery, useMutation } from "../lib/useApi.ts";
import type { AccountSection, Role, WorkerSummary } from "../lib/types.ts";

interface AccountRecord {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  address?: Address | null;
  role: Role;
  active: boolean;
  sections: AccountSection[];
  sectionOverrides: Array<{ section: AccountSection; enabled: boolean }>;
  worker?: WorkerSummary | null;
  payrollDetails?: PayrollDetails | null;
}

interface Address {
  line1?: string;
  line2?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  country?: string;
}

interface PayrollDetails {
  paymentMethod: "BANK_ACCOUNT" | "BPAY";
  accountName?: string;
  bsb?: string;
  accountNumber?: string;
  bpayBillerCode?: string;
  bpayCustomerReference?: string;
}

const ROLES: Role[] = ["OWNER", "ADMIN", "PROJECT_MANAGER", "OPERATIONS_MANAGER", "SUPERVISOR", "SITE_SUPERVISOR", "SITE_ENGINEER", "FOREMAN", "SAFETY_MANAGER", "PAYROLL", "WORKER", "SUBCONTRACTOR", "CLIENT_AUDITOR"];
const MANAGER_CREATE_ROLES: Role[] = ["SITE_SUPERVISOR", "SITE_ENGINEER", "FOREMAN", "SAFETY_MANAGER", "WORKER", "SUBCONTRACTOR", "CLIENT_AUDITOR"];
const SECTION_LABELS: Record<AccountSection, string> = {
  DASHBOARD: "Dashboard",
  PROJECTS: "Projects",
  DAILY_REPORT: "Daily diary",
  HAZARDS: "Hazards",
  OBSERVATIONS: "Observations",
  INSPECTIONS: "Inspections",
  PERMITS: "Permits",
  CORRECTIVE_ACTIONS: "Corrective actions",
  SAFETY_DOCUMENTS: "Safety documents",
  MY_SAFETY: "My sign-ons",
  PLANT: "Plant & pre-starts",
  PLANT_MANAGEMENT: "Plant management",
  TIMESHEETS: "Timesheets",
  PAYROLL: "Payroll",
  COMMERCIAL: "Commercial",
  WORKER_DIRECTORY: "Worker directory",
  USER_ADMIN: "User admin",
  SETTINGS: "Settings",
};

function compactAddress(address?: Address | null) {
  return [address?.line1, address?.line2, address?.suburb, address?.state, address?.postcode].filter(Boolean).join(", ");
}

function splitAddress(value: string): Address {
  const [line1, line2, suburb, state, postcode] = value.split("\n").map(part => part.trim());
  return { line1, line2, suburb, state, postcode, country: "Australia" };
}

function sectionOverrides(sections: AccountSection[]) {
  return Object.keys(SECTION_LABELS).map(section => ({ section: section as AccountSection, enabled: sections.includes(section as AccountSection) }));
}

function canCreateUsers(role?: Role) {
  return role === "OWNER" || role === "ADMIN" || role === "PROJECT_MANAGER" || role === "OPERATIONS_MANAGER" || role === "SITE_SUPERVISOR";
}

function AccountForm({ me }: { me: AccountRecord }) {
  const toast = useToast();
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState(me.email);
  const [phone, setPhone] = useState(me.phone ?? "");
  const [address, setAddress] = useState(compactAddress(me.address).replaceAll(", ", "\n"));
  const [paymentMethod, setPaymentMethod] = useState<PayrollDetails["paymentMethod"]>(me.payrollDetails?.paymentMethod ?? "BANK_ACCOUNT");
  const [accountName, setAccountName] = useState(me.payrollDetails?.accountName ?? "");
  const [bsb, setBsb] = useState(me.payrollDetails?.bsb ?? "");
  const [accountNumber, setAccountNumber] = useState(me.payrollDetails?.accountNumber ?? "");
  const [bpayBillerCode, setBpayBillerCode] = useState(me.payrollDetails?.bpayBillerCode ?? "");
  const [bpayCustomerReference, setBpayCustomerReference] = useState(me.payrollDetails?.bpayCustomerReference ?? "");
  const mutation = useMutation(
    () =>
      api<AccountRecord>("/api/v1/account/me", {
        method: "PUT",
        body: {
          name,
          email,
          phone: phone || null,
          address: splitAddress(address),
          payrollDetails: {
            paymentMethod,
            accountName: accountName || undefined,
            bsb: bsb || undefined,
            accountNumber: accountNumber || undefined,
            bpayBillerCode: bpayBillerCode || undefined,
            bpayCustomerReference: bpayCustomerReference || undefined,
          },
        },
      }),
    ["/api/v1/account/me"],
  );

  return (
    <section className="card card-pad stack">
      <div>
        <h2>Personal details</h2>
        <p className="muted">These details identify you in TirGeo and can feed payroll setup when you have a linked worker record.</p>
      </div>
      <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
      <div className="grid grid-2">
        <Field label="Name" required><TextInput value={name} onChange={setName} autoComplete="name" /></Field>
        <Field label="Email" required><TextInput value={email} onChange={setEmail} type="email" inputMode="email" autoComplete="email" /></Field>
        <Field label="Phone"><TextInput value={phone} onChange={setPhone} autoComplete="tel" /></Field>
        <Field label="Address" span2><TextArea value={address} onChange={setAddress} rows={4} placeholder={"Street\nSuburb\nState\nPostcode"} /></Field>
      </div>
      <div className="grid grid-2">
        <Field label="Payroll method"><Select value={paymentMethod} onChange={(value) => setPaymentMethod(value as PayrollDetails["paymentMethod"])} options={[{ value: "BANK_ACCOUNT", label: "Bank account" }, { value: "BPAY", label: "BPAY" }]} /></Field>
        {paymentMethod === "BANK_ACCOUNT" ? (
          <>
            <Field label="Account name" required><TextInput value={accountName} onChange={setAccountName} /></Field>
            <Field label="BSB" required><TextInput value={bsb} onChange={setBsb} placeholder="000-000" /></Field>
            <Field label="Account number" required><TextInput value={accountNumber} onChange={setAccountNumber} /></Field>
          </>
        ) : (
          <>
            <Field label="Biller code" required><TextInput value={bpayBillerCode} onChange={setBpayBillerCode} /></Field>
            <Field label="Customer reference" required><TextInput value={bpayCustomerReference} onChange={setBpayCustomerReference} /></Field>
          </>
        )}
      </div>
      <button className="btn btn-primary" disabled={mutation.running} onClick={() => mutation.run({ onSuccess: () => toast.push("Account details saved") })}>
        {mutation.running ? "Saving..." : "Save account details"}
      </button>
    </section>
  );
}

function UserAccessModal({ account, onClose }: { account: AccountRecord; onClose: () => void }) {
  const toast = useToast();
  const [role, setRole] = useState<Role>(account.role);
  const [active, setActive] = useState(account.active);
  const [sections, setSections] = useState<AccountSection[]>(account.sections);
  const mutation = useMutation(
    () =>
      api<AccountRecord>(`/api/v1/account/users/${account.id}`, {
        method: "PATCH",
        body: { role, active, sectionOverrides: sectionOverrides(sections) },
      }),
    ["/api/v1/account/users"],
  );

  const toggle = (section: AccountSection) => {
    setSections(current => current.includes(section) ? current.filter(item => item !== section) : [...current, section]);
  };

  return (
    <Modal
      title={`Access for ${account.name}`}
      onClose={onClose}
      large
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={mutation.running} onClick={() => mutation.run({ onSuccess: () => { toast.push("User access saved"); invalidate("/api/v1/account/users"); onClose(); } })}>
            {mutation.running ? "Saving..." : "Save access"}
          </button>
        </>
      }
    >
      <div className="stack">
        <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
        <div className="grid grid-2">
          <Field label="Role"><Select value={role} onChange={(value) => setRole(value as Role)} options={ROLES.map(value => ({ value, label: value.replaceAll("_", " ") }))} /></Field>
          <label className="field">
            <span>Active</span>
            <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          </label>
        </div>
        <div className="grid grid-2">
          {(Object.keys(SECTION_LABELS) as AccountSection[]).map(section => (
            <label key={section} className="check-card">
              <input type="checkbox" checked={sections.includes(section)} onChange={() => toggle(section)} />
              <span>{SECTION_LABELS[section]}</span>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function CreateUserModal({ currentUserRole, onClose }: { currentUserRole: Role; onClose: () => void }) {
  const toast = useToast();
  const roleOptions = currentUserRole === "PROJECT_MANAGER" || currentUserRole === "OPERATIONS_MANAGER" || currentUserRole === "SITE_SUPERVISOR" ? MANAGER_CREATE_ROLES : ROLES;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(roleOptions.includes("WORKER") ? "WORKER" : roleOptions[0]!);
  const [createWorker, setCreateWorker] = useState(true);
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [employmentType, setEmploymentType] = useState("Employee");
  const [classification, setClassification] = useState("");

  const mutation = useMutation(
    () =>
      api<AccountRecord>("/api/v1/account/users", {
        method: "POST",
        body: {
          name,
          email,
          password,
          role,
          worker: createWorker
            ? {
                employeeNumber,
                firstName: firstName || name.split(/\s+/)[0] || name,
                lastName: lastName || name.split(/\s+/).slice(1).join(" ") || "-",
                employmentType,
                classification: classification || undefined,
              }
            : undefined,
        },
      }),
    ["/api/v1/account/users"],
  );

  const canSubmit =
    name.trim().length >= 2 &&
    email.includes("@") &&
    password.length >= 10 &&
    (!createWorker || (employeeNumber.trim().length > 0 && (firstName.trim().length > 0 || name.trim().length > 0)));

  return (
    <Modal
      title="Create user"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={mutation.running || !canSubmit} onClick={() => mutation.run({ onSuccess: () => { toast.push("User created"); invalidate("/api/v1/account/users"); onClose(); } })}>
            {mutation.running ? "Creating..." : "Create user"}
          </button>
        </>
      }
    >
      <div className="stack">
        <ErrorAlert error={mutation.error} onDismiss={mutation.reset} />
        <div className="grid grid-2">
          <Field label="Full name" required><TextInput value={name} onChange={setName} autoComplete="name" /></Field>
          <Field label="Email" required><TextInput value={email} onChange={setEmail} type="email" inputMode="email" autoComplete="email" /></Field>
          <Field label="Temporary password" required hint="Minimum 10 characters.">
            <TextInput value={password} onChange={setPassword} type="password" autoComplete="new-password" />
          </Field>
          <Field label="Role" required>
            <Select value={role} onChange={(value) => setRole(value as Role)} options={roleOptions.map(value => ({ value, label: value.replaceAll("_", " ") }))} />
          </Field>
        </div>
        <label className="check-card">
          <input type="checkbox" checked={createWorker} onChange={(event) => setCreateWorker(event.target.checked)} />
          <span>Create linked worker record for timecards, pre-starts and sign-ons</span>
        </label>
        {createWorker && (
          <div className="grid grid-2">
            <Field label="Employee number" required><TextInput value={employeeNumber} onChange={setEmployeeNumber} mono placeholder="EMP-004" /></Field>
            <Field label="Employment type"><TextInput value={employmentType} onChange={setEmploymentType} /></Field>
            <Field label="First name"><TextInput value={firstName} onChange={setFirstName} placeholder={name.split(/\s+/)[0] || "First"} /></Field>
            <Field label="Last name"><TextInput value={lastName} onChange={setLastName} placeholder={name.split(/\s+/).slice(1).join(" ") || "Last"} /></Field>
            <Field label="Classification" span2><TextInput value={classification} onChange={setClassification} placeholder="Labourer, Operator, Supervisor..." /></Field>
          </div>
        )}
      </div>
    </Modal>
  );
}

function UserAdminPanel() {
  const { user } = useAuth();
  const { data, loading, error } = useApiQuery<AccountRecord[]>("/api/v1/account/users");
  const [selected, setSelected] = useState<AccountRecord | null>(null);
  const [creating, setCreating] = useState(false);
  if (loading) return <section className="card card-pad"><Loading /></section>;
  if (error) return <ErrorAlert error={error} />;
  return (
    <section className="card card-pad stack">
      <div className="row-between">
        <div>
          <h2>User access</h2>
          <p className="muted">Owners and admins can manage roles and the exact sections each user sees when they sign in.</p>
        </div>
        {user && canCreateUsers(user.role) && <button className="btn btn-primary" onClick={() => setCreating(true)}>Create user</button>}
      </div>
      {!data?.length && <EmptyState title="No users found" />}
      {data?.map(account => (
        <div key={account.id} className="list-row">
          <div>
            <b>{account.name}</b>
            <div className="muted">{account.email} · {account.role.replaceAll("_", " ")} · {account.sections.length} sections</div>
          </div>
          <button className="btn" onClick={() => setSelected(account)}>Manage</button>
        </div>
      ))}
      {selected && <UserAccessModal account={selected} onClose={() => setSelected(null)} />}
      {creating && user && <CreateUserModal currentUserRole={user.role} onClose={() => setCreating(false)} />}
    </section>
  );
}

function CreateCrewPanel() {
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  if (!user || !canCreateUsers(user.role) || user.sections.includes("USER_ADMIN")) return null;
  return (
    <section className="card card-pad stack">
      <div className="row-between">
        <div>
          <h2>Create crew login</h2>
          <p className="muted">Create a basic account with an email and temporary password. Invites can come later.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>Create user</button>
      </div>
      {creating && <CreateUserModal currentUserRole={user.role} onClose={() => setCreating(false)} />}
    </section>
  );
}

export function SettingsPage() {
  const { user, organisationId } = useAuth();
  const toast = useToast();
  const { data: me, loading: meLoading, error: meError } = useApiQuery<AccountRecord>("/api/v1/account/me");
  const [pin, setPin] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const pinMutation = useMutation(
    () => api("/api/v1/auth/signature-pin", { method: "PUT", body: { pin, currentPin: currentPin || undefined } }),
    [],
  );
  const [workerId, setWorkerId] = useState(() => getMyWorkerId() || user?.worker?.id || "");
  const [apiBase, setApiBaseState] = useState(getApiBase());

  useEffect(() => {
    if (me?.worker?.id && !workerId) setWorkerId(me.worker.id);
  }, [me?.worker?.id, workerId]);

  return (
    <Layout title="Settings">
      <section className="card card-pad stack">
        <h2>Account</h2>
        <div className="grid grid-2">
          <div className="field"><label>Signed in as</label><span>{user?.name} <span className="badge no-dot">{user?.role.replaceAll("_", " ")}</span></span></div>
          <div className="field"><label>Organisation</label><span className="mono" style={{ fontSize: 13 }}>{organisationId || "-"}</span></div>
        </div>
      </section>

      {meLoading && <section className="card card-pad"><Loading /></section>}
      {meError && <ErrorAlert error={meError} />}
      {me && <AccountForm me={me} />}

      <section className="card card-pad stack">
        <div><h2>Signing PIN</h2><p className="muted">Your 4-digit PIN unlocks on-site countersigning on a shared device.</p></div>
        <ErrorAlert error={pinMutation.error} onDismiss={pinMutation.reset} />
        <div className="row" style={{ alignItems: "flex-end" }}>
          {!user?.signaturePinRequired && <Field label="Current PIN"><TextInput value={currentPin} onChange={setCurrentPin} type="password" inputMode="numeric" maxLength={4} placeholder="0000" /></Field>}
          <Field label={user?.signaturePinRequired ? "Create PIN" : "New PIN"} required><TextInput value={pin} onChange={setPin} type="password" inputMode="numeric" maxLength={4} placeholder="0000" /></Field>
          <button className="btn btn-primary" style={{ marginBottom: 4 }} disabled={pinMutation.running || !/^\d{4}$/.test(pin)} onClick={() => pinMutation.run({ onSuccess: () => { toast.push("Signing PIN saved"); setPin(""); setCurrentPin(""); } })}>
            {pinMutation.running ? "Saving..." : "Save PIN"}
          </button>
        </div>
      </section>

      <section className="card card-pad stack">
        <div><h2>My worker record</h2><p className="muted">Timecards, plant pre-starts and action ownership use worker records.</p></div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <Field label="Worker"><WorkerSelect value={workerId} onChange={setWorkerId} allowEmpty autoSelectCurrent={false} emptyLabel="Use linked worker" /></Field>
          <button className="btn btn-primary" style={{ marginBottom: 4 }} onClick={() => { setMyWorkerId(workerId); toast.push(workerId.trim() ? "Worker preference saved on this device" : "Worker preference cleared"); }}>Save</button>
        </div>
      </section>

      {user?.sections.includes("USER_ADMIN") && <UserAdminPanel />}
      <CreateCrewPanel />

      <section className="card card-pad stack">
        <div><h2>Connection</h2><p className="muted">Leave blank to call the API on this site's own origin.</p></div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <Field label="API address"><TextInput value={apiBase} onChange={setApiBaseState} mono placeholder="https://api.example.com.au" /></Field>
          <button className="btn btn-primary" style={{ marginBottom: 4 }} onClick={() => { setApiBase(apiBase); toast.push("API address saved"); }}>Save</button>
        </div>
      </section>
    </Layout>
  );
}
