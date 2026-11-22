"use client";

// "How to write the AAR": the after-action steps in HSEEP order, what still
// blocks finalize, and a prompt with the exercise record for the
// facilitator's own AI tool. Same dialog as "How to build this".

import { useCallback, useState } from "react";
import { api } from "@/components/exercise/api";
import { BuildGuideDialog } from "@/components/templates/build-guide-dialog";
import { AAR_GUIDE_STEPS } from "@/lib/exercise/aar/guide";

export const AAR_GUIDE_COPY = {
  trigger: "How to write the AAR",
  title: "How to write the AAR",
  description: "The after-action steps in order, and a prompt for your own AI tool.",
  caution: "Use your organization's approved AI tool. The prompt includes exercise details.",
  manual: "Copy each part into the matching field. The report does not import it.",
  blockers: "Still blocks finalize",
  ready: "Nothing blocks finalize.",
  loading: "Loading the record.",
} as const;

export function AarGuideDialog({ exerciseId }: { exerciseId: string }) {
  const [prompt, setPrompt] = useState("");
  const [problems, setProblems] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setProblems(null);
    const r = await api<{ prompt: string; problems: string[] }>(`/api/exercises/${exerciseId}/aar/guide`);
    if (r.ok) {
      setPrompt(r.data.prompt);
      setProblems(r.data.problems);
    } else {
      setPrompt("");
      setProblems([r.error]);
    }
  }, [exerciseId]);

  const buildPrompt = useCallback(() => prompt, [prompt]);

  return (
    <BuildGuideDialog
      editorName="The report"
      steps={AAR_GUIDE_STEPS}
      buildPrompt={buildPrompt}
      size="sm"
      brackets={false}
      onOpen={() => void load()}
      copy={{ trigger: AAR_GUIDE_COPY.trigger, title: AAR_GUIDE_COPY.title, description: AAR_GUIDE_COPY.description, caution: AAR_GUIDE_COPY.caution, manual: AAR_GUIDE_COPY.manual }}
      extra={
        <section className="flex flex-col gap-2" data-testid="aar-guide-blockers" aria-live="polite">
          <h3 className="text-[13px] font-semibold">{AAR_GUIDE_COPY.blockers}</h3>
          {problems === null ? (
            <p className="text-[13px] text-[color:var(--color-muted-foreground)]">{AAR_GUIDE_COPY.loading}</p>
          ) : problems.length === 0 ? (
            <p className="text-[13px]">{AAR_GUIDE_COPY.ready}</p>
          ) : (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] leading-snug">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </section>
      }
    />
  );
}
