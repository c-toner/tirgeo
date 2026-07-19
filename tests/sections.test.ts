import { AccountSection, Role } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { canManageUserAccess, canViewPayrollDetails, effectiveSections, hasSection } from "../src/lib/sections.js";

describe("account section policy", () => {
  it("keeps everyday workers focused on field workflows only", () => {
    const sections = effectiveSections(Role.WORKER);
    expect(sections).toContain(AccountSection.PLANT);
    expect(sections).toContain(AccountSection.TIMESHEETS);
    expect(sections).toContain(AccountSection.MY_SAFETY);
    expect(sections).toContain(AccountSection.PERMITS);
    expect(sections).not.toContain(AccountSection.PLANT_MANAGEMENT);
    expect(sections).not.toContain(AccountSection.PAYROLL);
    expect(sections).not.toContain(AccountSection.COMMERCIAL);
    expect(sections).not.toContain(AccountSection.USER_ADMIN);
  });

  it("lets supervisors look up worker contact details without exposing payroll details", () => {
    const sections = effectiveSections(Role.SUPERVISOR);
    expect(sections).toContain(AccountSection.WORKER_DIRECTORY);
    expect(sections).not.toContain(AccountSection.PAYROLL);
    expect(canViewPayrollDetails(Role.SUPERVISOR)).toBe(false);
  });

  it("puts site supervisors above crew without giving payroll or admin access", () => {
    const sections = effectiveSections(Role.SITE_SUPERVISOR);
    expect(sections).toContain(AccountSection.DAILY_REPORT);
    expect(sections).toContain(AccountSection.WORKER_DIRECTORY);
    expect(sections).toContain(AccountSection.TIMESHEETS);
    expect(sections).not.toContain(AccountSection.PAYROLL);
    expect(sections).not.toContain(AccountSection.USER_ADMIN);
    expect(canViewPayrollDetails(Role.SITE_SUPERVISOR)).toBe(false);
  });

  it("gives site engineers QA and progress tools without commercial or payroll access", () => {
    const sections = effectiveSections(Role.SITE_ENGINEER);
    expect(sections).toContain(AccountSection.PROJECTS);
    expect(sections).toContain(AccountSection.DAILY_REPORT);
    expect(sections).toContain(AccountSection.INSPECTIONS);
    expect(sections).toContain(AccountSection.CORRECTIVE_ACTIONS);
    expect(sections).toContain(AccountSection.WORKER_DIRECTORY);
    expect(sections).not.toContain(AccountSection.COMMERCIAL);
    expect(sections).not.toContain(AccountSection.PAYROLL);
    expect(sections).not.toContain(AccountSection.USER_ADMIN);
    expect(canViewPayrollDetails(Role.SITE_ENGINEER)).toBe(false);
  });

  it("gives operations managers project and plant control without payroll details", () => {
    const sections = effectiveSections(Role.OPERATIONS_MANAGER);
    expect(sections).toContain(AccountSection.PROJECTS);
    expect(sections).toContain(AccountSection.PLANT);
    expect(sections).toContain(AccountSection.PLANT_MANAGEMENT);
    expect(sections).toContain(AccountSection.DAILY_REPORT);
    expect(sections).toContain(AccountSection.COMMERCIAL);
    expect(sections).not.toContain(AccountSection.PAYROLL);
    expect(sections).not.toContain(AccountSection.USER_ADMIN);
    expect(canViewPayrollDetails(Role.OPERATIONS_MANAGER)).toBe(false);
  });

  it("separates payroll detail visibility from user access administration", () => {
    expect(canViewPayrollDetails(Role.PAYROLL)).toBe(true);
    expect(canManageUserAccess(Role.PAYROLL)).toBe(false);
    expect(canViewPayrollDetails(Role.ADMIN)).toBe(true);
    expect(canManageUserAccess(Role.ADMIN)).toBe(true);
  });

  it("applies per-user section overrides over role defaults", () => {
    expect(hasSection(Role.WORKER, AccountSection.PAYROLL)).toBe(false);
    expect(hasSection(Role.WORKER, AccountSection.PAYROLL, [{ section: AccountSection.PAYROLL, enabled: true }])).toBe(true);
    expect(hasSection(Role.WORKER, AccountSection.PLANT_MANAGEMENT, [{ section: AccountSection.PLANT_MANAGEMENT, enabled: true }])).toBe(true);
    expect(hasSection(Role.ADMIN, AccountSection.PAYROLL, [{ section: AccountSection.PAYROLL, enabled: false }])).toBe(false);
  });
});
