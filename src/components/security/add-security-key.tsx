"use client";

// Add a security key or passkey: a name, then the browser's WebAuthn prompt.

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerSecurityKey, webauthnErrorMessage } from "./mfa-api";

export function AddSecurityKey({
  ensureReauth,
  onAdded,
  onCancel,
  unavailableReason,
}: {
  ensureReauth: () => Promise<boolean>;
  onAdded: (recoveryCodes: string[] | null) => void;
  onCancel?: () => void;
  unavailableReason: string | null;
}) {
  const [name, setName] = useState("Security key");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!(await ensureReauth())) return;
    setBusy(true);
    try {
      onAdded(await registerSecurityKey(name.trim() || "Security key"));
    } catch (err) {
      setError(webauthnErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (unavailableReason) {
    return (
      <p role="note" className="flex items-start gap-2 rounded-md border border-[color:var(--mist-warn)]/40 bg-[color:var(--mist-warn)]/10 p-3 text-[12px] text-[color:var(--mist-warn)]">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {unavailableReason}
      </p>
    );
  }

  return (
    <form onSubmit={add} className="space-y-3" data-testid="add-security-key">
      <div className="space-y-1.5">
        <Label htmlFor="webauthn-name">Name this key</Label>
        <Input id="webauthn-name" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="YubiKey" />
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-[12px] text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
          Register key
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
