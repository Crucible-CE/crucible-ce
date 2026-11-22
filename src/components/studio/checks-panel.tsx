"use client";

// Validation results grouped by node. Errors block saving; errors and
// warnings block publishing.

import { cn } from "@/lib/utils";
import type { StudioIssue } from "@/lib/exercise/studio/graph";
import type { DraftGraph } from "@/lib/exercise/studio/editor";

const ORDER = { error: 0, warning: 1, info: 2 } as const;
const LABEL = { error: "Error", warning: "Warning", info: "Note" } as const;

export function ChecksPanel({
  graph,
  issues,
  onSelectNode,
  onSelectBranch,
  onTemplate,
}: {
  graph: DraftGraph;
  issues: StudioIssue[];
  onSelectNode: (id: string) => void;
  onSelectBranch: (index: number) => void;
  onTemplate: () => void;
}) {
  if (issues.length === 0) return <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No problems found.</p>;
  const groups = new Map<string, StudioIssue[]>();
  for (const i of issues) {
    const k = i.nodeId ?? "";
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  const seqOf = (id: string) => graph.injects.find((i) => i.nodeId === id)?.seq ?? 999;
  const keys = [...groups.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : seqOf(a) - seqOf(b)));
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-[color:var(--color-muted-foreground)]">
        {counts.error} {counts.error === 1 ? "error" : "errors"}, {counts.warning} {counts.warning === 1 ? "warning" : "warnings"}. Errors block saving. Warnings block publishing.
      </p>
      {keys.map((k) => {
        const node = k ? graph.injects.find((i) => i.nodeId === k) : null;
        const list = [...groups.get(k)!].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
        return (
          <div key={k || "template"} className="flex flex-col gap-1">
            <button type="button" className="w-fit text-left text-[13px] font-semibold hover:underline" onClick={() => (k ? onSelectNode(k) : onTemplate())}>
              {node ? `${node.seq}. ${node.title || "Untitled inject"}` : k ? "Missing inject" : "Template"}
            </button>
            <ul className="flex flex-col gap-1">
              {list.map((i, n) => (
                <li key={n} className="flex items-start gap-2 text-[13px]">
                  <span
                    className={cn(
                      "mt-0.5 shrink-0 rounded-full px-1.5 text-[10px] font-medium",
                      i.severity === "error" && "bg-[color:color-mix(in_srgb,var(--mist-danger),transparent_88%)] text-[color:var(--mist-danger)]",
                      i.severity === "warning" && "bg-[color:color-mix(in_srgb,var(--mist-warn),transparent_88%)] text-[color:var(--mist-warn)]",
                      i.severity === "info" && "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]",
                    )}
                  >
                    {LABEL[i.severity]}
                  </span>
                  <button
                    type="button"
                    className="text-left text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
                    onClick={() => (i.branch !== undefined ? onSelectBranch(i.branch) : k ? onSelectNode(k) : onTemplate())}
                  >
                    {i.message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
