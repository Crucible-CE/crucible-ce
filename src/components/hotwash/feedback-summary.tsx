"use client";

// Participant feedback summary for control. Averages per question and the
// written answers, without names.

import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { api } from "@/components/exercise/api";
import { usePoll } from "./use-poll";

interface Summary {
  responses: number;
  participants: number;
  averages: Record<string, number | null>;
  distribution: Record<string, number[]>;
  strengths: string[];
  improvements: string[];
  comments: string[];
}

interface Listing {
  summary: Summary;
  scales: Array<{ key: string; label: string }>;
}

function TextList({ title, items }: { title: string; items: string[] }) {
  return (
    <Card dense className="gap-2">
      <h3 className="text-[14px] font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">None yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((t, i) => (
            <li key={i} className="whitespace-pre-wrap break-words rounded-md bg-[color:var(--color-muted)]/60 px-3 py-2 text-[13px]">
              {t}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function FeedbackSummaryPanel({ exerciseId }: { exerciseId: string }) {
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<Listing>(`/api/exercises/${exerciseId}/feedback`);
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else setError(r.error);
  }, [exerciseId]);
  usePoll(load, 20000);

  if (!data) {
    if (error) return <p role="alert" className="text-[13px] text-[color:var(--mist-danger)]">{error}</p>;
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-[color:var(--color-muted-foreground)]" />
      </div>
    );
  }
  const s = data.summary;
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">
        {s.responses} of {s.participants} participants answered. Players fill the form from their exercise page.
      </p>
      <Card dense className="gap-2">
        <h3 className="text-[14px] font-semibold">Ratings</h3>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11.5px] text-[color:var(--color-muted-foreground)]">
              <th className="py-1 font-medium">Question</th>
              <th className="py-1 font-medium">Average</th>
              <th className="hidden py-1 font-medium sm:table-cell">1 to 5</th>
            </tr>
          </thead>
          <tbody>
            {data.scales.map((q) => (
              <tr key={q.key} className="border-t border-[color:var(--color-border)]">
                <td className="py-1.5 pr-3">{q.label}</td>
                <td className="py-1.5 font-mono tabular-nums">{s.averages[q.key] ?? "None"}</td>
                <td className="hidden py-1.5 font-mono text-[12px] tabular-nums text-[color:var(--color-muted-foreground)] sm:table-cell">
                  {(s.distribution[q.key] ?? []).join(" / ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="grid gap-3 lg:grid-cols-3">
        <TextList title="Strengths" items={s.strengths} />
        <TextList title="Improvements" items={s.improvements} />
        <TextList title="Comments" items={s.comments} />
      </div>
    </div>
  );
}
