"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { ModeViewProps } from "@/lib/exercise/modes/ui";
import { ENTRY_TYPES, ENTRY_TYPE_LABELS, GRADE_RATING_LABELS } from "../schema";
import { Notice, SectionLabel, sectionHeading } from "./shared";
import { asDocState } from "./types";

export function DebriefView(props: ModeViewProps) {
  const state = asDocState(props.state);
  if (!state) return <Notice text="Loading the exercise." />;
  const { modules } = state.debrief;
  if (modules.length === 0) return null;
  const control = state.viewer.isControl;

  return (
    <div className="space-y-4">
      <h2 className="font-display text-lg font-semibold">Module summary</h2>
      {modules.map((m) => {
        const mod = state.injects.find((i) => i.id === m.injectId);
        return (
          <Card key={m.injectId} dense className="gap-4">
            <h3 className="text-base font-semibold">
              Module {m.seq}. {m.title}
            </h3>
            <div className="flex flex-wrap gap-2">
              {ENTRY_TYPES.map((t) => (
                <Badge key={t} variant={m.byType[t] ? "secondary" : "outline"}>
                  {ENTRY_TYPE_LABELS[t]} {m.byType[t] ?? 0}
                </Badge>
              ))}
            </div>
            <div className="space-y-1">
              <SectionLabel>Questions</SectionLabel>
              <ul className="space-y-2 text-sm">
                {(mod?.questions ?? []).map((q, i) => {
                  const g = m.questions?.find((x) => x.key === q.key);
                  const answered = m.answered.includes(q.key);
                  return (
                    <li key={q.key} className="space-y-1">
                      <div className="flex flex-wrap items-start gap-2">
                        <span className="font-mono text-xs text-[color:var(--color-muted-foreground)]">{i + 1}.</span>
                        <span className="flex-1">{q.text}</span>
                        <Badge variant={answered ? "success" : "outline"}>{answered ? "Answered" : "Not answered"}</Badge>
                      </div>
                      {control && g && g.graded > 0 && (
                        <p className="pl-5 text-xs text-[color:var(--color-muted-foreground)]">
                          {g.graded} graded, average {g.avgScore ?? 0} of 4.{" "}
                          {(Object.keys(g.ratings) as Array<keyof typeof g.ratings>)
                            .filter((r) => g.ratings[r] > 0)
                            .map((r) => `${GRADE_RATING_LABELS[r]} ${g.ratings[r]}`)
                            .join(", ")}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
            {m.gaps.length > 0 && (
              <div className="space-y-1">
                <SectionLabel>Gaps</SectionLabel>
                <ul className="space-y-1.5 text-sm">
                  {m.gaps.map((g) => (
                    <li key={g.id}>
                      {g.text}
                      <span className="block text-xs text-[color:var(--color-muted-foreground)]">
                        {[g.severity ? `${g.severity} severity` : null, sectionHeading(state, g.docSectionRef) ? `Section ${sectionHeading(state, g.docSectionRef)}` : null]
                          .filter(Boolean)
                          .join(". ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
