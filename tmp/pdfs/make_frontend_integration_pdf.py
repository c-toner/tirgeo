from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    LongTable,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.pdfbase.pdfmetrics import stringWidth
from xml.sax.saxutils import escape


OUTPUT = "output/pdf/tirgeo-frontend-integration-guide.pdf"


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="TitleLarge", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=24, leading=29, textColor=colors.HexColor("#1F2937"), alignment=TA_LEFT, spaceAfter=8))
styles.add(ParagraphStyle(name="Subtitle", parent=styles["BodyText"], fontSize=11, leading=16, textColor=colors.HexColor("#4B5563"), spaceAfter=14))
styles.add(ParagraphStyle(name="H1x", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=17, leading=22, textColor=colors.HexColor("#111827"), spaceBefore=14, spaceAfter=8))
styles.add(ParagraphStyle(name="H2x", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12.5, leading=16, textColor=colors.HexColor("#1F2937"), spaceBefore=10, spaceAfter=5))
styles.add(ParagraphStyle(name="Bodyx", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.3, leading=13.2, textColor=colors.HexColor("#1F2937"), spaceAfter=5))
styles.add(ParagraphStyle(name="Small", parent=styles["BodyText"], fontName="Helvetica", fontSize=8, leading=10.5, textColor=colors.HexColor("#4B5563"), spaceAfter=3))
styles.add(ParagraphStyle(name="Cell", parent=styles["BodyText"], fontName="Helvetica", fontSize=7.3, leading=9.2, textColor=colors.HexColor("#111827")))
styles.add(ParagraphStyle(name="CellSmall", parent=styles["BodyText"], fontName="Helvetica", fontSize=6.8, leading=8.4, textColor=colors.HexColor("#374151")))
styles.add(ParagraphStyle(name="HeaderCell", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=7.2, leading=9, textColor=colors.white))
styles.add(ParagraphStyle(name="CodeBlock", parent=styles["Code"], fontName="Courier", fontSize=7.2, leading=9, textColor=colors.HexColor("#111827"), backColor=colors.HexColor("#F3F4F6"), borderPadding=5, leftIndent=0))
styles.add(ParagraphStyle(name="TOC", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.5, leading=13, textColor=colors.HexColor("#1F2937")))


def p(text, style="Bodyx"):
    return Paragraph(escape(text), styles[style])


def rich(text, style="Bodyx"):
    return Paragraph(text, styles[style])


def code(text):
    return Preformatted(text.strip(), styles["CodeBlock"], maxLineLength=92)


def bullet(text):
    return rich(f"&bull; {escape(text)}", "Bodyx")


def cell(text, small=False):
    return Paragraph(escape(str(text)), styles["CellSmall" if small else "Cell"])


def hcell(text):
    return Paragraph(escape(str(text)), styles["HeaderCell"])


def section(title):
    return p(title, "H1x")


def subsection(title):
    return p(title, "H2x")


def endpoint_table(rows):
    data = [[hcell("Area"), hcell("Method"), hcell("Path"), hcell("Purpose"), hcell("Auth")]]
    for row in rows:
        data.append([cell(row[0], True), cell(row[1], True), cell(row[2], True), cell(row[3], True), cell(row[4], True)])
    table = LongTable(data, colWidths=[23 * mm, 18 * mm, 48 * mm, 67 * mm, 31 * mm], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D1D5DB")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F9FAFB")]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    return table


def key_value_table(rows):
    table = Table([[cell(k), cell(v, True)] for k, v in rows], colWidths=[43 * mm, 144 * mm])
    table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D1D5DB")),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F3F4F6")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def enum_table(rows):
    data = [[hcell("Enum"), hcell("Values")]]
    data += [[cell(k), cell(", ".join(v), True)] for k, v in rows]
    table = LongTable(data, colWidths=[42 * mm, 145 * mm], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D1D5DB")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F9FAFB")]),
    ]))
    return table


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#6B7280"))
    canvas.drawString(18 * mm, 286 * mm, "TirGeo Frontend Integration Guide")
    page_text = f"Page {doc.page}"
    canvas.drawRightString(192 * mm, 286 * mm, page_text)
    canvas.setStrokeColor(colors.HexColor("#E5E7EB"))
    canvas.line(18 * mm, 282 * mm, 192 * mm, 282 * mm)
    canvas.restoreState()


doc = BaseDocTemplate(
    OUTPUT,
    pagesize=A4,
    rightMargin=18 * mm,
    leftMargin=18 * mm,
    topMargin=20 * mm,
    bottomMargin=16 * mm,
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height - 8 * mm, id="normal")
doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=header_footer)])

story = []

story.append(p("TirGeo Frontend Integration Guide", "TitleLarge"))
story.append(p("Backend API contract for building the web and field UI. Generated from the current Fastify, Prisma and Docker configuration in this repository.", "Subtitle"))
story.append(key_value_table([
    ("API base path", "/api/v1"),
    ("Local Docker URL", "http://localhost:3000"),
    ("Auth", "JWT bearer token from POST /api/v1/auth/login. Send Authorization: Bearer <token>."),
    ("Primary date format", "Use ISO 8601 strings. The backend coerces date fields with Zod."),
    ("Tenant boundary", "Every authenticated request is scoped by organisationId embedded in the JWT."),
    ("Interactive API docs", "Swagger UI is mounted at /docs when the backend is running."),
]))
story.append(Spacer(1, 7))
story.append(section("Table Of Contents"))
for item in [
    "1. Product scope and recommended UI modules",
    "2. Authentication, roles, errors and shared patterns",
    "3. Endpoint catalogue",
    "4. HSEQ implementation guide",
    "5. Screen-by-screen frontend build notes",
    "6. Payload examples",
    "7. Docker and local integration setup",
    "8. Open items for frontend and backend alignment",
]:
    story.append(p(item, "TOC"))

story.append(PageBreak())
story.append(section("1. Product Scope"))
story.append(p("TirGeo is an Australian civil construction operations API. It already covers core subcontractor workflows similar to modern construction operations platforms: projects, crews and workers, plant, pre-starts, daily reports, SWMS/JSA style safety documents, HSEQ records, timesheets, payroll export, tender review, progress claims and variations."))
story.append(subsection("Recommended navigation model"))
for item in [
    "Dashboard: operational summary, open safety actions, pending documents, active permits, recent observations, overdue controls and payroll/timesheet exceptions.",
    "Projects: project list, lifecycle status, cost codes, linked daily reports, HSEQ records, claims and variations.",
    "Field app: today schedule context from project selection, daily report capture, observations, incident reporting, permit sign-on, plant pre-starts and timesheets.",
    "HSEQ: hazard register, controls, SWMS/JSA documents, inspections, observations, incidents, permits and corrective actions.",
    "Plant: asset register, published pre-start templates, pre-start submission, defects and clearance workflow.",
    "Timesheets and payroll: worker entry, signature, supervisor approval, correction, export configuration and export status.",
    "Commercial: tenders, tender document upload/review, progress claims and variations.",
    "Admin: users/workers, roles, pre-start templates, payroll mappings, CORS/environment settings and audit history when exposed.",
]:
    story.append(bullet(item))

story.append(subsection("Data ownership model"))
story.append(p("The UI should treat organisationId as a login-time value only. After login, do not send organisationId in normal API requests unless the endpoint explicitly asks for it. The server enforces tenancy from the JWT. Most project-bound records require a projectId and are verified against the authenticated organisation."))

story.append(section("2. Auth, Roles And Shared Patterns"))
story.append(enum_table([
    ("Role", ["OWNER", "ADMIN", "PROJECT_MANAGER", "SUPERVISOR", "FOREMAN", "SAFETY_MANAGER", "PAYROLL", "WORKER", "SUBCONTRACTOR", "CLIENT_AUDITOR"]),
    ("Status", ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "ACTIVE", "INACTIVE", "CLOSED", "CANCELLED"]),
    ("ProjectStatus", ["TENDER", "AWARDED", "MOBILISING", "ACTIVE", "ON_HOLD", "PRACTICAL_COMPLETION", "DEFECTS_LIABILITY", "CLOSED"]),
    ("RiskLevel", ["LOW", "MEDIUM", "HIGH", "EXTREME"]),
    ("InspectionResult", ["PASS", "DEFECT", "OUT_OF_SERVICE"]),
]))
story.append(Spacer(1, 7))
story.append(key_value_table([
    ("401", "Missing/invalid token or failed credential/PIN validation."),
    ("403", "Authenticated user lacks the required role or is trying to access another worker's record."),
    ("404", "Record not found, including records outside the organisation boundary."),
    ("409", "Business rule conflict: invalid status transition, changed signed content, duplicated active export, backwards meter reading, etc."),
    ("422", "Domain dependency missing, for example payroll mappings required before export."),
    ("400", "Zod validation failure. The response includes code VALIDATION_ERROR and details."),
]))
story.append(p("The frontend should render validation details near the relevant fields, and use conflict responses for workflow-level banners such as 'refresh this timesheet before signing' or 'plant cannot be passed while a defect is present'."))

story.append(PageBreak())
story.append(section("3. Endpoint Catalogue"))
endpoints = [
    ("Health", "GET", "/health", "Basic service liveness.", "Public"),
    ("Health", "GET", "/ready", "Database readiness check.", "Public"),
    ("Auth", "POST", "/api/v1/auth/login", "Login with organisationId, email and password. Returns token and user summary.", "Public"),
    ("Auth", "PUT", "/api/v1/auth/signature-pin", "Create or change a four digit signing PIN.", "JWT"),
    ("Projects", "GET", "/api/v1/projects", "List projects for the organisation.", "JWT"),
    ("Projects", "POST", "/api/v1/projects", "Create project.", "OWNER, ADMIN, PROJECT_MANAGER"),
    ("Projects", "PATCH", "/api/v1/projects/:id/status", "Move project through the allowed lifecycle.", "OWNER, ADMIN, PROJECT_MANAGER"),
    ("Field", "POST", "/api/v1/field/daily-reports", "Create site diary/daily report with personnel, plant, activities, quantities, delays, visitors and photos.", "JWT"),
    ("Plant", "GET", "/api/v1/plant", "List plant assets.", "JWT"),
    ("Plant", "POST", "/api/v1/plant", "Create plant asset.", "OWNER, ADMIN, PROJECT_MANAGER"),
    ("Plant", "GET", "/api/v1/plant/pre-start-templates", "List published templates for field use, optionally filtered by plantType.", "JWT"),
    ("Plant", "GET", "/api/v1/plant/pre-start-templates/manage", "List all templates for management.", "OWNER, ADMIN"),
    ("Plant", "POST", "/api/v1/plant/pre-start-templates", "Create a draft pre-start template version.", "OWNER, ADMIN"),
    ("Plant", "PATCH", "/api/v1/plant/pre-start-templates/:id", "Edit a draft template.", "OWNER, ADMIN"),
    ("Plant", "POST", "/api/v1/plant/pre-start-templates/:id/publish", "Publish a draft template.", "OWNER, ADMIN"),
    ("Plant", "POST", "/api/v1/plant/:id/pre-starts", "Submit plant pre-start answers, defects and signature.", "JWT"),
    ("Plant", "POST", "/api/v1/plant/:id/clearance", "Clear defect/out-of-service plant.", "OWNER, ADMIN, PROJECT_MANAGER, SAFETY_MANAGER"),
    ("Safety", "POST", "/api/v1/safety/documents", "Create SWMS, JSA, toolbox, risk, environmental, traffic or emergency plan.", "Safety managers and project leaders"),
    ("Safety", "POST", "/api/v1/safety/documents/:id/approve", "Approve draft safety document and lock content hash.", "OWNER, ADMIN, SAFETY_MANAGER"),
    ("Safety", "POST", "/api/v1/safety/documents/:id/publish", "Assign approved document to workers.", "Safety managers and project leaders"),
    ("Safety", "POST", "/api/v1/safety/documents/:id/acknowledge", "Worker signs assigned/published document.", "JWT worker assignment"),
    ("Safety", "GET", "/api/v1/safety/my-assignments", "Current worker's safety document assignments and acknowledgements.", "JWT"),
    ("Safety", "POST", "/api/v1/safety/incidents", "Create incident report.", "JWT"),
    ("HSEQ", "GET", "/api/v1/safety/hazards", "List hazard register with controls/actions. Filters: projectId, status, domain, riskLevel.", "JWT"),
    ("HSEQ", "POST", "/api/v1/safety/hazards", "Create hazard with optional controls.", "OWNER, ADMIN, PM, SUPERVISOR, FOREMAN, SAFETY_MANAGER"),
    ("HSEQ", "PATCH", "/api/v1/safety/hazards/:id/status", "Update hazard status, residual risk and review date.", "OWNER, ADMIN, PM, SUPERVISOR, FOREMAN, SAFETY_MANAGER"),
    ("HSEQ", "POST", "/api/v1/safety/hazards/:id/controls", "Create control measure under hazard.", "OWNER, ADMIN, PM, SUPERVISOR, FOREMAN, SAFETY_MANAGER"),
    ("HSEQ", "GET", "/api/v1/safety/controls", "List controls. Filters: projectId, type, dueOnly.", "JWT"),
    ("HSEQ", "PATCH", "/api/v1/safety/controls/:id/verify", "Mark a control as verified.", "OWNER, ADMIN, PM, SUPERVISOR, SAFETY_MANAGER"),
    ("HSEQ", "GET", "/api/v1/safety/observations", "List safety/HSEQ observations. Filters: projectId, type, status.", "JWT"),
    ("HSEQ", "POST", "/api/v1/safety/observations", "Create hazard, near miss, unsafe act, positive, environmental or quality observation.", "JWT"),
    ("HSEQ", "GET", "/api/v1/safety/inspections", "List HSEQ inspections with items/actions. Filters: projectId, type, status.", "JWT"),
    ("HSEQ", "POST", "/api/v1/safety/inspections", "Create inspection with checklist item results.", "OWNER, ADMIN, PM, SUPERVISOR, FOREMAN, SAFETY_MANAGER"),
    ("HSEQ", "PATCH", "/api/v1/safety/inspections/:id/complete", "Close inspection with score/result.", "OWNER, ADMIN, PM, SUPERVISOR, SAFETY_MANAGER"),
    ("HSEQ", "GET", "/api/v1/safety/permits", "List permits to work. Filters: projectId, type, status.", "JWT"),
    ("HSEQ", "POST", "/api/v1/safety/permits", "Create permit to work.", "OWNER, ADMIN, PM, SUPERVISOR, FOREMAN, SAFETY_MANAGER"),
    ("HSEQ", "PATCH", "/api/v1/safety/permits/:id/status", "Move permit status and set approver/closedAt when relevant.", "OWNER, ADMIN, PM, SUPERVISOR, SAFETY_MANAGER"),
    ("HSEQ", "GET", "/api/v1/safety/actions", "List corrective actions. Filters: projectId, ownerId, status, overdue.", "JWT"),
    ("HSEQ", "POST", "/api/v1/safety/actions", "Create corrective action linked to incident, hazard, observation, inspection or permit.", "OWNER, ADMIN, PM, SUPERVISOR, FOREMAN, SAFETY_MANAGER"),
    ("HSEQ", "PATCH", "/api/v1/safety/actions/:id", "Update owner, due date, priority, status and closure notes.", "OWNER, ADMIN, PM, SUPERVISOR, FOREMAN, SAFETY_MANAGER"),
    ("HSEQ", "GET", "/api/v1/safety/dashboard", "Counts and recent records for HSEQ dashboard. Optional projectId.", "JWT"),
    ("Timesheets", "GET", "/api/v1/timesheets/approvers", "List eligible approvers.", "JWT"),
    ("Timesheets", "POST", "/api/v1/timesheets", "Create draft timesheet with entries.", "JWT"),
    ("Timesheets", "POST", "/api/v1/timesheets/:id/submit", "Employee signs and submits to approver.", "JWT worker owner"),
    ("Timesheets", "POST", "/api/v1/timesheets/:id/approve", "Approver signs submitted timesheet.", "OWNER, ADMIN, PM, SUPERVISOR, FOREMAN"),
    ("Timesheets", "POST", "/api/v1/timesheets/:id/onsite-approve", "Shared-device supervisor PIN approval.", "JWT"),
    ("Timesheets", "POST", "/api/v1/timesheets/:id/reject", "Reject submitted timesheet with reason.", "OWNER, ADMIN, PM, SUPERVISOR, FOREMAN"),
    ("Timesheets", "POST", "/api/v1/timesheets/:id/correct", "Create correction from rejected timesheet.", "JWT worker owner"),
    ("Payroll", "PUT", "/api/v1/payroll/connections/:provider", "Configure XERO or MYOB connection metadata.", "OWNER, ADMIN, PAYROLL"),
    ("Payroll", "PUT", "/api/v1/payroll/connections/:provider/employees/:workerId", "Map local worker to external payroll employee.", "OWNER, ADMIN, PAYROLL"),
    ("Payroll", "PUT", "/api/v1/payroll/connections/:provider/pay-items/:localCode", "Map local pay/allowance code to external pay item.", "OWNER, ADMIN, PAYROLL"),
    ("Payroll", "POST", "/api/v1/payroll/exports", "Build payroll export from approved timesheets.", "OWNER, ADMIN, PAYROLL"),
    ("Payroll", "PATCH", "/api/v1/payroll/exports/:id/status", "Mark export SENT, RECONCILED or FAILED.", "OWNER, ADMIN, PAYROLL"),
    ("Commercial", "POST", "/api/v1/commercial/tenders", "Create tender.", "OWNER, ADMIN, PROJECT_MANAGER"),
    ("Commercial", "GET", "/api/v1/commercial/tenders/:id", "Tender detail with documents, requirements and checklist.", "OWNER, ADMIN, PROJECT_MANAGER"),
    ("Commercial", "POST", "/api/v1/commercial/tenders/:id/documents", "Upload and analyse tender document multipart file.", "OWNER, ADMIN, PROJECT_MANAGER"),
    ("Commercial", "PATCH", "/api/v1/commercial/tenders/:tenderId/requirements/:id", "Confirm or reject suggested requirement.", "OWNER, ADMIN, PROJECT_MANAGER"),
    ("Commercial", "PATCH", "/api/v1/commercial/tenders/:tenderId/checklist/:id", "Update tender checklist owner/status/due date.", "OWNER, ADMIN, PROJECT_MANAGER"),
    ("Commercial", "POST", "/api/v1/commercial/progress-claims", "Create progress claim.", "OWNER, ADMIN, PROJECT_MANAGER"),
    ("Commercial", "POST", "/api/v1/commercial/variations", "Create variation.", "OWNER, ADMIN, PROJECT_MANAGER"),
    ("Sync", "POST", "/api/v1/sync/register", "Register offline-capable device.", "JWT"),
    ("Sync", "GET", "/api/v1/sync/pull", "Pull audit event cursor stream.", "JWT"),
    ("Sync", "POST", "/api/v1/sync/receipt", "Store client mutation receipt.", "JWT"),
    ("Notifications", "GET", "/api/v1/notifications", "List latest 100 notifications.", "JWT"),
    ("Notifications", "POST", "/api/v1/notifications/:id/read", "Mark notification read.", "JWT"),
]
story.append(endpoint_table(endpoints))

story.append(PageBreak())
story.append(section("4. HSEQ Implementation Guide"))
story.append(enum_table([
    ("HseqDomain", ["HEALTH", "SAFETY", "ENVIRONMENT", "QUALITY"]),
    ("HazardStatus", ["IDENTIFIED", "ASSESSED", "CONTROLLED", "CLOSED"]),
    ("ControlType", ["ELIMINATION", "SUBSTITUTION", "ISOLATION", "ENGINEERING", "ADMINISTRATIVE", "PPE"]),
    ("HseqInspectionType", ["SITE_WALK", "PRE_START", "ENVIRONMENTAL", "QUALITY_AUDIT", "HSEQ_AUDIT", "PLANT"]),
    ("SafetyObservationType", ["HAZARD", "NEAR_MISS", "UNSAFE_ACT", "POSITIVE_BEHAVIOUR", "ENVIRONMENTAL", "QUALITY"]),
    ("PermitType", ["HOT_WORK", "CONFINED_SPACE", "EXCAVATION", "WORKING_AT_HEIGHT", "LIFTING", "ELECTRICAL_ISOLATION", "TRAFFIC_CONTROL", "ENVIRONMENTAL", "OTHER"]),
    ("PermitStatus", ["DRAFT", "REQUESTED", "APPROVED", "ACTIVE", "SUSPENDED", "CLOSED", "CANCELLED"]),
]))
story.append(subsection("HSEQ dashboard cards"))
for item in [
    "Open hazards: /api/v1/safety/dashboard.openHazards",
    "High risk hazards: highRiskHazards, count of HIGH and EXTREME non-closed hazards.",
    "Overdue controls: overdueControls, unverified controls with reviewDueAt before now.",
    "Open and overdue actions: openActions and overdueActions.",
    "Open incidents: openIncidents.",
    "Active permits: activePermits, permits APPROVED or ACTIVE and not expired.",
    "Pending documents: pendingDocuments for DRAFT or SUBMITTED safety docs.",
    "Recent activity: recentObservations and recentInspections arrays.",
]:
    story.append(bullet(item))
story.append(subsection("Core HSEQ workflows"))
for item in [
    "Observation to action: user reports observation, supervisor reviews, creates corrective action linked by observationId, closes action with completion notes/evidence.",
    "Hazard to controls: safety manager creates hazard register item, adds controls using the hierarchy of controls, verifies controls, updates hazard residual risk, then closes when controlled.",
    "Inspection to action: supervisor creates inspection with item results. Failed/defect items should prompt action creation linked by inspectionId.",
    "Permit lifecycle: create permit in DRAFT, progress through REQUESTED, APPROVED, ACTIVE, SUSPENDED or CLOSED. Use status endpoint for approvals and closure.",
    "Document lifecycle: draft SWMS/JSA, approve to generate content hash, publish to workers, workers acknowledge with signature. Display hash/approved date in UI for defensible records.",
]:
    story.append(bullet(item))

story.append(section("5. Screen Build Notes"))
screens = [
    ("Login", "Requires organisationId, email and password. Store token securely. Keep user.role for client-side navigation only; server remains authoritative."),
    ("Project list", "Fetch GET /projects. Use status chips and jurisdiction. Create/edit status only for OWNER, ADMIN and PROJECT_MANAGER."),
    ("Field daily report", "Project picker, report date, weather, personnel rows, plant rows, activities, quantities, delays, visitors, safety notes and photo IDs."),
    ("Hazard register", "Table with risk, residual risk, domain, status, review due, controls count and actions count. Provide quick filters for project, status, domain and risk."),
    ("Control verification", "Show controls due or overdue. Capture effectiveness, evidenceDocumentId and next reviewDueAt."),
    ("Observation capture", "Mobile-first form with type, project, location, risk, description, immediate action and photos."),
    ("Inspection builder", "Use sections and questions client-side. Submit items with PASS, DEFECT or OUT_OF_SERVICE. Show action-required toggles."),
    ("Permit board", "Filter by type/status. Warn when expiresAt is close. For active permits, surface location, scope, hazards, controls and signOns."),
    ("Corrective actions", "Kanban or table grouped by status/overdue. Actions can link back to incident, hazard, observation, inspection or permit."),
    ("Safety documents", "Author document, approve, publish assignments, worker acknowledgement. UI must prevent signing before approval/publish."),
    ("Plant pre-start", "Fetch template by plantType, render questions, validate required fields client-side, require defect details for failed checks."),
    ("Timesheets", "Draft entry grid, submit with signature, approver queue, approve/reject, correction flow. Preserve signatures as base64/string payloads."),
    ("Payroll", "Configure provider, map workers/pay items, create export from approved timesheets, update export status."),
    ("Commercial", "Tender upload uses multipart field file. Show extracted requirements and generated checklist for review."),
]
screen_rows = [[hcell("Screen"), hcell("Build notes")]] + [[cell(a), cell(b, True)] for a, b in screens]
screen_table = LongTable(screen_rows, colWidths=[40 * mm, 147 * mm], repeatRows=1)
screen_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D1D5DB")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F9FAFB")]),
]))
story.append(screen_table)

story.append(PageBreak())
story.append(section("6. Payload Examples"))
story.append(subsection("Login"))
story.append(code("""
POST /api/v1/auth/login
{
  "organisationId": "00000000-0000-0000-0000-000000000000",
  "email": "admin@tirgeo.local",
  "password": "ChangeMe123!"
}
"""))
story.append(subsection("Create hazard with controls"))
story.append(code("""
POST /api/v1/safety/hazards
Authorization: Bearer <token>
{
  "projectId": "<projectId>",
  "title": "Live services in excavation zone",
  "description": "Potential contact with electrical or comms services during trenching.",
  "domain": "SAFETY",
  "activity": "Excavation",
  "location": "Chainage 120-180",
  "riskLevel": "HIGH",
  "residualRiskLevel": "MEDIUM",
  "reviewDueAt": "2026-08-14T00:00:00.000Z",
  "controls": [
    {
      "type": "ENGINEERING",
      "title": "Pothole services",
      "description": "Verify all service locations before mechanical excavation.",
      "verificationMethod": "Supervisor inspection"
    },
    {
      "type": "ADMINISTRATIVE",
      "title": "Permit and spotter",
      "description": "Permit to excavate and dedicated spotter required."
    }
  ]
}
"""))
story.append(subsection("Create HSEQ observation"))
story.append(code("""
POST /api/v1/safety/observations
{
  "projectId": "<projectId>",
  "type": "NEAR_MISS",
  "title": "Reversing exclusion zone breach",
  "description": "Worker crossed behind reversing loader before spotter stopped movement.",
  "location": "Northern stockpile",
  "riskLevel": "HIGH",
  "immediateAction": "Stopped work, reset exclusion zone and briefed crew.",
  "photos": ["photo-storage-id-1"]
}
"""))
story.append(subsection("Create inspection"))
story.append(code("""
POST /api/v1/safety/inspections
{
  "projectId": "<projectId>",
  "type": "SITE_WALK",
  "title": "Morning site walk",
  "location": "Stage 2",
  "status": "SUBMITTED",
  "items": [
    {
      "section": "Access",
      "question": "Walkways clear and signed",
      "result": "PASS"
    },
    {
      "section": "Excavation",
      "question": "Edge protection in place",
      "result": "DEFECT",
      "notes": "Missing barrier at east side",
      "correctiveActionRequired": true
    }
  ]
}
"""))
story.append(subsection("Create permit"))
story.append(code("""
POST /api/v1/safety/permits
{
  "projectId": "<projectId>",
  "type": "EXCAVATION",
  "title": "Excavate stormwater trench",
  "location": "Lot 12 frontage",
  "scope": "Open trench from pit A to pit B.",
  "startsAt": "2026-07-15T22:00:00.000Z",
  "expiresAt": "2026-07-16T06:00:00.000Z",
  "hazards": [{"title": "Live services", "riskLevel": "HIGH"}],
  "controls": [{"title": "Dial before you dig reviewed"}, {"title": "Spotter in place"}],
  "signOns": []
}
"""))
story.append(subsection("Create corrective action"))
story.append(code("""
POST /api/v1/safety/actions
{
  "projectId": "<projectId>",
  "description": "Install barrier on east side excavation edge.",
  "ownerId": "<workerId>",
  "dueAt": "2026-07-16T00:00:00.000Z",
  "priority": "HIGH",
  "inspectionId": "<inspectionId>",
  "source": "Site walk defect"
}
"""))

story.append(PageBreak())
story.append(section("7. Docker And Local Setup"))
story.append(p("The repository now includes a Dockerfile that builds the TypeScript app, generates Prisma client code, and starts by applying migrations with `prisma migrate deploy` before running the Fastify server. docker-compose.yml now starts both Postgres and the API."))
story.append(code("""
# Build and run API plus Postgres
docker compose up --build

# API
http://localhost:3000

# Swagger UI
http://localhost:3000/docs

# Health checks
GET http://localhost:3000/health
GET http://localhost:3000/ready
"""))
story.append(subsection("Environment variables"))
story.append(key_value_table([
    ("DATABASE_URL", "Postgres connection string. Compose uses postgresql://tirgeo:tirgeo@postgres:5432/tirgeo."),
    ("JWT_SECRET", "Required. Must be at least 32 characters. Replace the compose placeholder before shared environments."),
    ("PORT", "Defaults to 3000."),
    ("HOST", "Defaults to 0.0.0.0."),
    ("STORAGE_PATH", "Upload storage path. Compose maps /app/data/uploads to a named Docker volume."),
    ("CORS_ORIGINS", "Comma-separated allowed frontend origins. Update for deployed frontend URLs."),
    ("TRUST_PROXY", "Set true when behind a trusted reverse proxy/load balancer."),
]))
story.append(subsection("Seed data"))
story.append(p("The seed script creates a demo organisation and owner login, plus a generic plant pre-start template. After containers are running, run this if a fresh local database needs demo access:"))
story.append(code("""
docker compose exec api npm run db:seed
"""))
story.append(p("The seed output prints organisationId, email and password. Use those values in POST /api/v1/auth/login."))

story.append(section("8. Open Alignment Items"))
for item in [
    "Worker and user management endpoints are not currently exposed. The frontend will need these before a complete admin UI can create workers, assign roles, and map worker user accounts.",
    "Photo/document upload is implemented for tender documents only. Daily reports, HSEQ photos, evidenceDocumentId and attachments currently expect identifiers rather than a general media upload endpoint.",
    "The HSEQ action creation endpoint accepts source IDs but does not yet validate that the linked source belongs to the same project. The UI should only present valid in-project choices.",
    "Safety document list/detail endpoints are limited. The UI can create/approve/publish/acknowledge and fetch my assignments, but management list/detail screens may need additional GET endpoints.",
    "Swagger is available for live exploration, but richer OpenAPI schemas may require adding explicit Fastify schema metadata if the frontend team wants generated clients.",
    "Offline sync currently streams audit event metadata, not full entity snapshots. Treat it as a foundation for sync rather than a complete offline replication API.",
]:
    story.append(bullet(item))

doc.build(story)

print(OUTPUT)
