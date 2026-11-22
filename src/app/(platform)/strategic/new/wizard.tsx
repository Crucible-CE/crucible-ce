"use client";

// Strategic TTX creation. Steps: template, shape. The template is a scripted
// MSEL built in the Studio (linear or branched); its teams, objectives and
// regulatory clocks carry over and can be changed in the lobby.

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FieldSelect } from "@/components/form/field-select";
import { api } from "@/components/exercise/api";

type Policy = "facilitator" | "all_teams" | "timer";

interface TemplateRow {
  id: string;
  mode: string;
  title: string;
  summary: string | null;
  status: string;
  scope?: string;
  injectCount?: number;
  teams?: string[];
  targetDurationMin?: number | null;
}

const STEPS = ["Template", "Shape"] as const;

/** Next weekday at 08:00 local time, as a datetime-local value. */
function defaultStart(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function StrategicWizard({ initialTemplateId = null, canBuild }: { initialTemplateId?: string | null; canBuild: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(initialTemplateId);
  const [title, setTitle] = useState("");

  const [policy, setPolicy] = useState<Policy>("facilitator");
  const [injectMinutes, setInjectMinutes] = useState(15);
  const [winDynamic, setWinDynamic] = useState(false);
  const [timebox, setTimebox] = useState("");
  const [scenarioStart, setScenarioStart] = useState(defaultStart);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ templates: TemplateRow[] }>("/api/templates?mode=strategic&status=published").then((r) => {
      const list = r.ok ? (r.data.templates ?? []).filter((t) => t.mode === "strategic" && t.status === "published") : [];
      setTemplates(list);
      const preset = initialTemplateId ? list.find((t) => t.id === initialTemplateId) : undefined;
      if (preset) setTitle((prev) => (prev.trim() ? prev : preset.title));
    });
    // initialTemplateId comes from the URL and never changes after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const template = templates?.find((t) => t.id === templateId) ?? null;
  const stepError = STEPS[step] === "Template" && !template ? "Pick a template." : null;

  async function create() {
    if (!template) return;
    setBusy(true);
    setError(null);
    const r = await api<{ id: string }>("/api/exercises", {
      body: {
        mode: "strategic",
        title: title.trim() || template.title,
        templateId: template.id,
        advancePolicy: policy,
        ...(timebox ? { timeboxMin: Math.max(5, Number(timebox)) } : {}),
        ...(scenarioStart ? { scenarioStartAt: new Date(scenarioStart).toISOString() } : {}),
        config: {
          source: "template",
          injectMinutes: policy === "timer" ? injectMinutes : null,
          winCondition: winDynamic ? "dynamic" : "none",
        },
      },
      fallback: "The exercise was not created. Try again.",
    });
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    router.push(`/exercises/${r.data.id}`);
  }

  const last = step === STEPS.length - 1;

  return (
    <div className="max-w-3xl space-y-6">
      <ol className="flex flex-wrap gap-2 text-[13px]" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              disabled={i > step}
              onClick={() => setStep(i)}
              className={cn(
                "rounded-full px-3 py-1",
                i === step
                  ? "bg-[color:var(--mist-indigo)] text-white"
                  : i < step
                    ? "bg-[color:var(--mist-indigo-soft)] text-[color:var(--mist-indigo)]"
                    : "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]",
              )}
              aria-current={i === step ? "step" : undefined}
            >
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>

      <Card className="gap-5">
        {STEPS[step] === "Template" && (
          <div className="space-y-4">
            <Field id="sw-title" label="Title">
              <Input id="sw-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={template?.title ?? "Ransomware at the regional plant"} />
            </Field>
            {templates === null ? (
              <Loader2 className="h-5 w-5 animate-spin text-[color:var(--color-muted-foreground)]" />
            ) : templates.length === 0 ? (
              <p className="text-sm text-[color:var(--color-muted-foreground)]">No published Strategic TTX templates yet.</p>
            ) : (
              <div role="radiogroup" aria-label="Template" className="grid gap-2">
                {initialTemplateId && templateId === initialTemplateId && !template && (
                  <p className="text-sm text-[color:var(--color-muted-foreground)]">That template is not published. Pick another one.</p>
                )}
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={templateId === t.id}
                    onClick={() => {
                      setTemplateId(t.id);
                      if (!title.trim() || templates.some((x) => x.title === title)) setTitle(t.title);
                    }}
                    className={cn("rounded-lg border p-3 text-left", templateId === t.id ? "border-[color:var(--mist-indigo)] ring-2 ring-[color:var(--mist-indigo)]" : "border-[color:var(--color-border)]")}
                  >
                    <span className="block text-sm font-semibold">{t.title}</span>
                    {t.summary && <span className="mt-0.5 block text-[12.5px] text-[color:var(--color-muted-foreground)]">{t.summary}</span>}
                    <span className="mt-1 block text-xs text-[color:var(--color-muted-foreground)]">
                      {t.injectCount ?? 0} injects, {t.teams?.length ?? 0} teams{t.targetDurationMin ? `, ${t.targetDurationMin} min` : ""}
                      {t.scope === "library" ? ", library" : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {canBuild && (
              <p className="text-[13px] text-[color:var(--color-muted-foreground)]">
                Need a different scenario?{" "}
                <Link href="/studio/new?mode=strategic" className="font-medium text-[color:var(--mist-indigo)] underline-offset-4 hover:underline">
                  Build one in the Studio
                </Link>
                .
              </p>
            )}
            {template && <p className="text-sm text-[color:var(--color-muted-foreground)]">The template sets the teams, objectives and regulatory clocks. Change them in the lobby.</p>}
          </div>
        )}

        {STEPS[step] === "Shape" && (
          <div className="space-y-4">
            <Field id="sw-policy" label="Advance">
              <FieldSelect
                id="sw-policy"
                value={policy}
                onChange={(v) => setPolicy(v as Policy)}
                options={[
                  { value: "facilitator", label: "When the facilitator advances" },
                  { value: "all_teams", label: "When every active team has answered" },
                  { value: "timer", label: "On a timer" },
                ]}
              />
            </Field>
            {policy === "timer" && (
              <Field id="sw-minutes" label="Minutes per inject">
                <Input id="sw-minutes" type="number" min={3} max={120} value={injectMinutes} onChange={(e) => setInjectMinutes(Math.min(120, Math.max(3, Number(e.target.value) || 3)))} />
              </Field>
            )}
            <Toggle id="sw-win" label="End early when teams succeed" hint="Ends when every active team is effective on two injects in a row." checked={winDynamic} onChange={setWinDynamic} />
            <div className="grid gap-4 md:grid-cols-2">
              <Field id="sw-timebox" label="Time box in minutes">
                <Input id="sw-timebox" type="number" min={5} max={1440} value={timebox} onChange={(e) => setTimebox(e.target.value)} placeholder="None" />
              </Field>
              <Field id="sw-start" label="Scenario start">
                <Input id="sw-start" type="datetime-local" value={scenarioStart} onChange={(e) => setScenarioStart(e.target.value)} />
              </Field>
            </div>
          </div>
        )}
      </Card>

      {(error || stepError) && (
        <p role="alert" className="text-[13px] text-[color:var(--mist-danger)]">
          {error ?? stepError}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {step > 0 && (
          <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={busy}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        )}
        {last ? (
          <Button type="button" variant="accent" disabled={busy || Boolean(stepError)} onClick={() => void create()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Create exercise
          </Button>
        ) : (
          <Button type="button" variant="accent" disabled={Boolean(stepError)} onClick={() => setStep((s) => s + 1)}>
            Next
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-[color:var(--color-muted-foreground)]">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
