"use client";

// "Confirm it's you" (step-up) for sensitive two-factor changes: password,
// plus a second factor when the account has one. Success sets a 5-minute
// grant cookie server-side; `ensure()` resolves true once it is in place.

import { useCallback, useRef, useState } from "react";
import { AlertCircle, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, api, fetchMfaStatus, securityKeyAssertion, webauthnErrorMessage, type MfaStatus } from "./mfa-api";

const MARGIN_MS = 20_000;

export function useReauth(status: MfaStatus | null, onGranted?: (until: string) => void) {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const [grantedUntil, setGrantedUntil] = useState<string | null>(null);

  const until = grantedUntil ?? status?.reauthUntil ?? null;
  const ensure = useCallback((): Promise<boolean> => {
    if (until && new Date(until).getTime() - MARGIN_MS > Date.now()) return Promise.resolve(true);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, [until]);

  const finish = (ok: boolean, newUntil?: string) => {
    if (newUntil) {
      setGrantedUntil(newUntil);
      onGranted?.(newUntil);
    }
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  };

  /** Forget the grant (e.g. the server said it expired). */
  const reset = useCallback(() => setGrantedUntil(null), []);

  /** Always ask (the server said the grant is missing or expired). */
  const prompt = useCallback((): Promise<boolean> => {
    setGrantedUntil(null);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const dialog = (
    <ReauthDialog
      open={open}
      hasMfa={!!status?.enabled}
      hasTotp={!!status?.totp.enabled}
      hasKeys={(status?.webauthn.credentials.length ?? 0) > 0 && !!status?.webauthn.available}
      onCancel={() => finish(false)}
      onDone={(u) => finish(true, u)}
    />
  );
  return { ensure, prompt, dialog, reset };
}

/**
 * Step-up for actions outside Settings > Security (admin MFA reset, temp
 * password, require-MFA policy). Loads the caller's MFA status on demand so
 * the dialog asks for the right factor.
 * Usage: `const res = await withStepUp(() => fetch(...))`: asks first unless
 * a grant is still valid; if the server still answers 403 reauth_required
 * (the grant lapsed in between), asks again and retries once. null = cancelled.
 */
export function useStepUp() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const { prompt, dialog } = useReauth(status);
  const withStepUp = useCallback(
    async (call: () => Promise<Response>): Promise<Response | null> => {
      const s = await fetchMfaStatus().catch(() => null);
      setStatus(s);
      const valid = !!s?.reauthUntil && new Date(s.reauthUntil).getTime() - MARGIN_MS > Date.now();
      if (!valid && !(await prompt())) return null;
      const res = await call();
      if (res.status !== 403) return res;
      const body = (await res.clone().json().catch(() => null)) as { code?: string } | null;
      if (body?.code !== "reauth_required" || !(await prompt())) return res;
      return call();
    },
    [prompt],
  );
  return { withStepUp, dialog };
}

function ReauthDialog({
  open,
  hasMfa,
  hasTotp,
  hasKeys,
  onCancel,
  onDone,
}: {
  open: boolean;
  hasMfa: boolean;
  hasTotp: boolean;
  hasKeys: boolean;
  onCancel: () => void;
  onDone: (until: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setPassword("");
    setCode("");
    setError(null);
  };

  async function submit(extra: { webauthn?: unknown } = {}) {
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ reauthUntil: string }>("/api/user/mfa/reauth", {
        method: "POST",
        body: { password, ...(code.trim() && !extra.webauthn ? { code: code.trim() } : {}), ...extra },
      });
      reset();
      onDone(r.reauthUntil);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't confirm. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signInWithKey() {
    if (!password) {
      setError("Enter your password first.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const assertion = await securityKeyAssertion("/api/user/mfa/reauth/options");
      setBusy(false);
      await submit({ webauthn: JSON.parse(assertion) });
    } catch (err) {
      setError(webauthnErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onCancel();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[color:var(--mist-indigo)]" aria-hidden />
            Confirm it&apos;s you
          </DialogTitle>
          <DialogDescription>
            {hasMfa
              ? "Enter your password and a code, or use your security key."
              : "Enter your password."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="reauth-password">Password</Label>
            <PasswordInput id="reauth-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </div>
          {hasMfa && (
            <div className="space-y-1.5">
              <Label htmlFor="reauth-code">{hasTotp ? "Authenticator or recovery code" : "Recovery code"}</Label>
              <Input
                id="reauth-code"
                autoComplete="one-time-code"
                inputMode={hasTotp ? "numeric" : "text"}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={hasTotp ? "123456" : "XXXXX-XXXXX"}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-[12px] text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            {hasMfa && hasKeys && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void signInWithKey()}>
                Use security key
              </Button>
            )}
            <Button type="submit" disabled={busy || !password || (hasMfa && !code.trim())}>
              {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
              Confirm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
