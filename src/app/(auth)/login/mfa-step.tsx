"use client";

// Sign-in second step: the password was accepted, the account has two-factor
// on, and no session exists yet. Completes through the "mfa" credentials
// provider, which checks the pending-ticket cookie plus one factor.

import { useState } from "react";
import { signIn } from "next-auth/react";
import { AlertCircle, ArrowLeft, Fingerprint, Loader2, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { securityKeyAssertion, webauthnErrorMessage } from "@/components/security/mfa-api";

export interface PendingFactors {
  totp: boolean;
  webauthn: boolean;
  recovery: boolean;
}

const primaryBtn =
  "flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[color:var(--mist-indigo)] to-[color:var(--mist-indigo-hi)] text-[13px] font-semibold text-white shadow-lg shadow-[color:var(--mist-indigo)]/15 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[color:var(--mist-indigo)]/25 disabled:pointer-events-none disabled:opacity-50";
const secondaryBtn =
  "flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-[13px] font-semibold transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-50";

function messageFor(code: string | undefined): string {
  if (code === "mfa_rate_limited") return "Too many attempts. Wait a few minutes and try again.";
  return "That code didn't work. Try again.";
}

export function MfaStep({
  factors,
  onSuccess,
  onExpired,
  onBack,
}: {
  factors: PendingFactors;
  onSuccess: (method: "totp" | "recovery" | "webauthn") => void;
  onExpired: () => void;
  onBack: () => void;
}) {
  // "primary": security key and/or authenticator code; "recovery": a recovery code.
  const [mode, setMode] = useState<"primary" | "recovery">(factors.totp || factors.webauthn ? "primary" : "recovery");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "code" | "key">(null);

  async function complete(method: "totp" | "recovery" | "webauthn", payload: Record<string, string>) {
    const result = await signIn("mfa", { method, ...payload, redirect: false });
    if (result?.error) {
      const c = (result as { code?: string }).code;
      if (c === "mfa_expired") {
        onExpired();
        return false;
      }
      setError(messageFor(c));
      return false;
    }
    onSuccess(method);
    return true;
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("code");
    const ok = await complete(mode === "recovery" ? "recovery" : "totp", { code: code.trim() });
    if (!ok) setBusy(null);
  }

  async function signInWithKey() {
    setError(null);
    setBusy("key");
    try {
      const response = await securityKeyAssertion("/api/public/mfa/webauthn-options");
      const ok = await complete("webauthn", { response });
      if (!ok) setBusy(null);
    } catch (err) {
      setError(webauthnErrorMessage(err));
      setBusy(null);
    }
  }

  const showCodeForm = mode === "recovery" || factors.totp;
  const primaryLabel = factors.totp && factors.webauthn ? "Use your security key or app" : factors.totp ? "Use your authenticator app" : "Use your security key";

  return (
    <div className="space-y-5" data-testid="mfa-step">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--mist-indigo)]/10 text-[color:var(--mist-indigo)]">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h2 className="text-xl font-extrabold tracking-tight">Two-factor sign-in</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Confirm it&apos;s you.</p>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          {error}
        </div>
      )}

      {factors.webauthn && mode === "primary" && (
        <button type="button" onClick={() => void signInWithKey()} disabled={!!busy} className={factors.totp ? secondaryBtn : primaryBtn}>
          {busy === "key" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Fingerprint className="h-4 w-4" aria-hidden />}
          Use your security key
        </button>
      )}

      {factors.webauthn && factors.totp && mode === "primary" && (
        <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>
      )}

      {showCodeForm && (
        <form onSubmit={submitCode} className="space-y-4">
          {mode === "primary" ? (
            <div className="space-y-2">
              <Label htmlFor="mfa-code">6-digit code from your authenticator app</Label>
              <Input
                id="mfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]*"
                maxLength={7}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                autoFocus
                className="h-11 rounded-xl font-mono tracking-widest"
                required
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="recovery-code">Recovery code</Label>
              <Input
                id="recovery-code"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="XXXXX-XXXXX"
                autoFocus
                className="h-11 rounded-xl font-mono tracking-wider"
                required
              />
              <p className="text-[12px] text-muted-foreground">Each recovery code works once.</p>
            </div>
          )}
          <button type="submit" disabled={!!busy || !code.trim()} className={primaryBtn}>
            {busy === "code" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Verify
          </button>
        </form>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back
        </button>
        {factors.recovery && (factors.totp || factors.webauthn) && (
          <button
            type="button"
            onClick={() => {
              setMode(mode === "recovery" ? "primary" : "recovery");
              setCode("");
              setError(null);
            }}
            className="font-medium text-primary hover:underline"
          >
            {mode === "recovery" ? primaryLabel : "Use a recovery code"}
          </button>
        )}
      </div>
    </div>
  );
}
