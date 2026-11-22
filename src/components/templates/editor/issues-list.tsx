"use client";

import type { ValidationIssue } from "@/lib/exercise/modes/crisissim/validate";

/** Issues grouped by inject. Clicking a group label or an issue jumps to it. */
export function IssuesList({
  issues,
  injectTitles,
  onJump,
}: {
  issues: ValidationIssue[];
  injectTitles: string[];
  onJump: (inject: number | null) => void;
}) {
  const groups = new Map<number | null, string[]>();
  for (const i of issues) {
    const list = groups.get(i.inject) ?? [];
    list.push(i.message);
    groups.set(i.inject, list);
  }
  const order = [...groups.keys()].sort((a, b) => (a === null ? -1 : b === null ? 1 : a - b));

  return (
    <div className="flex flex-col gap-4">
      {order.map((k) => (
        <div key={k ?? "scenario"} className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => onJump(k)}
            className="w-fit text-left text-[13px] font-semibold hover:underline"
          >
            {k === null ? "Scenario" : `Inject ${k + 1}${injectTitles[k] ? ` ${injectTitles[k]}` : ""}`}
          </button>
          <ul className="flex flex-col gap-0.5">
            {groups.get(k)!.map((m, j) => (
              <li key={j}>
                <button
                  type="button"
                  onClick={() => onJump(k)}
                  className="text-left text-[13px] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
                >
                  {m}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
