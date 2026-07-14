import { Select } from "./ui.tsx";
import { useApiQuery } from "../lib/useApi.ts";
import type { Project } from "../lib/types.ts";

/** Project dropdown used by every project-scoped form and filter. */
export function ProjectSelect({
  value,
  onChange,
  allowEmpty,
  emptyLabel,
  invalid,
  activeOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  invalid?: boolean;
  activeOnly?: boolean;
}) {
  const { data } = useApiQuery<Project[]>("/api/v1/projects");
  const projects = (data ?? []).filter(
    (project) => !activeOnly || !["CLOSED", "TENDER"].includes(project.status),
  );
  return (
    <Select
      value={value}
      onChange={onChange}
      allowEmpty={allowEmpty}
      emptyLabel={emptyLabel ?? "All projects"}
      invalid={invalid}
      options={projects.map((project) => ({ value: project.id, label: `${project.code} — ${project.name}` }))}
    />
  );
}

export function useProjectName(projectId?: string | null): string {
  const { data } = useApiQuery<Project[]>("/api/v1/projects");
  if (!projectId) return "—";
  const project = data?.find((p) => p.id === projectId);
  return project ? project.code : projectId.slice(0, 8) + "…";
}
