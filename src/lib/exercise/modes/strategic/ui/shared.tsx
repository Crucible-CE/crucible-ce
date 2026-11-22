"use client";

import { useEffect, useState } from "react";
import { ChevronDown, FileText, Hourglass, Mail, MessageSquare, MessagesSquare, Mic, Newspaper, ScrollText, Share2, Skull } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SafeMarkdown } from "@/components/markdown/safe-markdown";
import { ANSWER_RATING_LABELS, type AnswerRating } from "../schema";
import type { StArtifact, StGradeDetail, StInject, StState } from "./types";

export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn("text-xs font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]", className)}>{children}</h3>;
}

export function Notice({ icon = "wait", text }: { icon?: "wait" | "info"; text: string }) {
  return (
    <Card dense className="flex-row items-center gap-3 text-sm text-[color:var(--color-muted-foreground)]">
      {icon === "wait" ? <Hourglass className="h-4 w-4 shrink-0" aria-hidden /> : <MessagesSquare className="h-4 w-4 shrink-0" aria-hidden />}
      <span>{text}</span>
    </Card>
  );
}

/** "T+6h 10m" from the exercise scenario start. */
export function scenarioClock(state: Pick<StState, "exercise">, at: string | null): string | null {
  if (!at || !state.exercise.scenarioStartAt) return null;
  const mins = Math.round((Date.parse(at) - Date.parse(state.exercise.scenarioStartAt)) / 60_000);
  if (!Number.isFinite(mins)) return null;
  const abs = Math.abs(mins);
  const d = Math.floor(abs / 1440);
  const h = Math.floor((abs % 1440) / 60);
  const m = abs % 60;
  const parts = [d ? `${d}d` : "", h ? `${h}h` : "", m || (!d && !h) ? `${m}m` : ""].filter(Boolean).join(" ");
  return `T+${parts}`;
}

/** "Update 3", "Update 3, T+6h", "Contingency, T+6h". */
export function injectLine(state: Pick<StState, "exercise">, inject: StInject): string {
  const clock = scenarioClock(state, inject.scenarioTime);
  const head = inject.contingency ? "Contingency update" : `Update ${inject.seq}`;
  return clock ? `${head}, ${clock}` : head;
}

export function teamName(state: Pick<StState, "teams">, teamId: string | null | undefined): string {
  return state.teams.find((t) => t.id === teamId)?.name ?? "No team";
}

const KIND_LABEL: Record<StArtifact["kind"], string> = {
  email: "Email",
  social_post: "Social post",
  news: "News",
  ransom_note: "Ransom note",
  regulator_letter: "Regulator letter",
  chat: "Chat",
  voicemail: "Voicemail",
  document: "Document",
  log_excerpt: "Log excerpt",
};

const KIND_ICON: Record<StArtifact["kind"], typeof Mail> = {
  email: Mail,
  social_post: Share2,
  news: Newspaper,
  ransom_note: Skull,
  regulator_letter: ScrollText,
  chat: MessageSquare,
  voicemail: Mic,
  document: FileText,
  log_excerpt: FileText,
};

export function ArtifactCard({ artifact }: { artifact: StArtifact }) {
  const Icon = KIND_ICON[artifact.kind] ?? FileText;
  return (
    <details className="group rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <Icon className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{artifact.title}</span>
          <span className="block truncate text-xs text-[color:var(--color-muted-foreground)]">
            {KIND_LABEL[artifact.kind] ?? "Artifact"}
            {artifact.from ? ` from ${artifact.from}` : ""}
            {artifact.sentAt ? `, ${artifact.sentAt}` : ""}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className={cn("border-t border-[color:var(--color-border)] px-3 py-3 text-sm", (artifact.kind === "log_excerpt" || artifact.kind === "ransom_note") && "font-mono text-xs")}>
        {artifact.kind === "log_excerpt" ? <pre className="overflow-x-auto whitespace-pre-wrap break-words">{artifact.content}</pre> : <SafeMarkdown text={artifact.content} />}
      </div>
    </details>
  );
}

/** The shared narrative and the artifacts. */
export function InjectBody({ state, inject, children }: { state: Pick<StState, "exercise">; inject: StInject; children?: React.ReactNode }) {
  return (
    <Card className="gap-4">
      <div className="space-y-1">
        <p className="text-xs text-[color:var(--color-muted-foreground)]">{injectLine(state, inject)}</p>
        <h2 className="font-display text-xl font-semibold leading-tight">{inject.title}</h2>
      </div>
      <SafeMarkdown text={inject.narrativeMd} className="text-[15px] leading-relaxed" />
      {inject.artifacts.length > 0 && (
        <div className="space-y-2">
          <SectionLabel>Artifacts</SectionLabel>
          {inject.artifacts.map((a) => (
            <ArtifactCard key={a.id} artifact={a} />
          ))}
        </div>
      )}
      {children}
    </Card>
  );
}

const RATING_VARIANT: Record<string, "success" | "warning" | "destructive"> = {
  effective: "success",
  partially_effective: "warning",
  ineffective: "destructive",
};

export function ratingLabel(rating: string | null | undefined): string {
  return rating ? ((ANSWER_RATING_LABELS as Record<string, string>)[rating] ?? rating) : "Not rated";
}

export function RatingBadge({ rating, score }: { rating: string | null | undefined; score?: number | null; source?: string | null }) {
  if (!rating) return <Badge variant="outline">Not rated yet</Badge>;
  return (
    <Badge variant={RATING_VARIANT[rating] ?? "outline"}>
      {ratingLabel(rating as AnswerRating)}
      {typeof score === "number" ? `, ${score} of 4` : ""}
    </Badge>
  );
}

/**
 * Grade details for the control room. Refetches when the number of grades in
 * the projection changes (a new evaluator rating).
 */
export function useGradeDetails(exerciseId: string, enabled: boolean, gradeCount: number) {
  const [grades, setGrades] = useState<StGradeDetail[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch(`/api/strategic/${exerciseId}/grades`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { grades?: StGradeDetail[] } | null) => {
        if (live && d?.grades) setGrades(d.grades);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [exerciseId, enabled, gradeCount, tick]);
  return { grades: grades ?? [], reload: () => setTick((t) => t + 1) };
}

export async function postJson(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => null)) as { error?: string; details?: { fieldErrors?: Record<string, string[]> } } | null;
    const field = data?.details?.fieldErrors ? Object.values(data.details.fieldErrors).flat()[0] : undefined;
    return { ok: false, error: field ?? data?.error ?? "That did not work. Try again." };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }
}

