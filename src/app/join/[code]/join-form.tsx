"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldSelect } from "@/components/form/field-select";
import { api } from "@/components/exercise/api";

interface Preview {
  exerciseId: string;
  title: string;
  modeLabel: string;
  status: string;
  teamChoice: boolean;
  teams: Array<{ id: string; name: string }>;
  signedIn: boolean;
  alreadyJoined: boolean;
}

export function JoinForm({ code }: { code: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<Preview>(`/api/join/${encodeURIComponent(code)}`, { fallback: "That code does not work. Check it and try again." }).then((r) => {
      if (r.ok) setPreview(r.data);
      else setLoadError(r.error);
    });
  }, [code]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!preview) return;
    if (preview.teamChoice && !teamId) {
      setError("Pick a team.");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await api<{ exerciseId: string }>("/api/join", {
      body: {
        code,
        ...(preview.signedIn ? {} : { displayName: name }),
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(teamId ? { teamId } : {}),
      },
      fallback: "You could not join. Try again.",
    });
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    router.push(`/play/${r.data.exerciseId}`);
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/70 p-8 shadow-2xl shadow-black/30 backdrop-blur-xl">
        <h1 className="mb-3 text-xl font-extrabold tracking-tight">Join an exercise</h1>
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {loadError}
        </div>
        <Link href="/join" className="mt-5 inline-block text-sm font-medium text-[color:var(--mist-indigo)] underline-offset-4 hover:underline">
          Enter another code
        </Link>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-8 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <p className="text-[12.5px] text-muted-foreground">{preview.modeLabel}</p>
      <h1 className="mb-6 text-xl font-extrabold tracking-tight">{preview.title}</h1>
      {preview.alreadyJoined ? (
        <Button asChild className="h-11 w-full">
          <Link href={`/play/${preview.exerciseId}`}>Open the exercise</Link>
        </Button>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          {preview.signedIn && <p className="text-[12.5px] text-muted-foreground">You join with your account.</p>}
          {!preview.signedIn && (
            <div className="space-y-2">
              <Label htmlFor="join-name">Your name</Label>
              <Input id="join-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="name" required />
              <p className="text-[12.5px] text-muted-foreground">Others in the exercise see this name.</p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="join-title">Job title</Label>
            <Input id="join-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoComplete="organization-title" placeholder="Optional" />
          </div>
          {preview.teamChoice && (
            <div className="space-y-2">
              <Label htmlFor="join-team">Team</Label>
              <FieldSelect
                id="join-team"
                value={teamId}
                onChange={setTeamId}
                options={[{ value: "", label: "Pick a team" }, ...preview.teams.map((t) => ({ value: t.id, label: t.name }))]}
              />
            </div>
          )}
          {error && (
            <div role="alert" className="flex items-center gap-2 rounded-xl border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          <Button type="submit" className="h-11 w-full" disabled={busy || (!preview.signedIn && !name.trim())}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Join
          </Button>
        </form>
      )}
    </div>
  );
}
