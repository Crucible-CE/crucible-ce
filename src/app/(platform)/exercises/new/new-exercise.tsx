"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, LayoutTemplate, Loader2, Network, Swords } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { api } from "@/components/exercise/api";

interface TemplateRow {
  id: string;
  mode: string;
  title: string;
  summary: string | null;
  status: string;
  injectCount?: number;
  teams?: string[];
  targetDurationMin?: number | null;
  practice?: boolean;
}

const MODE_CARDS = [
  { key: "crisissim", label: "Crisis Sim", icon: Swords, text: "Leaders vote on decisions as the incident improves or gets worse." },
  { key: "document", label: "Playbook Exercise", icon: FileText, text: "Walk through your own plan or playbook one module at a time." },
  { key: "strategic", label: "Strategic TTX", icon: Network, text: "Several teams respond to the same incident from their own seat." },
] as const;

export function NewExercise({
  availableModes,
  initialMode = null,
  initialTemplateId = null,
}: {
  availableModes: Array<{ key: string; label: string }>;
  /** From ?mode=, opens that type's template list. */
  initialMode?: string | null;
  /** From ?templateId=, picks that published template. */
  initialTemplateId?: string | null;
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ templates: TemplateRow[] } | TemplateRow[]>("/api/templates?status=published").then((r) => {
      if (!r.ok) {
        setTemplates([]);
        return;
      }
      const list = (Array.isArray(r.data) ? r.data : (r.data.templates ?? [])).filter((t) => t.status === "published");
      setTemplates(list);
      const enabled = new Set(availableModes.map((m) => m.key));
      const preset = initialTemplateId ? list.find((t) => t.id === initialTemplateId && enabled.has(t.mode)) : undefined;
      if (preset && (!initialMode || initialMode === preset.mode)) {
        setMode(preset.mode);
        setTemplateId(preset.id);
        setTitle(preset.title);
      } else if (initialMode && enabled.has(initialMode) && list.some((t) => t.mode === initialMode)) {
        setMode(initialMode);
      }
    });
    // The presets come from the URL and never change after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byMode = useMemo(() => {
    const m = new Map<string, TemplateRow[]>();
    for (const t of templates ?? []) m.set(t.mode, [...(m.get(t.mode) ?? []), t]);
    return m;
  }, [templates]);

  const available = new Set(availableModes.map((m) => m.key));
  // Playbook Exercise always shows: it starts a guided setup from a document.
  const modes = MODE_CARDS.filter((c) => available.has(c.key) && (c.key === "document" || (byMode.get(c.key)?.length ?? 0) > 0));
  const chosen = templates?.find((t) => t.id === templateId) ?? null;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!mode || !chosen) return;
    setBusy(true);
    setError(null);
    const r = await api<{ id: string }>("/api/exercises", {
      body: { mode, title: title.trim() || chosen.title, templateId: chosen.id, ...(chosen.practice ? { isPractice: true } : {}) },
      fallback: "The exercise was not created. Try again.",
    });
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    router.push(`/exercises/${r.data.id}`);
  }

  if (templates === null) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-[color:var(--color-muted-foreground)]" />
      </div>
    );
  }

  const footer = (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
      <Link href="/templates/new" className="font-medium text-[color:var(--mist-indigo)] underline-offset-4 hover:underline">
        Create a template
      </Link>
      {available.has("document") && (
        <Link href="/documents" className="font-medium text-[color:var(--mist-indigo)] underline-offset-4 hover:underline">
          Use a document
        </Link>
      )}
      {available.has("strategic") && (
        <Link href="/strategic/new" className="font-medium text-[color:var(--mist-indigo)] underline-offset-4 hover:underline">
          Build a Strategic TTX
        </Link>
      )}
    </div>
  );

  if (modes.length === 0) {
    return (
      <EmptyState
        icon={LayoutTemplate}
        title="No published templates yet."
        description="An exercise starts from a published template."
        action={
          <Link
            href="/templates/new"
            className="inline-flex h-9 items-center rounded-md bg-[color:var(--mist-indigo)] px-4 text-sm font-medium text-white hover:bg-[color:var(--mist-indigo-hi)]"
          >
            Create a template
          </Link>
        }
      />
    );
  }

  if (!mode) {
    return (
      <div className="space-y-6">
        <h2 className="text-base font-semibold">Type</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {modes.map((c) => {
            const Icon = c.icon;
            const count = byMode.get(c.key)?.length ?? 0;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => {
                  if (c.key === "document") {
                    router.push("/exercises/new/playbook");
                    return;
                  }
                  setMode(c.key);
                  setTemplateId(null);
                }}
                className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-ring)]"
              >
                <Card className="h-full gap-3 transition-shadow hover:shadow-[var(--elevation-2)]">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[color:var(--mist-indigo-soft)] text-[color:var(--mist-indigo)]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="text-[15px] font-semibold">{c.label}</div>
                    <p className="mt-1 text-[13px] text-[color:var(--color-muted-foreground)]">{c.text}</p>
                  </div>
                  <span className="text-[12px] text-[color:var(--color-muted-foreground)]">
                    {c.key === "document" ? "Guided setup from a document" : `${count} ${count === 1 ? "template" : "templates"}`}
                  </span>
                </Card>
              </button>
            );
          })}
        </div>
        {footer}
      </div>
    );
  }

  const list = byMode.get(mode) ?? [];
  return (
    <form onSubmit={create} className="space-y-6">
      <Button type="button" variant="ghost" size="sm" onClick={() => setMode(null)}>
        <ArrowLeft className="h-4 w-4" />
        Back
      </Button>
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Template</h2>
        <div role="radiogroup" aria-label="Template" className="grid gap-3 md:grid-cols-2">
          {list.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={templateId === t.id}
              onClick={() => {
                setTemplateId(t.id);
                if (!title.trim() || list.some((x) => x.title === title)) setTitle(t.title);
              }}
              className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-ring)]"
            >
              <Card dense className={cn("h-full", templateId === t.id && "ring-2 ring-[color:var(--mist-indigo)]")}>
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 text-[14px] font-semibold">{t.title}</span>
                  {t.practice && <Badge variant="outline">Practice</Badge>}
                </div>
                {t.summary && <p className="line-clamp-3 text-[12.5px] text-[color:var(--color-muted-foreground)]">{t.summary}</p>}
                <div className="flex flex-wrap gap-x-3 text-[12px] text-[color:var(--color-muted-foreground)]">
                  {typeof t.injectCount === "number" && <span>{t.injectCount} injects</span>}
                  {t.teams && t.teams.length > 0 && <span>{t.teams.length} teams</span>}
                  {t.targetDurationMin ? <span>{t.targetDurationMin} min</span> : null}
                </div>
              </Card>
            </button>
          ))}
        </div>
      </section>
      <section className="max-w-xl space-y-2">
        <Label htmlFor="new-title">Title</Label>
        <Input id="new-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={chosen?.title ?? "Pick a template first"} />
      </section>
      {error && (
        <p role="alert" className="text-[13px] text-[color:var(--mist-danger)]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="accent" disabled={!chosen || busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Create exercise
        </Button>
        {footer}
      </div>
    </form>
  );
}
