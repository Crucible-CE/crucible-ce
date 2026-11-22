"use client";

// Public confirm page for an escalation contact's "are your details still
// current?" link. Opening the link changes nothing (scanner-safe); the contact
// must click Confirm, which POSTs the single-use, expiring token.

import { useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "done"; name: string | null; channel: "email" | "phone" }
  | { kind: "error"; message: string };

export default function EscalationVerifyPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ kind: "idle" });

  async function confirm() {
    setState({ kind: "submitting" });
    try {
      const res = await fetch(`/api/public/escalation-verify/${encodeURIComponent(token)}`, {
        method: "POST",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as { name?: string; error?: string; channel?: "email" | "phone" } | null;
      if (res.ok) setState({ kind: "done", name: body?.name ?? null, channel: body?.channel === "phone" ? "phone" : "email" });
      else setState({ kind: "error", message: body?.error ?? "This link can't be used." });
    } catch {
      setState({ kind: "error", message: "Couldn't confirm. Try again." });
    }
  }

  return (
    <div className="w-full max-w-md rounded-xl border border-border bg-card/80 p-6 text-center shadow-sm">
      {state.kind === "done" ? (
        <>
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-[color:var(--mist-ok)]" />
          <h1 className="text-lg font-semibold">Thanks{state.name ? `, ${state.name}` : ""}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {state.channel === "phone"
              ? "Phone number confirmed. You can close this page."
              : "Details confirmed. You can close this page."}
          </p>
        </>
      ) : state.kind === "error" ? (
        <>
          <XCircle className="mx-auto mb-3 h-10 w-10 text-[color:var(--mist-danger)]" />
          <h1 className="text-lg font-semibold">Link not valid</h1>
          <p className="mt-1 text-sm text-muted-foreground">{state.message}</p>
        </>
      ) : (
        <>
          <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-[color:var(--mist-indigo)]" />
          <h1 className="text-lg font-semibold">Confirm your contact details</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You&apos;re an escalation contact. Confirm your details are current. If not, tell your
            contact at the organization.
          </p>
          <Button className="mt-5 w-full" onClick={confirm} disabled={state.kind === "submitting"}>
            {state.kind === "submitting" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Confirm my details
          </Button>
        </>
      )}
    </div>
  );
}
