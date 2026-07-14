import { z } from "zod";

export const preStartQuestion = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/).min(2).max(80), label: z.string().min(2).max(200), guidance: z.string().max(1000).optional(),
  type: z.enum(["PASS_FAIL_NA", "BOOLEAN", "TEXT", "NUMBER"]), required: z.boolean().default(true),
  defectOn: z.array(z.union([z.string(), z.boolean(), z.number()])).default([]),
});
export const preStartSection = z.object({ id: z.string().regex(/^[a-z0-9_-]+$/).min(2).max(80), title: z.string().min(2).max(150), questions: z.array(preStartQuestion).min(1) });
export const preStartSections = z.array(preStartSection).min(1).superRefine((sections, ctx) => {
  const ids = sections.flatMap(s => s.questions.map(q => q.id));
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Question IDs must be unique across the template" });
});

export const genericPreStartSections = [
  { id: "walk-around", title: "Pre-Start Walk-Around (Engine Off)", questions: [
    { id: "fluids-leaks", label: "Fluids and leaks", guidance: "Check engine oil, hydraulic oil, coolant and transmission fluid for correct levels and signs of leaks.", type: "PASS_FAIL_NA", required: true, defectOn: ["FAIL"] },
    { id: "tyres-tracks", label: "Tyres or tracks", guidance: "Inspect pressure, wear, cuts, track condition and damaged rims.", type: "PASS_FAIL_NA", required: true, defectOn: ["FAIL"] },
    { id: "guards-panels", label: "Guards and panels", guidance: "Ensure covers and guards are secure and free of debris.", type: "PASS_FAIL_NA", required: true, defectOn: ["FAIL"] },
    { id: "attachments", label: "Attachments", guidance: "Inspect ground engaging tools and confirm quick-hitch safety pins are locked.", type: "PASS_FAIL_NA", required: true, defectOn: ["FAIL"] },
    { id: "access-egress", label: "Access and egress", guidance: "Check and clean steps, handrails and windows.", type: "PASS_FAIL_NA", required: true, defectOn: ["FAIL"] },
    { id: "safety-equipment", label: "Safety equipment", guidance: "Verify the fire extinguisher is in date and securely mounted.", type: "PASS_FAIL_NA", required: true, defectOn: ["FAIL"] },
  ]},
  { id: "operational", title: "Cabin and Operational Checks (Engine On)", questions: [
    { id: "safety-restraints", label: "Safety restraints", guidance: "Inspect seatbelt condition and operation.", type: "PASS_FAIL_NA", required: true, defectOn: ["FAIL"] },
    { id: "instruments", label: "Instruments", guidance: "Check dash gauges, warning lights and hour meter.", type: "PASS_FAIL_NA", required: true, defectOn: ["FAIL"] },
    { id: "alarms-lighting", label: "Alarms and lighting", guidance: "Test reverse beeper, rotating beacon, headlights and indicators.", type: "PASS_FAIL_NA", required: true, defectOn: ["FAIL"] },
    { id: "communications", label: "Communications", guidance: "Confirm UHF radio or two-way communication transmits and receives clearly.", type: "PASS_FAIL_NA", required: true, defectOn: ["FAIL"] },
    { id: "controls", label: "Controls", guidance: "Test steering, brakes, park brake and hydraulic or boom functions.", type: "PASS_FAIL_NA", required: true, defectOn: ["FAIL"] },
  ]},
  { id: "fault-signoff", title: "Fault Logging and Sign-Off", questions: [
    { id: "defects-notes", label: "Defect reporting notes", guidance: "Document any issues found during the inspection.", type: "TEXT", required: false, defectOn: [] },
    { id: "lockout-tagout", label: "Machine locked out or tagged out", guidance: "Select yes when unsafe plant has been isolated to prevent use.", type: "BOOLEAN", required: true, defectOn: [true] },
  ]},
] as const;

export function validatePreStartAnswers(sections: unknown, answers: Record<string, unknown>) {
  const parsed = preStartSections.parse(sections); const questions = parsed.flatMap(s => s.questions); const known = new Set(questions.map(q => q.id));
  const unknown = Object.keys(answers).filter(id => !known.has(id));
  const missing = questions.filter(q => q.required && (answers[q.id] === undefined || answers[q.id] === null || answers[q.id] === "")).map(q => q.id);
  const invalid = questions.filter(q => { const value = answers[q.id]; if (value === undefined || value === null || value === "") return false; if (q.type === "PASS_FAIL_NA") return !["PASS", "FAIL", "NA"].includes(String(value)); if (q.type === "BOOLEAN") return typeof value !== "boolean"; if (q.type === "NUMBER") return typeof value !== "number" || !Number.isFinite(value); return typeof value !== "string"; }).map(q => q.id);
  return { valid: !unknown.length && !missing.length && !invalid.length, unknown, missing, invalid };
}

export function hasDefectAnswers(sections: unknown, answers: Record<string, unknown>) {
  return defectQuestionIds(sections, answers).length > 0;
}

export function defectQuestionIds(sections: unknown, answers: Record<string, unknown>) {
  return preStartSections.parse(sections).flatMap(s => s.questions).filter(q => q.defectOn.some(value => value === answers[q.id])).map(q => q.id);
}
