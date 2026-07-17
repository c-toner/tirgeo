# Next-Generation Civil Platform Roadmap

This roadmap turns the market research into TirGeo backend capabilities. The product direction is to privilege fast field capture, civil-specific automations, and live operational feedback over a single monolithic project database.

The current product is a web app, but the API should be designed as a mobile-ready contract from the start. Future Android and iOS clients need the same domain model, with offline sync, device-generated UUIDs, small field payloads, resumable uploads, idempotent mutations and conflict rules for diaries, timecards, dockets, photos, signatures and telemetry.

## 1. Civil Field Operations

Foundation now in backend:

- Projects can store alignment and geofence metadata.
- Daily reports can store chainage/GPS location references.
- Daily reports can include OCR-ready material docket payloads.
- Daily reports can create typed production actuals by activity, quantity, unit, cost code, location, material, ground condition, labour hours and plant hours.
- Plant can receive telemetry readings with engine hours, idle hours, fuel burn, odometer, coordinates and raw provider payloads.

Next work:

- Add OCR extraction jobs for quarry, asphalt and concrete dockets.
- Add Caterpillar, Komatsu and mixed telematics connector adapters.
- Reconcile plant telemetry against pre-starts, plant time in daily reports and plant hire cost rules.
- Keep field endpoints compatible with offline mobile queues by accepting client mutation IDs and upload-first file references.

## 2. Two-Click Field Interface

Foundation now in backend:

- Daily reports can store voice transcript text alongside structured report data.
- Project geofences and civil locations can drive context-aware forms.

Next work:

- Add mobile voice-to-diary parsing into personnel, plant, activities, delays and production actuals.
- Add HSEQ rule matching by project zone, chainage range, plant type and worker competency.
- Add a field command endpoint that returns the smallest relevant action set for the current worker context.
- Maintain separate web back-office and mobile field workflows over the same backend state.

## 3. Live-Linked Tendering

Foundation now in backend:

- Production actuals create a reliable feedback table that can feed estimating rates after project completion.

Next work:

- Add tender rate library tables with observed production rates, confidence bands and project conditions.
- Add closeout jobs that convert approved production actuals into estimating suggestions.
- Pull active payroll/plant cost assumptions into tender estimates.

## 4. Smart Payroll And Award Automation

Foundation already present:

- Signed timecards, cost-coded entries, allowances and payroll export staging.

Next work:

- Add geofenced clock events against project geofences.
- Add award/EBA rule configuration with effective dates, jurisdiction, classification and project overrides.
- Generate explainable pay interpretations before export, while keeping final compliance review explicit.

## 5. Modular Fabric Reporting

Foundation now in backend:

- Production actuals, material dockets and plant telemetry are tied to projects, cost codes and daily reports.

Next work:

- Add forecast rollups that update from approved field quantities.
- Add client progress claim views backed by the same production actuals.
- Add safety/productivity dashboards using shared project, location and plant context.
