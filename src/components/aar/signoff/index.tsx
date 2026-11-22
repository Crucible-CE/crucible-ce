"use client";

// <SignoffPanel exerciseId aarId />, rendered by the AAR page.
// Draft -> review -> facilitator signs -> sponsor countersigns (when required)
// -> final. Final versions are locked; Amend starts a new version. Exports:
// PDF and DOCX for any version (drafts marked Draft), evidence bundle when final.
//
// Draft and review are set by the AAR page. When the report turns final or an
// amendment starts, the panel dispatches a window "aar:changed" event with
// {exerciseId, aarId} and reloads the page.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { usePromptDialog } from "@/components/ui/prompt-dialog";
import { api } from "@/components/exercise/api";
import { formatInZone } from "@/lib/exercise/time";

interface Signature {
  role: string;
  name: string;
  title: string | null;
  signedAt: string;
  userId: string | null;
  accountName: string | null;
  keyId: string;
  enteredBy?: { userId: string; name: string };
}

interface State {
  aarId: string;
  exerciseId: string;
  version: number;
  status: string;
  isLatest: boolean;
  isPractice: boolean;
  problems: string[];
  unresolvedAfis: Array<{ id: string; title: string; objectiveText: string }>;
  required: Array<"facilitator" | "sponsor">;
  next: "facilitator" | "sponsor" | null;
  signatures: Signature[];
  contentHash: string | null;
  keyId: string | null;
  finalizedAt: string | null;
  previousId: string | null;
  bodyHash: string | null;
  approval: string;
  overviewSponsor: string;
  timezone: string;
  me: { userId: string; name: string; canDrive: boolean };
}

const ROLE_LABEL: Record<string, string> = { facilitator: "Facilitator", sponsor: "Sponsor" };
const STATUS_LABEL: Record<string, string> = { draft: "Draft", review: "In review", final: "Final" };
export const SIGNATURE_NOTE = "This signature shows the report has not changed since it was signed.";

function fmt(iso: string, tz: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : formatInZone(d, tz);
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function SignForm({ state, onSigned }: { state: State; onSigned: (final: boolean) => void }) {
  const role = state.next!;
  const [name, setName] = useState(role === "facilitator" ? state.me.name : "");
  const [title, setTitle] = useState("");
  const [onBehalf, setOnBehalf] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(role === "facilitator" ? state.me.name : "");
    setTitle("");
    setOnBehalf(false);
  }, [role, state.me.name]);

  async function sign(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await api<{ final: boolean }>(`/api/exercises/${state.exerciseId}/aar/sign`, {
      body: { aarId: state.aarId, role, name: name.trim(), title: title.trim(), onBehalf, bodyHash: state.bodyHash },
      fallback: "The signature was not recorded. Try again.",
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      onSigned(false);
      return;
    }
    toast.success(r.data.final ? "Signed. The report is final." : "Signed.");
    onSigned(r.data.final);
  }

  return (
    <form onSubmit={sign} className="space-y-3 rounded-md bg-[color:var(--color-muted)]/60 p-3">
      <p className="text-[13px] font-medium">{role === "facilitator" ? "Facilitator signature" : "Sponsor signature"}</p>
      {role === "sponsor" && state.me.canDrive && (
        <label className="flex items-center gap-2 text-[12.5px]">
          <input type="checkbox" checked={onBehalf} onChange={(e) => setOnBehalf(e.target.checked)} />
          Enter for a sponsor with no account
        </label>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="sig-name">Full name</Label>
          <Input id="sig-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sig-title">Title</Label>
          <Input id="sig-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
        </div>
      </div>
      {role === "sponsor" && state.overviewSponsor && name.trim().length >= 2 && norm(name) !== norm(state.overviewSponsor) && (
        <p role="status" className="text-[12.5px] text-[color:var(--mist-warn)]" data-testid="sponsor-mismatch">
          The report names {state.overviewSponsor} as sponsor. Check the name before signing.
        </p>
      )}
      <p className="text-[13px]" data-testid="approval-statement">
        {state.approval}
      </p>
      <p className="text-[12px] text-[color:var(--color-muted-foreground)]">
        {onBehalf ? "Your account is recorded as the one who entered it. " : `Signing as ${state.me.name}. `}
        {SIGNATURE_NOTE}
      </p>
      <div className="flex justify-end">
        <Button type="submit" disabled={busy || name.trim().length < 2 || !title.trim()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign
        </Button>
      </div>
    </form>
  );
}

function Panel({ exerciseId, aarId }: { exerciseId: string; aarId: string }) {
  const router = useRouter();
  const promptText = usePromptDialog();
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<State>(`/api/exercises/${exerciseId}/aar/finalize?aarId=${encodeURIComponent(aarId)}`);
    if (r.ok) {
      setState(r.data);
      setError(null);
    } else setError(r.error);
  }, [exerciseId, aarId]);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = useCallback(
    (opts: { reload?: boolean; aarId?: string } = {}) => {
      void load();
      if (!opts.reload || typeof window === "undefined") return;
      // The AAR workspace listens for this and reloads its data.
      window.dispatchEvent(new CustomEvent("aar:changed", { detail: { exerciseId, aarId: opts.aarId ?? aarId } }));
      router.refresh();
    },
    [load, router, exerciseId, aarId],
  );

  async function amend() {
    const reason = await promptText({
      title: "Amend this report?",
      description: "A new draft version starts. This version stays signed.",
      label: "Reason for the amendment",
      required: true,
      multiline: true,
      confirmLabel: "Amend",
    });
    if (reason === null) return;
    setBusy(true);
    const r = await api<{ id: string; version: number }>(`/api/exercises/${exerciseId}/aar/amend`, {
      body: { aarId, reason: reason.trim() },
      fallback: "The amendment was not created. Try again.",
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(`Version ${r.data.version} started.`);
    changed({ reload: true, aarId: r.data.id });
  }

  if (!state) {
    if (error) return <p role="alert" className="text-[13px] text-[color:var(--mist-danger)]">{error}</p>;
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-[color:var(--color-muted-foreground)]" />
      </div>
    );
  }

  const exportUrl = (format: string) => `/api/exercises/${exerciseId}/aar/export?format=${format}&aarId=${encodeURIComponent(aarId)}`;
  const isFinal = state.status === "final";
  const canSign = state.status === "review" && state.problems.length === 0 && state.next !== null && state.isLatest && Boolean(state.bodyHash);

  return (
    <Card dense className="gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 text-[15px] font-semibold">Sign-off</h3>
        <Badge variant="outline">Version {state.version}</Badge>
        <Badge variant={isFinal ? "success" : state.status === "review" ? "accent" : "secondary"}>{STATUS_LABEL[state.status] ?? state.status}</Badge>
      </div>

      {state.isPractice && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">Practice exercises do not get a signed report.</p>}

      <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">
        Signatures needed. {state.required.map((r) => ROLE_LABEL[r]).join(", then ")}.
      </p>

      {state.signatures.length > 0 && (
        <ul className="space-y-1.5">
          {state.signatures.map((s) => (
            <li key={s.role} className="rounded-md bg-[color:var(--color-muted)]/60 px-3 py-2 text-[13px]">
              <p>
                <span className="font-medium">{ROLE_LABEL[s.role] ?? s.role}</span> {s.name}
                {s.title ? `, ${s.title}` : ""}
              </p>
              <p className="text-[11.5px] text-[color:var(--color-muted-foreground)]">
                Signed {fmt(s.signedAt, state.timezone)}
                {s.accountName ? `. Account ${s.accountName}` : ""}
                {s.enteredBy ? `. Entered by ${s.enteredBy.name}.` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      {!isFinal && state.problems.length > 0 && (
        <ul className="space-y-1 text-[12.5px] text-[color:var(--mist-warn)]">
          {state.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {!isFinal && state.unresolvedAfis.length > 0 && (
        <ul className="list-inside list-disc text-[12.5px] text-[color:var(--color-muted-foreground)]">
          {state.unresolvedAfis.slice(0, 8).map((a) => (
            <li key={a.id}>{a.title}</li>
          ))}
        </ul>
      )}

      {canSign && <SignForm state={state} onSigned={(final) => changed({ reload: final })} />}

      {isFinal && (
        <div className="space-y-1 rounded-md border border-[color:var(--color-border)] p-3 text-[12.5px]">
          <p className="flex items-center gap-1.5 font-medium">
            <ShieldCheck className="h-4 w-4 text-[color:var(--mist-ok)]" />
            {SIGNATURE_NOTE}
          </p>
          {state.finalizedAt && <p className="text-[color:var(--color-muted-foreground)]">Final {fmt(state.finalizedAt, state.timezone)}</p>}
          {state.keyId && (
            <p className="break-all text-[color:var(--color-muted-foreground)]">
              Key ID <span className="font-mono">{state.keyId}</span>
            </p>
          )}
          {state.contentHash && (
            <p className="break-all text-[color:var(--color-muted-foreground)]">
              Content hash <span className="font-mono">{state.contentHash}</span>
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <a href={exportUrl("pdf")} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium hover:bg-[color:var(--color-muted)]">
          <Download className="h-3.5 w-3.5" />
          {isFinal ? "PDF" : "Draft PDF"}
        </a>
        <a href={exportUrl("docx")} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium hover:bg-[color:var(--color-muted)]">
          <Download className="h-3.5 w-3.5" />
          {isFinal ? "Word" : "Draft Word"}
        </a>
        {isFinal && (
          <a href={exportUrl("bundle")} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium hover:bg-[color:var(--color-muted)]">
            <Download className="h-3.5 w-3.5" />
            Evidence bundle
          </a>
        )}
        <span className="flex-1" />
        {state.me.canDrive && state.isLatest && !state.isPractice && (
          <>
            {isFinal && (
              <Button size="sm" variant="outline" onClick={() => void amend()} disabled={busy}>
                Amend
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

export function SignoffPanel({ exerciseId, aarId }: { exerciseId: string; aarId: string }) {
  return (
    <ConfirmDialogProvider>
      <Panel exerciseId={exerciseId} aarId={aarId} />
    </ConfirmDialogProvider>
  );
}

