import { describe, expect, it } from "vitest";
import { summariseProjectCost } from "../src/lib/commercial-costs.js";

describe("commercial cost tracking", () => {
  it("rolls project revenue, actuals, commitments and forecasts into margin", () => {
    const summary = summariseProjectCost({
      contractValue: 1_000_000,
      approvedVariations: [50_000],
      contractBudget: undefined,
      contingencyAmount: 25_000,
      budgetBuckets: [250_000, 120_000, 180_000],
      claimedAmounts: [200_000, 150_000],
      certifiedAmounts: [180_000],
      manualActualCosts: [80_000, 65_000],
      committedCosts: [90_000],
      forecastCosts: [500_000],
      labourActualCosts: [70_000],
    });

    expect(summary.revisedContractValue).toBe(1_050_000);
    expect(summary.budgetedCost).toBe(575_000);
    expect(summary.actualCost).toBe(215_000);
    expect(summary.forecastFinalCost).toBe(805_000);
    expect(summary.forecastProfit).toBe(245_000);
    expect(summary.forecastMarginPercent).toBe(23.33);
    expect(summary.marginStatus).toBe("GOOD");
  });

  it("flags low margin and forecast losses", () => {
    const thinInput = {
      contractValue: 100_000,
      approvedVariations: [],
      contractBudget: 80_000,
      contingencyAmount: 0,
      budgetBuckets: [],
      claimedAmounts: [],
      certifiedAmounts: [],
      manualActualCosts: [45_000],
      committedCosts: [20_000],
      forecastCosts: [31_000],
      labourActualCosts: [],
    };
    const thin = summariseProjectCost(thinInput);
    const loss = summariseProjectCost({ ...thinInput, manualActualCosts: [70_000], committedCosts: [20_000], forecastCosts: [20_000] });

    expect(thin.forecastMarginPercent).toBe(4);
    expect(thin.marginStatus).toBe("AT_RISK");
    expect(loss.forecastProfit).toBe(-10_000);
    expect(loss.marginStatus).toBe("LOSS");
  });
});
