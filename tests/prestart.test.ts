import { describe, expect, it } from "vitest";
import { genericPreStartSections, hasDefectAnswers, preStartSections, validatePreStartAnswers } from "../src/lib/prestart.js";

const completeAnswers = Object.fromEntries(genericPreStartSections.flatMap(section => section.questions.map(question => [question.id, question.type === "BOOLEAN" ? false : question.type === "TEXT" ? "" : "PASS"])));

describe("plant pre-start templates", () => {
  it("ships a valid generic checklist", () => expect(preStartSections.parse(genericPreStartSections)).toHaveLength(3));
  it("accepts complete answers and rejects missing required questions", () => {
    expect(validatePreStartAnswers(genericPreStartSections, completeAnswers).valid).toBe(true);
    const incomplete = { ...completeAnswers }; delete incomplete.controls;
    expect(validatePreStartAnswers(genericPreStartSections, incomplete)).toMatchObject({ valid: false, missing: ["controls"] });
  });
  it("detects failed checks and lock-out answers", () => {
    expect(hasDefectAnswers(genericPreStartSections, completeAnswers)).toBe(false);
    expect(hasDefectAnswers(genericPreStartSections, { ...completeAnswers, "fluids-leaks": "FAIL" })).toBe(true);
    expect(hasDefectAnswers(genericPreStartSections, { ...completeAnswers, "lockout-tagout": true })).toBe(true);
  });
  it("rejects duplicate question identifiers", () => {
    const duplicate = [{ id: "section", title: "Duplicate", questions: [{ id: "same", label: "First", type: "BOOLEAN" }, { id: "same", label: "Second", type: "BOOLEAN" }] }];
    expect(() => preStartSections.parse(duplicate)).toThrow(/unique/);
  });
});
