"use client";

// Authenticator-app enrollment: QR code + manual-entry key, then the first
// code to confirm. Used by Settings > Security and the require-MFA page.

import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "./mfa-api";

interface Setup {
  secret: string;
  secretDisplay: string;
  qrDataUrl: string;
  issuer: string;
  account: string;
}

export function TotpSetup({
  ensureReauth,
  onEnabled,
  onCancel,
}: {
  ensureReauth: () => Promise<boolean>;
  onEnabled: (recoveryCodes: string[] | null) => void;
  onCancel?: () => void;
}) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!(await ensureReauth())) {
        onCancel?.();
        return;
      }
      try {
        const s = await api<Setup>("/api/user/mfa/totp/setup", { method: "POST" });
        if (!cancelled) setSetup(s);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't start setup. Try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Start once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ recoveryCodes: string[] | null }>("/api/user/mfa/totp/enable", { method: "POST", body: { code: code.trim() } });
      onEnabled(r.recoveryCodes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't verify the code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!setup) {
    return (
      <div className="flex min-h-40 items-center justify-center" aria-live="polite">
        {error ? (
          <p role="alert" className="flex items-start gap-2 text-[13px] text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {error}
          </p>
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Preparing setup" />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="totp-setup">
      <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-muted-foreground">
        <li>Open your authenticator app.</li>
        <li>Scan the QR code or enter the setup key.</li>
        <li>Enter the 6-digit code.</li>
      </ol>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {/* eslint-disable-next-line @next/next/no-img-element -- server-rendered data: URL */}
        <img
          src={setup.qrDataUrl}
          alt={`QR code to add ${setup.account} to your authenticator app`}
          width={176}
          height={176}
          className="h-44 w-44 shrink-0 rounded-lg border border-border bg-white p-1.5"
        />
        <div className="w-full min-w-0 space-y-2">
          <p className="text-xs text-muted-foreground">Setup key (time-based, 6 digits)</p>
          <code
            data-testid="totp-secret"
            data-secret={setup.secret}
            className="block select-all break-all rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-[13px] tracking-wider"
          >
            {setup.secretDisplay}
          </code>
          <p className="text-xs text-muted-foreground">
            Account: <span className="font-medium text-foreground">{setup.account}</span> · Issuer: {setup.issuer}
          </p>
        </div>
      </div>
      <form onSubmit={confirm} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="totp-code">6-digit code</Label>
          <Input
            id="totp-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className="max-w-48 font-mono tracking-widest"
            required
          />
        </div>
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-[12px] text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || code.replace(/\s/g, "").length !== 6}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
            Verify and turn on
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
