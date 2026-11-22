"use client";

// New Crisis Sim template: start blank in the editor, or copy one from the
// library and edit the copy.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CloudSeam } from "@/components/cloud/cloud-seam";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "./editor/fields";
import { ScenarioIdeas } from "./scenario-ideas";

export interface LibraryTemplate {
  id: string;
  title: string;
  summary: string | null;
  injectCount: number;
  practice: boolean;
}

async function post(url: string, body?: unknown): Promise<{ id?: string; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (!res.ok || !data?.id) return { error: data?.error ?? "The template was not created. Try again." };
    return { id: data.id };
  } catch {
    return { error: "Could not reach the server. Check your connection and try again." };
  }
}

export function NewCrisisSim({ library }: { library: LibraryTemplate[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const valid = title.trim().length >= 3;

  async function blank() {
    if (!valid || busy) return;
    setBusy("blank");
    const r = await post("/api/templates", { mode: "crisissim", title: title.trim(), ...(summary.trim() ? { summary: summary.trim() } : {}) });
    setBusy(null);
    if (r.error) return toast.error(r.error);
    router.push(`/templates/${r.id}`);
  }

  async function copy(id: string) {
    if (busy) return;
    setBusy(id);
    const r = await post(`/api/templates/${id}/duplicate`);
    setBusy(null);
    if (r.error) return toast.error(r.error);
    router.push(`/templates/${r.id}`);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="h-fit gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Start blank</h2>
          <p className="text-[13px] text-[color:var(--color-muted-foreground)]">Write the injects, questions, options and scoring in the editor.</p>
        </div>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void blank();
          }}
        >
          <Field label="Title" htmlFor="cs-new-title" hint="At least 3 characters.">
            <Input id="cs-new-title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Summary" htmlFor="cs-new-summary">
            <Textarea id="cs-new-summary" rows={3} value={summary} maxLength={800} onChange={(e) => setSummary(e.target.value)} />
          </Field>
          <ScenarioIdeas
            disabled={busy !== null}
            onPick={(i) => {
              setTitle(i.title);
              setSummary(i.summary);
            }}
          />
          <div>
            <Button type="submit" variant="accent" disabled={!valid || busy !== null}>
              {busy === "blank" && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </Button>
          </div>
        </form>
        <CloudSeam feature="crisissim-generate" />
      </Card>

      <div className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Start from the library</h2>
          <p className="text-[13px] text-[color:var(--color-muted-foreground)]">Copy a scenario and change it to fit your organization.</p>
        </div>
        {library.length === 0 && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">The library is empty.</p>}
        {library.map((t) => (
          <Card key={t.id} dense className="gap-2">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t.title}</p>
                <p className="text-[12px] text-[color:var(--color-muted-foreground)]">
                  {t.injectCount} {t.injectCount === 1 ? "inject" : "injects"}
                  {t.practice ? ", practice" : ""}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void copy(t.id)}>
                {busy === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                Copy and edit
              </Button>
            </div>
            {t.summary && <p className="line-clamp-2 text-[13px] text-[color:var(--color-muted-foreground)]">{t.summary}</p>}
          </Card>
        ))}
      </div>
    </div>
  );
}
