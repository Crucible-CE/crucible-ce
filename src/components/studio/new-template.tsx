"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/templates/editor/fields";
import { ScenarioIdeas } from "@/components/templates/scenario-ideas";
import type { StudioMode } from "@/lib/exercise/studio/schema";

export function NewStudioTemplate({ mode }: { mode: StudioMode }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = title.trim().length >= 3;

  async function create() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/studio/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, title: title.trim(), ...(summary.trim() ? { summary: summary.trim() } : {}) }),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !data?.id) {
        toast.error(data?.error ?? "The template was not created. Try again.");
        return;
      }
      router.replace(`/studio/${data.id}`);
    } catch {
      toast.error("The template was not created. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-xl">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Field label="Title" htmlFor="studio-new-title" hint="At least 3 characters.">
          <Input id="studio-new-title" value={title} maxLength={160} autoFocus onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Summary" htmlFor="studio-new-summary">
          <Textarea id="studio-new-summary" rows={3} value={summary} maxLength={800} onChange={(e) => setSummary(e.target.value)} />
        </Field>
        {mode === "strategic" && (
          <ScenarioIdeas
            disabled={busy}
            onPick={(i) => {
              setTitle(i.title);
              setSummary(i.summary);
            }}
          />
        )}
        <div>
          <Button type="submit" disabled={!valid || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Create
          </Button>
        </div>
      </form>
    </Card>
  );
}
