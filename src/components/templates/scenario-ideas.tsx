"use client";

// Scenario ideas for a new template: common scenarios and CISA-style seeds,
// one line each. Picking one fills the title and summary.

import { COMMON_SCENARIOS, SCENARIO_SEEDS } from "@/lib/exercise/content/fog";

export interface ScenarioIdea {
  key: string;
  title: string;
  summary: string;
}

const IDEAS: readonly ScenarioIdea[] = [
  ...COMMON_SCENARIOS.map(({ key, title, summary }) => ({ key: `common-${key}`, title, summary })),
  ...SCENARIO_SEEDS.map(({ key, title, summary }) => ({ key: `seed-${key}`, title, summary })),
];

export function ScenarioIdeas({ onPick, disabled }: { onPick: (idea: ScenarioIdea) => void; disabled?: boolean }) {
  return (
    <details className="rounded-md border border-[color:var(--color-border)] px-3 py-2">
      <summary className="cursor-pointer text-[13px] font-semibold">Scenario ideas</summary>
      <ul className="mt-2 flex max-h-72 flex-col gap-0.5 overflow-y-auto">
        {IDEAS.map((i) => (
          <li key={i.key}>
            <button
              type="button"
              disabled={disabled}
              title={i.summary}
              onClick={() => onPick(i)}
              className="w-full truncate rounded px-2 py-1 text-left text-[13px] hover:bg-[color:var(--color-muted)] disabled:opacity-50"
            >
              {i.title}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
