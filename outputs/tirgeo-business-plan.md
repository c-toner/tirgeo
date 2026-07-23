# TirGeo Business Plan

## Executive Summary

**Thesis:** Built for the van. Ready for the office.

TirGeo is a civil construction operations platform designed for contractors whose field teams need less paperwork and whose office teams need clearer control across multiple projects. The product brings together timecards, supervisor signatures, payroll export, HSEQ, plant pre-starts, chainage, photos, tenders, commercial cost tracking, notifications, user permissions and audit-safe historical records.

The opportunity is to position TirGeo between lightweight field apps and large enterprise construction suites. Many smaller and mid-market civil contractors do not need the complexity or implementation burden of enterprise platforms, but they do need more than simple forms, spreadsheets and chat messages.

## Market Context

Comparable construction and field operations products show three broad pricing patterns:

- **Per-user field tools:** Fieldwire publishes annual pricing at US$39, US$64 and US$89 per user/month, with higher monthly pricing also documented in its help centre. Its free tier is limited to 5 users, 3 projects and 100 sheets.
- **Inspection/safety platforms:** SafetyCulture is commonly listed with a free tier, Premium around US$24/user/month, and custom Enterprise pricing. SafetyCulture also uses different seat types to avoid charging every participant as a full user.
- **Daily report / field log tools:** Raken-style field reporting products are often positioned around roughly US$15-19/user/month for daily reports and safety logs.
- **Enterprise construction platforms:** Procore states pricing is custom, based on products needed and Annual Construction Volume, with unlimited users/data/support. This favours larger contractors but can feel heavy for smaller civil businesses.
- **Safety-at-scale platforms:** HammerTech states it does not use per-seat pricing; pricing is based on construction volume, company size, operational complexity and onboarding/support needs.
- **Civil/infrastructure operations platforms:** Assignar uses tailored annual subscriptions plus onboarding, based on package and active users, and positions around civil, utilities, rail, progress claims, job costing and payroll interpretation.

**Implication for TirGeo:** a blended model is likely strongest: simple enough for small civil companies to buy, but scalable into project/company plans where field access is not punished too heavily by per-seat pricing.

## Target Customer

### Ideal Customer Profile

Small to mid-sized civil contractors in Australia and New Zealand:

- 10-250 employees or regular subcontractor workers
- 2-30 active projects
- Work types: roads, drainage, subdivisions, utilities, remediation, concrete, plant-heavy works, maintenance contracts
- Pain points: paper timecards, spreadsheet registers, photo evidence scattered across phones, payroll double-entry, weak job costing visibility, safety records spread across systems

### Buyer Personas

- **Owner / Director:** wants margin visibility, fewer disputes, cleaner records and less dependency on one admin person.
- **Operations Manager:** wants every site following the same process without slowing crews down.
- **Project Manager / Engineer:** wants project costs, variations, daily records and HSEQ actions in one place.
- **Payroll / Admin:** wants approved timecards, clean exports and less chasing supervisors.
- **Supervisor / Foreman:** wants a phone-friendly workflow that does not feel like office paperwork.

## Product Positioning

**Positioning statement:** TirGeo is the everyday civil operations tool for site crews and office teams, helping contractors capture field records quickly and turn them into organised project, safety, payroll and cost data.

### Differentiators

- Civil-specific workflows: chainage, plant pre-starts, timecards, project cost tracking and tender workflows.
- Field-first simplicity: create actions are visible, pages show need-to-know information first, and detail is available by drilling into line items.
- Office-ready structure: project, worker, payroll, cost and HSEQ records are connected rather than scattered.
- Audit-first design: users and records are deactivated, archived or superseded rather than deleted where history matters.
- Practical integrations path: payroll export first, then email, accounting, document and storage integrations.

## Current Product Scope

### Implemented / In Progress

- Project dashboard and role-based navigation
- Notifications with unread indicators and mark-all-read
- Projects and daily diary workflows
- Timecards with worker creation, supervisor selection, on-site signing and approval queues
- Payroll export with date range and individual approved timecard selection
- HSEQ: hazards, observations, inspections, permits, corrective actions and safety sign-ons
- Plant and pre-starts with photo storage architecture using Vercel Blob
- Chainage map module for civil work items
- Commercial: tenders, progress claims, variations and cost tracking
- Cost tracking: cost plans, actuals, commitments, forecasts and margin status
- Tender document upload, duplicate warning and document extraction workflow
- User management, signing PIN reset and user deactivation
- Audit preservation: soft archive/supersede behaviour for records that matter historically

## Pricing Strategy

TirGeo should avoid copying pure per-seat pricing because civil projects involve many intermittent users: subcontractors, labourers, supervisors, payroll users and office staff. Charging too aggressively per field user can discourage adoption.

### Recommended Packaging

| Plan | Target | Included | Indicative Price |
|---|---:|---|---:|
| Starter | Small civil team moving off paper | 3 projects, 5 office users, 25 field users, timecards, daily diary, basic HSEQ, pre-starts | A$299/month |
| Civil Ops | Growing contractor with multiple active jobs | 15 projects, 12 office users, 100 field users, payroll export, plant, chainage, HSEQ, notifications | A$899/month |
| Commercial Control | Contractor needing cost and margin control | 30 projects, 25 office users, 250 field users, cost tracking, tenders, claims, variations, advanced permissions | A$1,799/month |
| Enterprise | Larger civil/infrastructure contractor | Custom limits, SSO/API, advanced reporting, onboarding, priority support, custom workflows | A$3,000-8,000/month |

### Add-ons

- Extra office users: A$39/user/month
- Extra active field users above plan: A$8-12/user/month
- Extra Blob/photo storage above fair-use: pass-through plus margin
- Email/SMS notification packs: usage based
- Implementation: A$1,500 Starter, A$5,000 Civil Ops, A$10,000-25,000 Enterprise
- Data migration / custom forms: quoted project work

## Revenue Model

Assumptions:

- Revenue shown in AUD.
- Average Revenue Per Account grows as features mature.
- Setup revenue is treated as services revenue, not recurring SaaS.
- Churn assumed lower for contractors once payroll/timecard/cost workflows are embedded, but early churn risk is higher during product-market fit.

### 3-Year Scenario

| Metric | Year 1 Conservative | Year 2 Base | Year 3 Growth |
|---|---:|---:|---:|
| Customers at year end | 12 | 38 | 85 |
| Average MRR per customer | A$750 | A$1,150 | A$1,550 |
| Ending MRR | A$9,000 | A$43,700 | A$131,750 |
| Ending ARR | A$108,000 | A$524,400 | A$1,581,000 |
| Setup/services revenue | A$36,000 | A$95,000 | A$180,000 |
| Gross margin target | 65-75% | 75-82% | 80-86% |

### Sensitivity

| Scenario | Customers | Avg MRR | ARR |
|---|---:|---:|---:|
| Low adoption | 20 | A$700 | A$168,000 |
| Solid niche adoption | 50 | A$1,250 | A$750,000 |
| Strong civil vertical adoption | 120 | A$1,700 | A$2,448,000 |

The most important revenue lever is not raw user count; it is becoming operationally embedded in payroll, HSEQ, plant and cost reporting. Once TirGeo becomes the system of record for daily site administration, retention and expansion should be materially stronger.

## Cost Plan

### First 12 Months

| Cost Area | Lean Founder-Led | Small Team |
|---|---:|---:|
| Product development | A$60k-140k | A$220k-420k |
| Hosting, database, Blob storage, email | A$6k-18k | A$12k-36k |
| Design, QA and device testing | A$5k-20k | A$20k-60k |
| Legal, accounting, insurance | A$10k-25k | A$20k-45k |
| Sales and marketing | A$15k-60k | A$80k-200k |
| Customer onboarding/support | A$10k-50k | A$80k-180k |
| Total | A$106k-313k | A$432k-941k |

### Ongoing Cost Drivers

- Support burden during onboarding
- Custom configuration requests from civil companies
- Storage and bandwidth for photos, PDFs and drawings
- Payroll/accounting integration maintenance
- Security, backups and audit retention
- Mobile/offline sync testing across devices and poor network conditions

## Go-To-Market

### Beachhead

Start with owner-led and operations-led civil contractors that feel the pain personally:

- 15-80 staff
- 3-10 active jobs
- Currently using spreadsheets, paper forms, Dropbox/Google Drive, WhatsApp and manual payroll entry
- Strong need for timecards, pre-starts, HSEQ, photos and cost visibility

### Sales Motion

1. Run a 30-minute discovery around timecards, pre-starts, safety records and cost leakage.
2. Offer a pilot on one live project for 30-45 days.
3. Measure adoption: timecards submitted, pre-starts completed, hazards captured, payroll export time saved.
4. Convert to Civil Ops or Commercial Control annual plan.
5. Expand across projects after payroll/admin workflows prove value.

### Messaging

Primary message:

**Built for the van. Ready for the office.**

Supporting messages:

- Site teams capture what matters without feeling buried in paperwork.
- Admin teams get clean, organised records across every project.
- Owners get better visibility into cost, risk and margin before it is too late.

## Roadmap

### Near Term

- Offline-first capture and sync for timecards, pre-starts, photos, observations and daily diaries
- Email notifications through verified organisation mailboxes
- Better mobile ergonomics for workers and supervisors
- Stronger payroll/accounting export templates
- Cost commitment workflow: purchase orders, dockets, accruals and subcontractor claims

### Medium Term

- Document register: drawings, RFIs, submittals, revisions, tender addenda and compliance packs
- Advanced chainage: project layers, work fronts, as-builts, defect locations and map markups
- Civil production tracking: quantities installed, crew productivity, plant hours and earned value
- Role-based client/subcontractor portals
- Reporting packs for weekly project meetings

### Longer Term

- AI-assisted tender requirement extraction and compliance review
- Predictive project margin alerts
- Automated daily report summaries
- Integrations with Xero/MYOB, email, storage, project accounting and scheduling tools
- Enterprise controls: SSO, API, custom retention policies and advanced audit exports

## Risks and Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Field users reject the app | Low adoption | Keep workflows short, mobile-first and offline-capable |
| Product becomes too broad | Slower delivery | Prioritise timecards, pre-starts, HSEQ and cost tracking before nice-to-have modules |
| Competitors are better funded | Sales pressure | Win on civil specificity, implementation support and simpler pricing |
| Custom requests overwhelm roadmap | Margin erosion | Package configuration, charge for custom work, keep core product standard |
| Data/security concerns | Deal blocker | Strong audit trail, backups, access controls, private Blob storage and clear retention policy |

## Recommended Next Steps

1. Finalise the core positioning and pricing page around “Built for the van. Ready for the office.”
2. Pick 3 pilot customers and run a structured 45-day implementation.
3. Prioritise offline capture, email notifications and cost commitments.
4. Build an onboarding checklist and demo dataset for civil contractors.
5. Track three proof metrics per pilot: admin hours saved, timecard/payroll cycle time, and cost visibility improvements.

## Source Notes

- Fieldwire pricing page: https://www.fieldwire.com/pricing/
- Fieldwire pricing and overages help article: https://help.fieldwire.com/hc/en-us/articles/202634054-Fieldwire-Pricing-and-Overages
- SafetyCulture pricing overview via G2: https://www.g2.com/products/safetyculturehq/pricing
- SafetyCulture seat types: https://help.safetyculture.com/001741
- Builder Software Guide daily report software pricing comparison: https://buildersoftwareguide.com/best-software/best-construction-daily-report-software/
- Procore pricing model: https://www.procore.com/pricing
- HammerTech pricing model: https://www.hammertech.com/en-us/pricing
- Assignar pricing FAQ: https://assignar.com/frequently-asked-questions/
- Assignar civil/infrastructure positioning: https://assignar.com/industry/infrastructure-operations-software/
