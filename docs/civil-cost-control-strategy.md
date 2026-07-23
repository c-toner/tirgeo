# TirGeo Civil Cost Control Strategy

## Product Thesis

TirGeo should make field paperwork feel like part of doing the work, then turn that work into an organised, evidence-backed commercial position without re-keying it in the office.

The cost system should follow five rules:

1. Enter information once, as close to the work as possible.
2. Carry cost code, project, date, person, plant, quantity and evidence forward automatically.
3. Ask administrators to review exceptions, not every valid transaction.
4. Show financial exposure before the invoice arrives.
5. Keep every value traceable to its source and approval history.

## What Strong Platforms Get Right

### HCSS HeavyJob

HCSS ties field timecards, equipment, production and notes to cost codes, then reuses approved time for payroll and job costing. The important pattern is the closed loop: actual field production improves future estimating.

TirGeo application:

- Approved timecards become labour costs without re-entry.
- Pre-starts identify plant present on the project and create draft plant usage.
- Installed quantities and docket quantities should measure unit productivity against budget.
- Actual production rates should feed a reusable tender rate library after project closeout.

Source: https://www.hcss.com/products/time-card-software/

### Procore Financial Management

Procore separates actual cost from committed exposure. Purchase orders, subcontracts, invoices and change events update the budget before final accounts arrive.

TirGeo application:

- Show actual, committed, forecast and total exposure separately.
- Add purchase orders and subcontract commitments before supplier invoices.
- Match invoices to commitments and flag value, quantity or supplier differences.
- Apply approved variations to contract revenue and affected cost budgets.

Sources:

- https://www.procore.com/financial-management/commitments
- https://support.procore.com/products/online/financial-management-user-guides/general-contractor-financial-management-user-guide

### InEight Control

InEight combines cost, progress and forecast data at cost-item level. It supports forecast versions, what-if scenarios and earned value rather than relying only on retrospective accounting.

TirGeo application:

- Forecast final cost by cost code, not only at project level.
- Store forecast snapshots so managers can explain when and why margin moved.
- Compare installed quantity and earned revenue to actual cost.
- Surface trends early: productivity drift, rate variance and cost-code overrun.

Source: https://ineight.com/products/ineight-control/

### Assignar

Assignar connects crew and equipment scheduling, field time, forms, payroll and invoicing. Its strongest idea is reducing the number of hand-offs between field and finance.

TirGeo application:

- Use project and resource assignments to prefill forms.
- Let a supervisor submit crew time together when appropriate.
- Turn signed dayworks and schedule-of-rates dockets into invoice-ready revenue.
- Reuse worker, plant and project context across timecards, pre-starts and diaries.

Sources:

- https://assignar.com/
- https://assignar.com/timesheets/

### Payapps

Payapps standardises claims, variations, retention, evidence and approvals. The key lesson is that clear status, reminders and a complete evidence pack reduce chasing and disputes.

TirGeo application:

- Build progress claims from approved quantities, dockets and variations.
- Attach source evidence automatically.
- Track submitted, assessed, certified, paid and retained amounts.
- Keep line-level reasons and history when a claim is adjusted.

Source: https://www.payapps.com/features/contract-variations/

### ProcurePro

ProcurePro focuses on the point where spend and margin become committed: scopes, quote comparisons, approvals and subcontract award.

TirGeo application:

- Add a procurement schedule by package and required-on-site date.
- Compare supplier quotes on inclusions, exclusions and risk, not price alone.
- Require approval based on value thresholds.
- Turn an awarded quote into a commitment with no re-entry.

Source: https://procurepro.co/

## TirGeo's Defensible Advantage

TirGeo already captures the operational evidence that commercial systems often receive late:

- signed worker timecards;
- plant pre-starts and location;
- daily diaries;
- photos and documents;
- dayworks and schedule-of-rates quantities;
- chainage and project location;
- tender requirements and tasks.

The advantage is not another accounting ledger. It is an evidence graph connecting each cost and revenue line to who did the work, where, when, with which plant, under which rate, and who approved it.

## Delivery Roadmap

### Now: Daily Cost Control

- Cost-code control table with budget, actual, committed, forecast, exposure and variance.
- Exception queue for missing rates, missing cost codes, disputed costs and missing evidence.
- Date-range selection and bulk posting for daily labour and plant costs.
- Evidence links from posted costs back to timecards and pre-starts.
- Invoice upload with extracted values, remembered supplier coding and duplicate warnings.

### Next: Cost Inbox and Approvals

- One inbox for uploaded invoices, field drafts, dockets and imported accounting transactions.
- Bulk approve, allocate, split and move costs between codes.
- Role and dollar-value approval thresholds.
- Saved supplier-to-cost-code and description rules with user confirmation.
- Duplicate detection using supplier, invoice number, amount, date and file hash.
- Immutable approval events and visible source evidence.

### Commitments and Procurement

- Purchase orders, hire orders and subcontracts.
- Original value, approved changes, invoiced-to-date, remaining commitment and retention.
- Quote comparison and package approval.
- Invoice-to-order matching with exception tolerances.
- Delivery and docket matching for quantity-based purchases.

### Forecasting and Margin Protection

- Cost-to-complete entry by cost code and responsible manager.
- Forecast snapshots and variance explanations.
- Productivity forecast from installed quantities, labour hours and plant hours.
- Cash-flow curve using expected invoice and claim dates.
- Margin alerts based on thresholds, trend and unresolved exposure.

### Revenue and Claims

- Convert approved schedule-of-rates and dayworks dockets into claim lines.
- Generate client claims with supporting evidence packs.
- Track assessed, certified, paid and retained values.
- Link variations to notices, evidence, quote, approval and claim.
- Show earned revenue versus incurred cost by activity and cost code.

### Learning System

- Build tender rates from trusted project actuals.
- Compare estimated versus achieved production under similar conditions.
- Suggest rates with sample size, range and confidence rather than one opaque number.
- Use AI to prepare suggestions and summaries, while a user remains responsible for financial approval.

## Controls That Must Not Be Compromised

- Never silently post an AI-extracted amount.
- Never delete financial history; reverse or supersede it.
- Never allow the same source event to create cost twice.
- Separate preparation, approval and payment permissions.
- Snapshot rates and evidence when a cost is approved.
- Record actor, timestamp and reason for every material change.
- Keep GST, currency and tax treatment explicit.
- Allow accounting integrations without making the accounting platform the only place project managers can see exposure.

## Success Measures

- Time from field submission to visible draft cost.
- Percentage of costs allocated automatically.
- Percentage of invoices requiring manual re-keying.
- Number of duplicate invoices prevented.
- Unallocated cost value and age.
- Days between work performed, cost recognition and client claim.
- Forecast accuracy at 25%, 50% and 75% project completion.
- Admin hours per project per week.
- Gross margin movement identified before month-end.
