import { describe, expect, it } from "vitest";
import { canTransitionProject } from "../src/lib/project.js";

describe("project lifecycle", () => {
  it("allows the normal delivery path", () => {
    expect(canTransitionProject("TENDER", "AWARDED")).toBe(true);
    expect(canTransitionProject("ACTIVE", "PRACTICAL_COMPLETION")).toBe(true);
    expect(canTransitionProject("DEFECTS_LIABILITY", "CLOSED")).toBe(true);
  });
  it("does not reopen closed projects or skip award", () => {
    expect(canTransitionProject("CLOSED", "ACTIVE")).toBe(false);
    expect(canTransitionProject("TENDER", "ACTIVE")).toBe(false);
  });
});
