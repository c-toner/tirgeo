// API types derived from the backend Prisma schema and Zod route validators.
// Keep in sync with tirgeo-backend/src/routes/* and prisma/schema.prisma.

export type Role =
  | "OWNER"
  | "ADMIN"
  | "PROJECT_MANAGER"
  | "OPERATIONS_MANAGER"
  | "SUPERVISOR"
  | "SITE_SUPERVISOR"
  | "SITE_ENGINEER"
  | "FOREMAN"
  | "SAFETY_MANAGER"
  | "PAYROLL"
  | "WORKER"
  | "SUBCONTRACTOR"
  | "CLIENT_AUDITOR";

export type Status =
  | "DRAFT"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "ACTIVE"
  | "INACTIVE"
  | "CLOSED"
  | "CANCELLED";

export type ProjectStatus =
  | "TENDER"
  | "AWARDED"
  | "MOBILISING"
  | "ACTIVE"
  | "ON_HOLD"
  | "PRACTICAL_COMPLETION"
  | "DEFECTS_LIABILITY"
  | "CLOSED";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
export type InspectionResult = "PASS" | "DEFECT" | "OUT_OF_SERVICE";
export type HseqDomain = "HEALTH" | "SAFETY" | "ENVIRONMENT" | "QUALITY";
export type HazardStatus = "IDENTIFIED" | "ASSESSED" | "CONTROLLED" | "CLOSED";
export type ControlType =
  | "ELIMINATION"
  | "SUBSTITUTION"
  | "ISOLATION"
  | "ENGINEERING"
  | "ADMINISTRATIVE"
  | "PPE";
export type HseqInspectionType =
  | "SITE_WALK"
  | "PRE_START"
  | "ENVIRONMENTAL"
  | "QUALITY_AUDIT"
  | "HSEQ_AUDIT"
  | "PLANT";
export type SafetyObservationType =
  | "HAZARD"
  | "NEAR_MISS"
  | "UNSAFE_ACT"
  | "POSITIVE_BEHAVIOUR"
  | "ENVIRONMENTAL"
  | "QUALITY";
export type PermitType =
  | "HOT_WORK"
  | "CONFINED_SPACE"
  | "EXCAVATION"
  | "WORKING_AT_HEIGHT"
  | "LIFTING"
  | "ELECTRICAL_ISOLATION"
  | "TRAFFIC_CONTROL"
  | "ENVIRONMENTAL"
  | "OTHER";
export type PermitStatus =
  | "DRAFT"
  | "REQUESTED"
  | "APPROVED"
  | "ACTIVE"
  | "SUSPENDED"
  | "CLOSED"
  | "CANCELLED";
export type AccountingProvider = "XERO" | "MYOB";
export type PayrollExportStatus = "QUEUED" | "READY" | "SENDING" | "SENT" | "RECONCILED" | "FAILED";
export type SignatureMethod = "DRAWN" | "TYPED";
export type Jurisdiction = "ACT" | "NSW" | "NT" | "QLD" | "SA" | "TAS" | "VIC" | "WA";
export type AccountSection =
  | "DASHBOARD"
  | "PROJECTS"
  | "DAILY_REPORT"
  | "HAZARDS"
  | "OBSERVATIONS"
  | "INSPECTIONS"
  | "PERMITS"
  | "CORRECTIVE_ACTIONS"
  | "SAFETY_DOCUMENTS"
  | "MY_SAFETY"
  | "PLANT"
  | "PLANT_MANAGEMENT"
  | "TIMESHEETS"
  | "PAYROLL"
  | "COMMERCIAL"
  | "WORKER_DIRECTORY"
  | "USER_ADMIN"
  | "SETTINGS";
export type SafetyDocumentType =
  | "SWMS"
  | "JSA"
  | "TOOLBOX_TALK"
  | "RISK_ASSESSMENT"
  | "ENVIRONMENTAL_PLAN"
  | "TRAFFIC_PLAN"
  | "EMERGENCY_PLAN";

export interface AuthUser {
  id: string;
  name: string;
  role: Role;
  sections: AccountSection[];
  signaturePinRequired: boolean;
  worker?: WorkerSummary | null;
}

export interface AuthOrganisation {
  id: string;
  name: string;
  slug: string;
}

export interface LoginResponse {
  token: string;
  organisation: AuthOrganisation;
  user: AuthUser;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  clientName?: string | null;
  description?: string | null;
  jurisdiction: Jurisdiction;
  address?: string | null;
  contractValue?: string | number | null;
  status: ProjectStatus;
  startDate?: string | null;
  endDate?: string | null;
  createdAt?: string;
}

export interface ApproverSummary {
  id: string;
  name: string;
  role: Role;
}

export interface TimeEntry {
  id: string;
  costCodeId?: string | null;
  workDate: string;
  startedAt: string;
  finishedAt: string;
  unpaidBreakMinutes: number;
  ordinaryMinutes: number;
  overtimeMinutes: number;
  allowanceCodes: string[];
  notes?: string | null;
}

export interface TimesheetSignature {
  id: string;
  type: "EMPLOYEE" | "APPROVER";
  signedName: string;
  signatureMethod: SignatureMethod;
  signedAt?: string;
  createdAt?: string;
}

export interface Timesheet {
  id: string;
  projectId: string;
  workerId: string;
  weekEnding: string;
  status: Status;
  revision: number;
  parentTimesheetId?: string | null;
  correctionReason?: string | null;
  contentHash?: string | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  entries: TimeEntry[];
  worker?: WorkerSummary & { firstName: string; lastName: string };
  project?: Project;
  signatures?: TimesheetSignature[];
  approvalRequest?: { approverUserId: string; status: string } | null;
}

export interface Plant {
  id: string;
  assetNumber: string;
  type: string;
  make?: string | null;
  model?: string | null;
  registration?: string | null;
  currentProjectId?: string | null;
  currentProject?: Project | null;
  status: "AVAILABLE" | "IN_USE" | "OUT_OF_SERVICE" | "DEFECT_REPORTED" | string;
  hourMeter?: string | number | null;
  odometerKm?: number | null;
  nextServiceAt?: string | null;
  nextServiceHours?: number | null;
}

export interface FileAsset {
  id: string;
  url: string;
  downloadUrl?: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt?: string;
}

export interface WorkerSummary {
  id: string;
  userId?: string | null;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  employmentType: string;
  classification?: string | null;
  terminationDate?: string | null;
  isCurrentUser?: boolean;
}

export type PreStartQuestionType = "PASS_FAIL_NA" | "BOOLEAN" | "TEXT" | "NUMBER";

export interface PreStartQuestion {
  id: string;
  label: string;
  guidance?: string;
  type: PreStartQuestionType;
  required: boolean;
  defectOn: Array<string | boolean | number>;
}

export interface PreStartSection {
  id: string;
  title: string;
  questions: PreStartQuestion[];
}

export interface PreStartTemplate {
  id: string;
  name: string;
  plantType?: string | null;
  version: number;
  status: "DRAFT" | "PUBLISHED" | string;
  sections: PreStartSection[];
  publishedAt?: string | null;
}

export interface PreStartDefect {
  questionId: string;
  item: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  detail: string;
  photoIds: string[];
}

export interface PlantPreStartSummary {
  id: string;
  plantId: string;
  workerId: string;
  projectId?: string | null;
  inspectedAt: string;
  hourMeter?: string | number | null;
  odometerKm?: number | null;
  checklistVersion: string;
  result: InspectionResult;
  defects?: PreStartDefect[] | null;
  plant: Pick<Plant, "id" | "assetNumber" | "type" | "make" | "model"> & { currentProject?: Pick<Project, "id" | "code" | "name"> | null };
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ControlMeasure {
  id: string;
  hazardId?: string | null;
  type: ControlType;
  title: string;
  description: string;
  ownerId?: string | null;
  verificationMethod?: string | null;
  implementedAt?: string | null;
  verifiedAt?: string | null;
  reviewDueAt?: string | null;
  hazard?: Hazard;
}

export interface Hazard {
  id: string;
  projectId: string;
  title: string;
  description: string;
  domain: HseqDomain;
  activity?: string | null;
  location?: string | null;
  riskLevel: RiskLevel;
  residualRiskLevel?: RiskLevel | null;
  status: HazardStatus;
  legalReference?: string | null;
  identifiedAt?: string;
  reviewDueAt?: string | null;
  closedAt?: string | null;
  controls?: ControlMeasure[];
  correctiveActions?: CorrectiveAction[];
}

export interface SafetyObservation {
  id: string;
  projectId: string;
  type: SafetyObservationType;
  title: string;
  description: string;
  location?: string | null;
  riskLevel?: RiskLevel | null;
  status?: Status;
  observedAt: string;
  immediateAction?: string | null;
  photos?: string[];
  correctiveActions?: CorrectiveAction[];
}

export interface HseqInspectionItem {
  id?: string;
  section?: string | null;
  question: string;
  result: InspectionResult;
  notes?: string | null;
  correctiveActionRequired?: boolean;
}

export interface HseqInspection {
  id: string;
  projectId: string;
  type: HseqInspectionType;
  title: string;
  location?: string | null;
  status: Status;
  score?: number | null;
  result?: InspectionResult | null;
  inspectedAt?: string | null;
  notes?: string | null;
  items: HseqInspectionItem[];
  correctiveActions?: CorrectiveAction[];
}

export interface Permit {
  id: string;
  projectId: string;
  type: PermitType;
  title: string;
  location: string;
  scope: string;
  status: PermitStatus;
  startsAt: string;
  expiresAt: string;
  closedAt?: string | null;
  hazards?: Array<{ title: string; riskLevel?: RiskLevel }>;
  controls?: Array<{ title: string }>;
  signOns?: unknown[];
  correctiveActions?: CorrectiveAction[];
}

export interface CorrectiveAction {
  id: string;
  projectId: string;
  description: string;
  ownerId: string;
  dueAt: string;
  priority: RiskLevel;
  status: Status;
  source?: string | null;
  completionNotes?: string | null;
  completedAt?: string | null;
  incidentId?: string | null;
  hazardId?: string | null;
  observationId?: string | null;
  inspectionId?: string | null;
  permitId?: string | null;
  incident?: { id: string; type?: string } | null;
  hazard?: { id: string; title?: string } | null;
  observation?: { id: string; title?: string } | null;
  inspection?: { id: string; title?: string } | null;
  permit?: { id: string; title?: string } | null;
}

export interface SafetyDocument {
  id: string;
  projectId: string;
  type: SafetyDocumentType;
  title: string;
  version: number;
  status: Status;
  riskLevel?: RiskLevel | null;
  contentHash?: string | null;
  approvedAt?: string | null;
  publishedAt?: string | null;
  reviewDueAt?: string | null;
}

export interface SafetyAssignment {
  id: string;
  safetyDocumentId: string;
  workerId: string;
  assignedAt: string;
  dueAt?: string | null;
  document: SafetyDocument;
  acknowledgement?: {
    id: string;
    signedName: string;
    signedAt?: string;
    createdAt?: string;
    documentContentHash: string;
  } | null;
}

export interface HseqDashboard {
  activeProjects: number;
  pendingTimecards: number;
  openHazards: number;
  highRiskHazards: number;
  overdueControls: number;
  openActions: number;
  overdueActions: number;
  openIncidents: number;
  activePermits: number;
  pendingDocuments: number;
  recentObservations: SafetyObservation[];
  recentInspections: HseqInspection[];
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface Tender {
  id: string;
  reference: string;
  title: string;
  clientName: string;
  jurisdiction: string;
  closesAt: string;
  scope?: string | null;
  status?: string;
  documents?: TenderDocument[];
  requirements?: TenderRequirement[];
  checklistItems?: TenderChecklistItem[];
}

export interface TenderDocument {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  pageCount?: number | null;
  processingStatus: "PROCESSING" | "REVIEW_REQUIRED" | "NO_REQUIREMENTS_FOUND" | "FAILED" | string;
  processingError?: string | null;
  uploadedAt: string;
  requirements?: TenderRequirement[];
}

export interface TenderRequirement {
  id: string;
  documentId?: string | null;
  category?: string | null;
  title: string;
  detail?: string | null;
  mandatory: boolean;
  reviewStatus: "SUGGESTED" | "CONFIRMED" | "REJECTED" | string;
  sourcePage?: number | null;
  sourceReference?: string | null;
}

export interface TenderChecklistItem {
  id: string;
  requirementId?: string | null;
  title: string;
  description?: string | null;
  mandatory: boolean;
  status: "TODO" | "IN_PROGRESS" | "COMPLETE" | "NOT_APPLICABLE" | string;
  ownerId?: string | null;
  dueAt?: string | null;
  completedAt?: string | null;
}

export interface PayrollConnection {
  id: string;
  provider: AccountingProvider;
  externalTenantId: string;
  displayName?: string | null;
  status: string;
}

export interface PayrollExport {
  id: string;
  provider?: AccountingProvider;
  periodStart: string;
  periodEnd: string;
  status: PayrollExportStatus;
  externalReference?: string | null;
  failureReason?: string | null;
  items?: Array<{ id: string; timesheetId: string }>;
  createdAt?: string;
}

export interface PlantClearance {
  id: string;
  plantId: string;
  reason: string;
  previousStatus: string;
  clearedAt?: string;
  createdAt?: string;
}

export interface Incident {
  id: string;
  projectId: string;
  occurredAt: string;
  type: string;
  severity: RiskLevel;
  description: string;
  status?: Status;
  immediateActions?: string | null;
}

export interface DailyReport {
  id: string;
  projectId: string;
  reportDate: string;
}
