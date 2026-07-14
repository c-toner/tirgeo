# TirGeo backend

TirGeo is an offline-capable operations platform for an Australian civil contractor. Each deployment is intended for one company with many employees, subcontractors, projects and plant assets.

## Included domains

- Workforce: employees, roles, competencies, licences, inductions and expiry tracking
- Time and payroll inputs: cost-coded timesheets, breaks, overtime, allowances, approvals, correction reasons, pay-run/STP export staging
- Plant: excavators, rollers and other assets; meter readings, service triggers, configurable pre-starts, defects and automatic out-of-service status
- WHS: SWMS/JSA, risk assessments, toolbox talks, worker acknowledgements, incidents, investigations and corrective actions
- Delivery: project/cost-code setup, mobile daily diaries, labour/plant/activity/quantity capture, delays, weather, visitors and photos
- Commercial: tenders, estimates, risks, clarifications, variations, progress claims, retention and payment dates
- Records: versioned documents, retention dates and immutable audit events
- Offline sync: registered devices, cursor-based change pulls and idempotent mutation receipts
- Payroll integrations: Xero/MYOB connection metadata, employee mappings, immutable approved-timesheet export batches and reconciliation state
- Digital safety evidence: approved document content hashes, worker assignments, self-signing and captured signature metadata
- Tender ingestion: PDF, DOCX, XLSX, CSV and text uploads; traceable requirement extraction and reviewable submission checklists

The schema also leaves clean seams for purchase orders, supplier invoices, subcontractor claims, quality ITPs/hold points, environmental inspections, geospatial quantities and accounting/payroll connectors.

## Run locally

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

Open `http://localhost:3000/docs`. Change the seeded password immediately.

Production releases use checked-in migrations via `npm run db:migrate:deploy`; never run `prisma migrate dev` in production. Configure `CORS_ORIGINS`, restrict `TRUST_PROXY` to deployments that are actually behind a trusted proxy, and use a managed secret for `JWT_SECRET`.

Before merging or releasing, run:

```bash
npm run lint
npm run build
npm test
npm audit --omit=dev
```

The repository includes a Node 22 multi-stage `Dockerfile`, a PostgreSQL initial migration, and a CI workflow. `/health` checks the process; `/ready` checks database availability and should be used for traffic readiness.

## Offline contract

Mobile clients should use UUIDs generated on-device, persist writes in an encrypted local database, attach a unique mutation ID to every queued change, and upload attachments separately after records sync. Register a device, then pull `/api/v1/sync/pull?deviceId=...&cursor=...` until `hasMore` is false. The cursor is opaque and must be stored verbatim. Never discard a local write until its organisation-scoped mutation receipt is stored.

Devices and receipts are organisation-scoped, revoked devices cannot silently re-register, and pull responses contain redacted change metadata rather than audit payloads. Mutation receipts are not yet created atomically with every domain write, so the current contract must not be represented as exactly-once offline mutation delivery.

Conflict policy should be domain-specific: approved timesheets and signed SWMS acknowledgements are append/correct rather than last-write-wins; draft diaries may use field-level last-write-wins; plant out-of-service status always wins over availability until an authorised clearance is recorded.

## Payroll connector boundary

`/api/v1/payroll` stages approved timesheets in a stable, provider-neutral payload and records Xero/MYOB employee/pay-item mappings and delivery state. Configuration is recorded as `CONFIGURED`, not `CONNECTED`, until a live OAuth connector exists. Export creation validates the pay period and uses serializable isolation; timesheets from failed batches can be retried. Sent/reconciled transitions require an external reference and failures require a reason. A live connector must complete provider OAuth, translate mapped pay items into the provider's current API payload, send the batch, and report its external reference. Access and refresh tokens must be held in a secrets service, not in the database `settings` JSON.

Safety documents must be approved before publishing. Publishing assigns the exact content-hashed version to workers; an acknowledgement can only be made by the user linked to that worker and captures the version hash, consent statement, signature method, IP address and user agent.

## Tender document review

Upload one tender file at a time to `POST /api/v1/commercial/tenders/:id/documents` as multipart form data. Files are limited to 25 MB, checked for basic file-signature consistency, de-duplicated by SHA-256, and subject to page/row/extracted-text limits. TirGeo extracts likely submission, compliance, safety, technical, commercial, program and resourcing requirements and creates checklist items. Every suggestion retains its source document and page or worksheet reference. Confirming or rejecting a requirement updates its linked checklist state. Extraction assists tender review and is not authoritative contract advice. Production deployment still requires managed object storage, malware scanning and durable background processing.

## Plant pre-start templates

Every seeded organisation receives a published `Generic Plant Pre-Start` with engine-off walk-around, engine-on operational, fault logging and lock-out/tag-out questions. Owners and administrators can create tailored draft templates, revise drafts and publish immutable versions through `/api/v1/plant/pre-start-templates`. Inspections are bound to the authenticated worker and a matching published template. Meter readings cannot move backwards, every triggering answer requires a defect record, and unsafe plant must be recorded as locked/tagged out. `OUT_OF_SERVICE` and `DEFECT_REPORTED` plant can return to `AVAILABLE` only through an authorised `/api/v1/plant/:id/clearance` record with a reason.

## Signed timecard workflow

An employee submits a draft timecard with their signature and selects an active owner, administrator, project manager, supervisor or foreman as approver. Submission hashes the complete timecard, creates an approval request and sends an in-app notification. The selected approver may countersign immediately on site or later from their notification. Approval is rejected if the timecard no longer matches the employee-signed hash. Both signatures and consent statements remain attached to the card before it can enter a payroll export.

Before creation, entries are validated in the organisation timezone: shift duration is bounded, breaks cannot exceed the shift, ordinary plus overtime minutes must reconcile to elapsed worked time, shifts cannot overlap, and entries must fall inside the selected week. Workers can only create their own cards. A rejected card remains immutable; `POST /api/v1/timesheets/:id/correct` creates the next draft revision with a link to the rejected evidence.

For an on-site handoff, the employee can keep their session open and pass the device to the selected approver. On first login the approver creates a four-digit signing PIN through `PUT /api/v1/auth/signature-pin`. They use that PIN to unlock signature capture through `POST /api/v1/timesheets/:id/onsite-approve`. PINs are bcrypt-hashed, redacted from logs and verification attempts are rate-limited; five failed account attempts create a 15-minute lock. This records the approver - not the employee - as the audit actor without changing the device's main login.

## Security and tenancy

JWTs include an issuer and audience, and every authenticated request rechecks the current active user and role in PostgreSQL. Project-linked writes use a central organisation ownership check. CORS origins are explicit and proxy header trust is disabled by default. Prisma conflicts, missing records and invalid references are mapped to stable HTTP errors. Evidence-critical timesheet, acknowledgement and plant-pre-start operations write sanitised audit events within their database transactions.

## Compliance boundary

TirGeo stores evidence and supports workflows; it does not itself determine award interpretation, tax, super, incident notification or legal entitlement. Payroll calculations and STP lodgement should be performed by an accredited payroll/accounting integration. State and territory WHS and security-of-payment rules must be configured per project and reviewed by qualified advisers.
