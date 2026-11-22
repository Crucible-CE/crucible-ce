"use client";

import { useMemo } from "react";
import { PATH_LABELS, QUALITY_DISPLAY, QUALITY_LEVELS, type PathKey, type Quality } from "@/lib/exercise/modes/crisissim/schema";
import { simulateAllStrategies } from "@/lib/exercise/modes/crisissim/preview";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "./fields";
import type { EditorState } from "./state";

const STRATEGY_LABELS: Record<Quality, string> = QUALITY_DISPLAY;
const PATH_VARIANT: Record<PathKey, "success" | "warning" | "destructive"> = {
  optimal: "success",
  degrading: "warning",
  critical: "destructive",
};

function signed(n: number) {
  return n > 0 ? `+${n}` : String(n);
}

function note(level: Quality, path: PathKey, score: number): string {
  const line = `${STRATEGY_LABELS[level]} ends ${PATH_LABELS[path]} at ${signed(score)}.`;
  if (level === "great" && path !== "optimal") return `${line} Strong play should end ${PATH_LABELS.optimal}.`;
  if (level === "bad" && path !== "critical") return `${line} Poor play should end ${PATH_LABELS.critical}.`;
  return line;
}

export function ScorePreview({ state }: { state: EditorState }) {
  const result = useMemo(
    () => simulateAllStrategies(state.injects, { thresholds: state.config.pathThresholds }),
    [state.injects, state.config.pathThresholds],
  );

  return (
    <Card>
      <SectionTitle>Score preview</SectionTitle>
      <p className="text-[13px] text-[color:var(--color-muted-foreground)]">
        Each column assumes every team picks that level on every inject. Each team counts once.
      </p>
      {state.injects.length === 0 ? (
        <p className="text-[13px] text-[color:var(--color-muted-foreground)]">Add an inject to see the arc.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead className="border-b border-[color:var(--color-border)] text-[12px] text-[color:var(--color-muted-foreground)]">
                <tr>
                  <th className="py-2 pr-3 font-medium">Inject</th>
                  {QUALITY_LEVELS.map((l) => (
                    <th key={l} className="px-3 py-2 font-medium">
                      {STRATEGY_LABELS[l]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.injects.map((inj, i) => (
                  <tr key={inj.key} className="border-b border-[color:var(--color-border)] last:border-0">
                    <td className="max-w-[14rem] py-2 pr-3">
                      <span className="mr-1.5 text-[color:var(--color-muted-foreground)]">{i + 1}</span>
                      <span className="truncate">{inj.title || "Untitled"}</span>
                    </td>
                    {QUALITY_LEVELS.map((l) => {
                      const step = result[l][i];
                      return (
                        <td key={l} className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="w-8 font-mono tabular-nums">{signed(step.cumulative)}</span>
                            <Badge variant={PATH_VARIANT[step.pathAfter]}>{PATH_LABELS[step.pathAfter]}</Badge>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-1 text-[13px]">
            {QUALITY_LEVELS.map((l) => {
              const last = result[l][result[l].length - 1];
              return <li key={l}>{note(l, last.pathAfter, last.cumulative)}</li>;
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
