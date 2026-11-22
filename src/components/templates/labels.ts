// Shared labels for template pages.

export const MODE_LABELS: Record<string, string> = {
  crisissim: "Crisis Sim",
  document: "Playbook Exercise",
  strategic: "Strategic TTX",
};

/**
 * Where a template opens. Strategic TTX and branched Document TTX templates
 * open in the Studio. A linear Document TTX template opens in the Document
 * TTX editor. Crisis Sim keeps its editor.
 */
export function templateHref(t: { id: string; mode: string; branching?: string | null; status?: string | null }): string {
  if (t.mode === "strategic") return `/studio/${t.id}`;
  if (t.mode === "document") {
    return t.branching === "branched" ? `/studio/${t.id}` : `/documents/templates/${t.id}`;
  }
  if (t.mode === "crisissim") return `/templates/${t.id}`;
  return `/studio/${t.id}`;
}

/**
 * Where a published template starts an exercise. Strategic TTX goes through
 * its wizard (source, shape, clocks); other modes through the new exercise
 * page. Both preselect the template.
 */
export function launchHref(t: { id: string; mode: string }): string {
  const id = encodeURIComponent(t.id);
  if (t.mode === "strategic") return `/strategic/new?templateId=${id}`;
  return `/exercises/new?mode=${encodeURIComponent(t.mode)}&templateId=${id}`;
}

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export type StatusVariant = "accent" | "outline" | "secondary" | "warning" | "destructive" | "success";

export function statusVariant(status: string): StatusVariant {
  switch (status) {
    case "published":
      return "success";
    case "archived":
      return "secondary";
    default:
      return "outline";
  }
}

