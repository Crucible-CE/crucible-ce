"use client";

// HSEEP Participant Feedback Form. One per participant; editable until the
// after-action report is final. Works for guests and signed-in users.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/components/exercise/api";
import { cn } from "@/lib/utils";

type ScaleKey = "overall" | "realism" | "relevance" | "roleClarity";

interface FormValues {
  overall: number | null;
  realism: number | null;
  relevance: number | null;
  roleClarity: number | null;
  strengths: string;
  improvements: string;
  comments: string;
}

interface Loaded {
  exercise: { id: string; title: string; status: string } | null;
  feedback: (Omit<FormValues, ScaleKey> & Record<ScaleKey, number> & { updatedAt: string }) | null;
  closedReason: string | null;
  scales: Array<{ key: ScaleKey; label: string }>;
}

const EMPTY: FormValues = { overall: null, realism: null, relevance: null, roleClarity: null, strengths: "", improvements: "", comments: "" };

function Scale({ name, label, value, onChange, disabled }: { name: string; label: string; value: number | null; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-[13.5px] font-medium">{label}</legend>
      <div className="flex gap-1.5" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            name={name}
            aria-checked={value === n}
            disabled={disabled}
            onClick={() => onChange(n)}
            className={cn(
              "h-11 w-11 rounded-md border text-[15px] font-semibold tabular-nums transition-colors disabled:opacity-50",
              value === n ? "border-[color:var(--mist-indigo)] bg-[color:var(--mist-indigo)] text-white" : "border-[color:var(--color-border)] hover:bg-[color:var(--color-muted)]",
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex w-[244px] justify-between text-[11px] text-[color:var(--color-muted-foreground)]">
        <span>Strongly disagree</span>
        <span>Strongly agree</span>
      </div>
    </fieldset>
  );
}

export function FeedbackForm({ exerciseId }: { exerciseId: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState<FormValues>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const r = await api<Loaded>(`/api/play/${exerciseId}/feedback`);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setData(r.data);
    if (r.data.feedback) {
      const f = r.data.feedback;
      setV({ overall: f.overall, realism: f.realism, relevance: f.relevance, roleClarity: f.roleClarity, strengths: f.strengths, improvements: f.improvements, comments: f.comments });
      setSaved(true);
    }
  }, [exerciseId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    if (error) return <p role="alert" className="py-10 text-center text-[13px] text-[color:var(--mist-danger)]">{error}</p>;
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-[color:var(--color-muted-foreground)]" />
      </div>
    );
  }

  const closed = data.closedReason;
  const complete = v.overall && v.realism && v.relevance && v.roleClarity;
  const set = <K extends keyof FormValues>(k: K, val: FormValues[K]) => {
    setV((prev) => ({ ...prev, [k]: val }));
    setSaved(false);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!complete) return;
    setBusy(true);
    const r = await api(`/api/play/${exerciseId}/feedback`, { method: "PUT", body: v, fallback: "Your feedback was not saved. Try again." });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setSaved(true);
    toast.success("Feedback saved.");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 py-4">
      <Link href={`/play/${exerciseId}`} className="inline-flex items-center gap-1 text-[13px] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]">
        <ArrowLeft className="h-4 w-4" />
        Exercise
      </Link>
      <div>
        <h1 className="headline">Participant feedback</h1>
        {data.exercise && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">{data.exercise.title}</p>}
      </div>
      {closed && <p className="rounded-md bg-[color:var(--color-muted)] px-3 py-2 text-[13px]">{closed}</p>}
      <Card>
        <form onSubmit={submit} className="space-y-5">
          {data.scales.map((s) => (
            <Scale key={s.key} name={s.key} label={s.label} value={v[s.key]} onChange={(n) => set(s.key, n)} disabled={Boolean(closed)} />
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="fb-strengths">What went well?</Label>
            <Textarea id="fb-strengths" value={v.strengths} onChange={(e) => set("strengths", e.target.value)} rows={3} maxLength={2000} disabled={Boolean(closed)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fb-improvements">What should improve?</Label>
            <Textarea id="fb-improvements" value={v.improvements} onChange={(e) => set("improvements", e.target.value)} rows={3} maxLength={2000} disabled={Boolean(closed)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fb-comments">Other comments</Label>
            <Textarea id="fb-comments" value={v.comments} onChange={(e) => set("comments", e.target.value)} rows={3} maxLength={2000} disabled={Boolean(closed)} />
          </div>
          <p className="text-[12px] text-[color:var(--color-muted-foreground)]">The control team sees answers without your name.</p>
          {!closed && (
            <div className="flex items-center justify-end gap-3">
              {saved && <span className="text-[12.5px] text-[color:var(--color-muted-foreground)]">Saved. You can change it until the report is final.</span>}
              <Button type="submit" disabled={busy || !complete}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {data.feedback ? "Update feedback" : "Send feedback"}
              </Button>
            </div>
          )}
        </form>
      </Card>
    </div>
  );
}
