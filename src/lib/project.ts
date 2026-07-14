import type { ProjectStatus } from "@prisma/client";

const transitions: Record<ProjectStatus, ProjectStatus[]> = {
  TENDER: ["AWARDED", "CLOSED"], AWARDED: ["MOBILISING", "CLOSED"], MOBILISING: ["ACTIVE", "ON_HOLD", "CLOSED"],
  ACTIVE: ["ON_HOLD", "PRACTICAL_COMPLETION", "CLOSED"], ON_HOLD: ["ACTIVE", "CLOSED"],
  PRACTICAL_COMPLETION: ["DEFECTS_LIABILITY", "CLOSED"], DEFECTS_LIABILITY: ["CLOSED"], CLOSED: [],
};
export const canTransitionProject = (from: ProjectStatus, to: ProjectStatus) => transitions[from].includes(to);
