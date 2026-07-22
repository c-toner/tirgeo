export interface CostSummaryInput {
  contractValue?: unknown;
  contractBudget?: unknown;
  contingencyAmount?: unknown;
  budgetBuckets: unknown[];
  approvedVariations: unknown[];
  claimedAmounts: unknown[];
  certifiedAmounts: unknown[];
  manualActualCosts: unknown[];
  committedCosts: unknown[];
  forecastCosts: unknown[];
  labourActualCosts: unknown[];
}

export interface CostSummary {
  contractValue: number;
  approvedVariations: number;
  revisedContractValue: number;
  budgetedCost: number;
  approvedLabourCost: number;
  actualCost: number;
  committedCost: number;
  forecastToComplete: number;
  forecastFinalCost: number;
  forecastProfit: number;
  forecastMarginPercent: number | null;
  claimedAmount: number;
  certifiedAmount: number;
  costToDatePercent: number | null;
  marginStatus: "GOOD" | "WATCH" | "AT_RISK" | "LOSS";
}

export function money(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") return value.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sum(values: unknown[]): number {
  return values.reduce<number>((total, value) => total + money(value), 0);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function summariseProjectCost(input: CostSummaryInput): CostSummary {
  const contractValue = money(input.contractValue);
  const approvedVariations = sum(input.approvedVariations);
  const revisedContractValue = contractValue + approvedVariations;
  const rawBudget = sum(input.budgetBuckets);
  const plannedBudget = money(input.contractBudget);
  const budgetedCost = (plannedBudget > 0 ? plannedBudget : rawBudget) + money(input.contingencyAmount);
  const approvedLabourCost = sum(input.labourActualCosts);
  const manualActualCosts = sum(input.manualActualCosts);
  const actualCost = approvedLabourCost + manualActualCosts;
  const committedCost = sum(input.committedCosts);
  const forecastToComplete = sum(input.forecastCosts);
  const forecastFinalCost = actualCost + committedCost + forecastToComplete;
  const forecastProfit = revisedContractValue - forecastFinalCost;
  const forecastMarginPercent = revisedContractValue > 0 ? roundPercent((forecastProfit / revisedContractValue) * 100) : null;
  const costToDatePercent = budgetedCost > 0 ? roundPercent((actualCost / budgetedCost) * 100) : null;

  let marginStatus: CostSummary["marginStatus"] = "GOOD";
  if (forecastProfit < 0) marginStatus = "LOSS";
  else if (forecastMarginPercent !== null && forecastMarginPercent < 5) marginStatus = "AT_RISK";
  else if (forecastMarginPercent !== null && forecastMarginPercent < 12) marginStatus = "WATCH";

  return {
    contractValue: roundMoney(contractValue),
    approvedVariations: roundMoney(approvedVariations),
    revisedContractValue: roundMoney(revisedContractValue),
    budgetedCost: roundMoney(budgetedCost),
    approvedLabourCost: roundMoney(approvedLabourCost),
    actualCost: roundMoney(actualCost),
    committedCost: roundMoney(committedCost),
    forecastToComplete: roundMoney(forecastToComplete),
    forecastFinalCost: roundMoney(forecastFinalCost),
    forecastProfit: roundMoney(forecastProfit),
    forecastMarginPercent,
    claimedAmount: roundMoney(sum(input.claimedAmounts)),
    certifiedAmount: roundMoney(sum(input.certifiedAmounts)),
    costToDatePercent,
    marginStatus,
  };
}
