# TirGeo frontend

Responsive web UI for the TirGeo civil construction operations API. One app covers both the
office (dashboard, registers, approvals, payroll, tenders) and the field (observations, plant
pre-starts, daily diaries, timecard signing) — the layout switches to a bottom-tab mobile shell
under 960px, so site crews use the same deployment from a phone.

## Why a web app

The backend is a JWT REST API with an offline contract that is still foundational (audit-event
sync, not entity replication), and its evidence workflows (hash-locked documents, signature
capture with IP/user-agent) are served well by a browser. A responsive single deployment covers
desktop + tablet + phone today and leaves a clean path to wrap the same code in a PWA or Capacitor
shell when the offline sync API matures. No UI framework dependencies beyond React itself —
routing, data fetching and the design system are small, auditable in-repo modules.

## Stack

- React 19 + TypeScript, built with Vite
- Zero runtime dependencies besides `react` / `react-dom` (own hash router, fetch/cache layer,
  hand-rolled design system in `src/styles/global.css` with light/dark themes)
- Canvas signature capture supporting the API's `DRAWN` / `TYPED` signature methods

## Run it

```bash
# backend first (repo root)
docker compose up -d

# frontend
cd frontend
npm install
npm run dev        # http://localhost:5173, proxies /api -> localhost:3000
```

Log in with the organisationId / email / password printed by `npm run db:seed`.

`npm run build` type-checks and produces `dist/` — serve it from any static host. Same-origin is
assumed by default (put the API behind the same reverse proxy, e.g. `/api` → Fastify); for a
separate API origin, set the API address on the login screen (stored per-browser) and add the
frontend origin to the backend `CORS_ORIGINS`.

## Security notes

- The JWT lives in `sessionStorage` only (cleared when the tab session ends) and is attached
  solely as an `Authorization` header to the configured API origin. Any 401 clears the session.
- Roles from the login response drive navigation/visibility only — the server re-checks the user
  and role on every request, and the UI treats 403/404/409/422 as first-class states with
  workflow-specific messaging (e.g. "timecard changed after the employee signed it").
- Signing flows (timecards, SWMS sign-ons, pre-starts) require explicit consent checkboxes and
  send the exact consent text the backend records. The on-site countersign flow uses the
  supervisor's 4-digit PIN (set in Settings) so shared-device approvals are audited to the
  approver, never the logged-in worker.

## Module map

| Route | What it does |
|---|---|
| `#/` | HSEQ dashboard — stat tiles from `/safety/dashboard`, recent observations/inspections |
| `#/projects` | Project register, create + lifecycle transitions |
| `#/field/daily-report` | Mobile-first site diary: weather, personnel, plant, activities, quantities, delays, visitors |
| `#/hseq/*` | Hazard register & control verification, observations + incidents, inspection builder, permit board, corrective actions, safety document lifecycle, worker sign-ons |
| `#/plant` | Asset register, template-driven pre-starts with enforced defect records & lock-out, clearance workflow |
| `#/plant/templates` | Draft/publish immutable pre-start template versions (owner/admin) |
| `#/timesheets` | Draft timecard grid with entry validation, employee signature & submit, approver approve/reject, on-site PIN countersign, correction flow |
| `#/payroll` | Xero/MYOB connection metadata, employee/pay-item mappings, export build + SENT/RECONCILED/FAILED transitions |
| `#/commercial` | Tenders (multipart document upload + requirement review + checklist), progress claims, variations |
| `#/settings` | Signing PIN, saved worker ID, API address |

## Known backend gaps the UI works around

These mirror the "open alignment items" in the integration guide. Where the API has no list
endpoint (timesheets, tenders, incidents, safety documents, daily reports), the app keeps a
per-organisation "recent records" index in `localStorage` so work started on a device stays
reachable, and always allows opening a record by ID. These lists are a convenience, not the
source of truth — once the API grows list endpoints, swap the `recents` usage for queries.

- **No worker directory** — forms that need a `workerId` (timecards, pre-starts, action owners,
  document publishing) take a UUID; Settings stores "my worker ID" for pre-fill.
- **No media upload except tender documents** — photo fields are omitted until a general upload
  endpoint exists.
- **Approver queue** — approval requests arrive as in-app notifications carrying the timecard ID;
  the approver acts on that ID (there is no submitted-timesheet list endpoint yet).

## Project layout

```
src/
  lib/        api client, auth context, router, query cache, formatting, recents
  components/ design-system primitives, layout shell, signature pad, project picker
  pages/      one folder per module
  styles/     global.css — the entire design system (tokens, light/dark, responsive shell)
```
