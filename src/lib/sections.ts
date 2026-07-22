import { AccountSection, Role, type UserSectionAccess } from "@prisma/client";

export const ALL_ACCOUNT_SECTIONS = Object.values(AccountSection);

export const ROLE_SECTION_DEFAULTS: Record<Role, AccountSection[]> = {
  [Role.OWNER]: ALL_ACCOUNT_SECTIONS,
  [Role.ADMIN]: ALL_ACCOUNT_SECTIONS,
  [Role.PROJECT_MANAGER]: [
    AccountSection.DASHBOARD,
    AccountSection.PROJECTS,
    AccountSection.DAILY_REPORT,
    AccountSection.HAZARDS,
    AccountSection.OBSERVATIONS,
    AccountSection.INSPECTIONS,
    AccountSection.PERMITS,
    AccountSection.CORRECTIVE_ACTIONS,
    AccountSection.SAFETY_DOCUMENTS,
    AccountSection.MY_SAFETY,
    AccountSection.PLANT,
    AccountSection.PLANT_MANAGEMENT,
    AccountSection.COMPLETED_PRE_STARTS,
    AccountSection.CHAINAGE,
    AccountSection.TIMESHEETS,
    AccountSection.COMMERCIAL,
    AccountSection.COST_TRACKING,
    AccountSection.WORKER_DIRECTORY,
    AccountSection.SETTINGS,
  ],
  [Role.OPERATIONS_MANAGER]: [
    AccountSection.DASHBOARD,
    AccountSection.PROJECTS,
    AccountSection.DAILY_REPORT,
    AccountSection.HAZARDS,
    AccountSection.OBSERVATIONS,
    AccountSection.INSPECTIONS,
    AccountSection.PERMITS,
    AccountSection.CORRECTIVE_ACTIONS,
    AccountSection.SAFETY_DOCUMENTS,
    AccountSection.MY_SAFETY,
    AccountSection.PLANT,
    AccountSection.PLANT_MANAGEMENT,
    AccountSection.COMPLETED_PRE_STARTS,
    AccountSection.CHAINAGE,
    AccountSection.TIMESHEETS,
    AccountSection.COMMERCIAL,
    AccountSection.COST_TRACKING,
    AccountSection.WORKER_DIRECTORY,
    AccountSection.SETTINGS,
  ],
  [Role.SUPERVISOR]: [
    AccountSection.DASHBOARD,
    AccountSection.PROJECTS,
    AccountSection.DAILY_REPORT,
    AccountSection.HAZARDS,
    AccountSection.OBSERVATIONS,
    AccountSection.INSPECTIONS,
    AccountSection.PERMITS,
    AccountSection.CORRECTIVE_ACTIONS,
    AccountSection.SAFETY_DOCUMENTS,
    AccountSection.MY_SAFETY,
    AccountSection.PLANT,
    AccountSection.COMPLETED_PRE_STARTS,
    AccountSection.CHAINAGE,
    AccountSection.TIMESHEETS,
    AccountSection.WORKER_DIRECTORY,
    AccountSection.SETTINGS,
  ],
  [Role.SITE_SUPERVISOR]: [
    AccountSection.DASHBOARD,
    AccountSection.PROJECTS,
    AccountSection.DAILY_REPORT,
    AccountSection.HAZARDS,
    AccountSection.OBSERVATIONS,
    AccountSection.INSPECTIONS,
    AccountSection.PERMITS,
    AccountSection.CORRECTIVE_ACTIONS,
    AccountSection.SAFETY_DOCUMENTS,
    AccountSection.MY_SAFETY,
    AccountSection.PLANT,
    AccountSection.COMPLETED_PRE_STARTS,
    AccountSection.CHAINAGE,
    AccountSection.TIMESHEETS,
    AccountSection.WORKER_DIRECTORY,
    AccountSection.SETTINGS,
  ],
  [Role.SITE_ENGINEER]: [
    AccountSection.DASHBOARD,
    AccountSection.PROJECTS,
    AccountSection.DAILY_REPORT,
    AccountSection.HAZARDS,
    AccountSection.OBSERVATIONS,
    AccountSection.INSPECTIONS,
    AccountSection.PERMITS,
    AccountSection.CORRECTIVE_ACTIONS,
    AccountSection.SAFETY_DOCUMENTS,
    AccountSection.MY_SAFETY,
    AccountSection.PLANT,
    AccountSection.COMPLETED_PRE_STARTS,
    AccountSection.CHAINAGE,
    AccountSection.TIMESHEETS,
    AccountSection.WORKER_DIRECTORY,
    AccountSection.SETTINGS,
  ],
  [Role.FOREMAN]: [
    AccountSection.DASHBOARD,
    AccountSection.DAILY_REPORT,
    AccountSection.HAZARDS,
    AccountSection.OBSERVATIONS,
    AccountSection.INSPECTIONS,
    AccountSection.PERMITS,
    AccountSection.CORRECTIVE_ACTIONS,
    AccountSection.SAFETY_DOCUMENTS,
    AccountSection.MY_SAFETY,
    AccountSection.PLANT,
    AccountSection.COMPLETED_PRE_STARTS,
    AccountSection.CHAINAGE,
    AccountSection.TIMESHEETS,
    AccountSection.WORKER_DIRECTORY,
    AccountSection.SETTINGS,
  ],
  [Role.SAFETY_MANAGER]: [
    AccountSection.DASHBOARD,
    AccountSection.PROJECTS,
    AccountSection.HAZARDS,
    AccountSection.OBSERVATIONS,
    AccountSection.INSPECTIONS,
    AccountSection.PERMITS,
    AccountSection.CORRECTIVE_ACTIONS,
    AccountSection.SAFETY_DOCUMENTS,
    AccountSection.MY_SAFETY,
    AccountSection.PLANT,
    AccountSection.COMPLETED_PRE_STARTS,
    AccountSection.CHAINAGE,
    AccountSection.WORKER_DIRECTORY,
    AccountSection.SETTINGS,
  ],
  [Role.PAYROLL]: [
    AccountSection.DASHBOARD,
    AccountSection.TIMESHEETS,
    AccountSection.PAYROLL,
    AccountSection.WORKER_DIRECTORY,
    AccountSection.SETTINGS,
  ],
  [Role.WORKER]: [
    AccountSection.DASHBOARD,
    AccountSection.HAZARDS,
    AccountSection.OBSERVATIONS,
    AccountSection.PERMITS,
    AccountSection.SAFETY_DOCUMENTS,
    AccountSection.MY_SAFETY,
    AccountSection.PLANT,
    AccountSection.TIMESHEETS,
    AccountSection.SETTINGS,
  ],
  [Role.SUBCONTRACTOR]: [
    AccountSection.DASHBOARD,
    AccountSection.HAZARDS,
    AccountSection.OBSERVATIONS,
    AccountSection.PERMITS,
    AccountSection.SAFETY_DOCUMENTS,
    AccountSection.MY_SAFETY,
    AccountSection.PLANT,
    AccountSection.TIMESHEETS,
    AccountSection.SETTINGS,
  ],
  [Role.CLIENT_AUDITOR]: [
    AccountSection.DASHBOARD,
    AccountSection.SAFETY_DOCUMENTS,
    AccountSection.SETTINGS,
  ],
};

export function effectiveSections(
  role: Role,
  overrides: Pick<UserSectionAccess, "section" | "enabled">[] = [],
): AccountSection[] {
  const sections = new Set(ROLE_SECTION_DEFAULTS[role]);
  for (const override of overrides) {
    if (override.enabled) sections.add(override.section);
    else sections.delete(override.section);
  }
  return ALL_ACCOUNT_SECTIONS.filter(section => sections.has(section));
}

export function hasSection(
  role: Role,
  section: AccountSection,
  overrides: Pick<UserSectionAccess, "section" | "enabled">[] = [],
) {
  return effectiveSections(role, overrides).includes(section);
}

export function canViewPayrollDetails(role: Role) {
  return role === Role.OWNER || role === Role.ADMIN || role === Role.PAYROLL;
}

export function canManageUserAccess(role: Role) {
  return role === Role.OWNER || role === Role.ADMIN;
}
