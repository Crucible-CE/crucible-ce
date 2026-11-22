"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldSelect } from "@/components/form/field-select";
import { request } from "./api";

interface Capability {
  key: string;
  name: string;
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export function BuildForm({
  documentId,
  documentTitle,
  sectionCount,
  onCreated,
  extra,
}: {
  documentId: string;
  documentTitle: string;
  sectionCount: number;
  /** Called with the new template id instead of opening the editor. */
  onCreated?: (templateId: string, title: string) => void;
  /** More fields shown before the submit button. */
  extra?: React.ReactNode;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(`${documentTitle} tabletop`.slice(0, 160));
  const [start, setStart] = useState<"sections" | "blank">(sectionCount > 0 ? "sections" : "blank");
  const [objectives, setObjectives] = useState<Array<{ text: string; capabilityKeys: string[] }>>([{ text: "", capabilityKeys: [] }]);
  const [groups, setGroups] = useState("");
  const [paced, setPaced] = useState<"facilitator" | "timer">("facilitator");
  const [minutes, setMinutes] = useState("15");
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void request<{ capabilities: Capability[] }>("/api/capabilities").then((r) => {
      if (r.ok) setCapabilities(r.data.capabilities);
    });
  }, []);

  function setObjective(i: number, patch: Partial<{ text: string; capabilityKeys: string[] }>) {
    setObjectives((list) => list.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const mins = minutes.trim() ? Number(minutes) : null;
    if (paced === "timer" && (!mins || mins < 5 || mins > 120)) return setError("Set minutes per module between 5 and 120.");
    setBusy(true);
    const r = await request<{ templateId: string }>(`/api/documents/${documentId}/templates`, {
      body: {
        title: title.trim(),
        objectives: objectives.filter((o) => o.text.trim()).map((o) => ({ text: o.text.trim(), capabilityKeys: o.capabilityKeys })),
        teams: lines(groups).slice(0, 10),
        moduleMinutes: mins && mins >= 5 ? Math.round(mins) : null,
        paced,
        start,
      },
      fallback: "The template was not created. Try again.",
    });
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    if (onCreated) {
      setBusy(false);
      onCreated(r.data.templateId, title.trim());
    } else router.push(`/documents/templates/${r.data.templateId}`);
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="max-w-3xl space-y-4">
      <Card className="gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="b-title">Exercise title</Label>
          <Input id="b-title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} required minLength={3} />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Start with</legend>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" name="b-start" className="mt-1" checked={start === "sections"} disabled={sectionCount === 0} onChange={() => setStart("sections")} />
            <span>
              One module per section
              <span className="block text-xs text-[color:var(--color-muted-foreground)]">
                {sectionCount > 0 ? `Each top-level section of the document becomes a module to fill in. The document has ${sectionCount} ${sectionCount === 1 ? "section" : "sections"}.` : "The document has no sections."}
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" name="b-start" className="mt-1" checked={start === "blank"} onChange={() => setStart("blank")} />
            <span>
              No modules
              <span className="block text-xs text-[color:var(--color-muted-foreground)]">Add each module yourself.</span>
            </span>
          </label>
        </fieldset>
      </Card>

      <Card className="gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Objectives</h2>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={objectives.length >= 8}
            onClick={() => setObjectives((l) => [...l, { text: "", capabilityKeys: [] }])}
          >
            <Plus className="h-4 w-4" />
            Add objective
          </Button>
        </div>
        {objectives.map((o, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-[color:var(--color-border)] p-3">
            <div className="flex gap-2">
              <Input aria-label={`Objective ${i + 1}`} placeholder="Validate the escalation path to the incident commander." value={o.text} maxLength={500} onChange={(e) => setObjective(i, { text: e.target.value })} />
              <Button type="button" size="icon" variant="ghost" aria-label="Remove objective" onClick={() => setObjectives((l) => l.filter((_, j) => j !== i))}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {o.capabilityKeys.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full bg-[color:var(--mist-indigo-soft)] px-2 py-0.5 text-xs text-[color:var(--mist-indigo)]"
                  onClick={() => setObjective(i, { capabilityKeys: o.capabilityKeys.filter((x) => x !== k) })}
                  aria-label={`Remove ${k}`}
                >
                  {capabilities.find((c) => c.key === k)?.name ?? k}
                  <X className="h-3 w-3" />
                </button>
              ))}
              {capabilities.length > 0 && o.capabilityKeys.length < 6 && (
                <FieldSelect
                  aria-label="Add capability"
                  className="h-8 w-60 text-xs"
                  value=""
                  onChange={(v) => v && setObjective(i, { capabilityKeys: [...new Set([...o.capabilityKeys, v])] })}
                  options={[{ value: "", label: "Add capability" }, ...capabilities.filter((c) => !o.capabilityKeys.includes(c.key)).map((c) => ({ value: c.key, label: `${c.key} ${c.name}` }))]}
                />
              )}
            </div>
          </div>
        ))}
        {objectives.length === 0 && <p className="text-sm text-[color:var(--color-muted-foreground)]">No objectives. Questions will not link to any.</p>}
      </Card>

      <Card className="gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="b-groups">Participating groups</Label>
          <Textarea id="b-groups" rows={3} placeholder={"Optional. One per line.\nIT operations\nLegal"} value={groups} onChange={(e) => setGroups(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="b-paced">Pacing</Label>
            <FieldSelect
              id="b-paced"
              value={paced}
              onChange={(v) => setPaced(v as "facilitator" | "timer")}
              options={[
                { value: "facilitator", label: "The facilitator advances" },
                { value: "timer", label: "Timed modules" },
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-minutes">Minutes per module</Label>
            <Input id="b-minutes" type="number" min={5} max={120} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="Optional" />
          </div>
        </div>
      </Card>

      {extra}
      {error && (
        <p role="alert" className="text-sm text-[color:var(--mist-danger)]">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" variant="accent" disabled={busy || title.trim().length < 3}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Write the modules
        </Button>
      </div>
    </form>
  );
}
