"use client";

// Settings > Security: two-factor sign-in status, the authenticator app,
// security keys / passkeys, recovery codes, and turning it all off.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Fingerprint,
  KeyRound,
  LifeBuoy,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ApiError, api, fetchMfaStatus, formatDate, type MfaStatus } from "./mfa-api";
import { useReauth } from "./reauth-dialog";
import { TotpSetup } from "./totp-setup";
import { AddSecurityKey } from "./add-security-key";
import { RecoveryCodesDialog } from "./recovery-codes";

function Section({ icon: Icon, title, children, action }: { icon: typeof KeyRound; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border/60 pt-4 first:border-0 first:pt-0" aria-label={title}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-[color:var(--mist-indigo)]" aria-hidden />
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SecuritySettings() {
  const confirm = useConfirm();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [totpOpen, setTotpOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      setStatus(await fetchMfaStatus());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Couldn't load security settings. Try again.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const { ensure, dialog: reauthDialog, reset: resetReauth } = useReauth(status);

  /** Run a sensitive call; re-asks for confirmation if the server says the grant lapsed. */
  async function sensitive<T>(key: string, call: () => Promise<T>): Promise<T | null> {
    if (!(await ensure())) return null;
    setBusy(key);
    try {
      return await call();
    } catch (err) {
      if (err instanceof ApiError && err.code === "reauth_required") {
        resetReauth();
        toast.error("Confirm it's you again.");
      } else {
        toast.error(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
      }
      return null;
    } finally {
      setBusy(null);
    }
  }

  function afterEnroll(recoveryCodes: string[] | null, what: string) {
    setTotpOpen(false);
    setKeyOpen(false);
    toast.success(`${what} added. Two-factor sign-in is on.`);
    if (recoveryCodes) setCodes(recoveryCodes);
    void reload();
  }

  async function removeTotp() {
    const ok = await confirm({
      title: "Remove the authenticator app?",
      description: "Codes from the app will stop working.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    const r = await sensitive("totp", () => api<{ mfaOff: boolean }>("/api/user/mfa/totp", { method: "DELETE" }));
    if (r) {
      toast.success(r.mfaOff ? "Authenticator app removed. Two-factor sign-in is off." : "Authenticator app removed.");
      void reload();
    }
  }

  async function removeKey(id: string, name: string) {
    const ok = await confirm({ title: `Remove "${name}"?`, description: "This key will stop working.", confirmLabel: "Remove", destructive: true });
    if (!ok) return;
    const r = await sensitive(`key:${id}`, () => api<{ mfaOff: boolean }>(`/api/user/mfa/webauthn/${id}`, { method: "DELETE" }));
    if (r) {
      toast.success(r.mfaOff ? "Key removed. Two-factor sign-in is off." : "Security key removed.");
      void reload();
    }
  }

  async function saveRename() {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) return;
    setBusy(`rename:${renaming.id}`);
    try {
      await api(`/api/user/mfa/webauthn/${renaming.id}`, { method: "PATCH", body: { name } });
      setRenaming(null);
      void reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't rename the key. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function regenerate() {
    const ok = await confirm({
      title: "Generate new recovery codes?",
      description: "Your current codes stop working.",
      confirmLabel: "Generate new codes",
    });
    if (!ok) return;
    const r = await sensitive("recovery", () => api<{ recoveryCodes: string[] }>("/api/user/mfa/recovery-codes", { method: "POST" }));
    if (r) {
      setCodes(r.recoveryCodes);
      void reload();
    }
  }

  async function turnOff() {
    const ok = await confirm({
      title: "Turn off two-factor sign-in?",
      description: "Removes your authenticator app, security keys and recovery codes.",
      confirmLabel: "Turn off",
      destructive: true,
    });
    if (!ok) return;
    const r = await sensitive("off", () => api("/api/user/mfa", { method: "DELETE" }));
    if (r) {
      toast.success("Two-factor sign-in is off.");
      void reload();
    }
  }

  if (!status) {
    return (
      <Card>
        <CardContent className="flex min-h-32 items-center justify-center pt-6">
          {loadError ? <p className="text-sm text-destructive">{loadError}</p> : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />}
        </CardContent>
      </Card>
    );
  }

  const keys = status.webauthn.credentials;
  const factorCount = (status.totp.enabled ? 1 : 0) + keys.length;
  const lastFactorLocked = status.requireMfa && factorCount <= 1;

  return (
    <Card data-testid="security-settings">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="h-5 w-5" aria-hidden />
          Two-factor sign-in
          {status.enabled ? (
            <Badge variant="success" data-testid="mfa-status">On</Badge>
          ) : (
            <Badge variant="warning" data-testid="mfa-status">Off</Badge>
          )}
          {status.requireMfa && <Badge variant="outline">Required</Badge>}
        </CardTitle>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Require a code or security key after your password.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {status.recovery.low && (
          <p role="status" className="flex items-start gap-2 rounded-md border border-[color:var(--mist-warn)]/40 bg-[color:var(--mist-warn)]/10 p-3 text-[13px] text-[color:var(--mist-warn)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {status.recovery.remaining === 0
              ? "No recovery codes left. Generate new ones."
              : `${status.recovery.remaining} recovery code${status.recovery.remaining === 1 ? "" : "s"} left. Generate new ones.`}
          </p>
        )}

        <Section
          icon={Smartphone}
          title="Authenticator app"
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={status.totp.enabled ? "outline" : "default"} onClick={() => void ensure().then((ok) => ok && setTotpOpen(true))} disabled={!!busy}>
                {status.totp.enabled ? "Replace app" : "Set up authenticator app"}
              </Button>
              {status.totp.enabled && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void removeTotp()}
                  disabled={!!busy || lastFactorLocked}
                  title={lastFactorLocked ? "Add another method first. Your organization requires one." : undefined}
                >
                  {busy === "totp" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                  Remove
                </Button>
              )}
            </div>
          }
        >
          <p className="text-[13px] text-muted-foreground" data-testid="totp-status">
            {status.totp.enabled ? `On since ${formatDate(status.totp.enabledAt)}.` : "Not set up."}
          </p>
        </Section>

        <Section
          icon={Fingerprint}
          title="Security keys and passkeys"
          action={
            <Button size="sm" variant="outline" onClick={() => void ensure().then((ok) => ok && setKeyOpen(true))} disabled={!!busy || !status.webauthn.available}>
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Add security key
            </Button>
          }
        >
          {!status.webauthn.available && status.webauthn.reason && (
            <p role="note" className="flex items-start gap-2 rounded-md border border-[color:var(--mist-warn)]/40 bg-[color:var(--mist-warn)]/10 p-3 text-[12px] text-[color:var(--mist-warn)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {status.webauthn.reason}
            </p>
          )}
          {keys.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No security keys.</p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-lg border border-border/60" data-testid="security-keys">
              {keys.map((k) => (
                <li key={k.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  {renaming?.id === k.id ? (
                    <form
                      className="flex w-full flex-wrap items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveRename();
                      }}
                    >
                      <Input
                        aria-label="Key name"
                        value={renaming.name}
                        maxLength={64}
                        onChange={(e) => setRenaming({ id: k.id, name: e.target.value })}
                        className="h-8 max-w-64"
                        autoFocus
                      />
                      <Button size="sm" type="submit" disabled={busy === `rename:${k.id}`}>
                        Save
                      </Button>
                      <Button size="sm" type="button" variant="ghost" onClick={() => setRenaming(null)}>
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <>
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate text-sm font-medium">
                          {k.name}
                          <Badge variant="secondary" className="text-[10px]">{k.kind === "passkey" ? "Passkey" : "Security key"}</Badge>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Added {formatDate(k.createdAt)} · Last used {formatDate(k.lastUsedAt)}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setRenaming({ id: k.id, name: k.name })} aria-label={`Rename ${k.name}`}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void removeKey(k.id, k.name)}
                          disabled={!!busy || lastFactorLocked}
                          aria-label={`Remove ${k.name}`}
                          title={lastFactorLocked ? "Add another method first. Your organization requires one." : undefined}
                        >
                          {busy === `key:${k.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
                        </Button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          icon={LifeBuoy}
          title="Recovery codes"
          action={
            status.enabled ? (
              <Button size="sm" variant="outline" onClick={() => void regenerate()} disabled={!!busy}>
                {busy === "recovery" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
                Generate new codes
              </Button>
            ) : null
          }
        >
          <p className="text-[13px] text-muted-foreground" data-testid="recovery-status">
            {status.enabled
              ? `${status.recovery.remaining} of ${status.recovery.total} unused.`
              : "Issued when you turn on two-factor sign-in."}
          </p>
        </Section>

        {status.enabled && !status.requireMfa && (
          <div className="border-t border-border/60 pt-4">
            <Button variant="outline" size="sm" className="text-destructive" onClick={() => void turnOff()} disabled={!!busy}>
              <ShieldOff className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Turn off two-factor sign-in
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={totpOpen} onOpenChange={setTotpOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{status.totp.enabled ? "Replace your authenticator app" : "Set up an authenticator app"}</DialogTitle>
            <DialogDescription>Scan the QR code, then enter the code from the app.</DialogDescription>
          </DialogHeader>
          {totpOpen && <TotpSetup ensureReauth={ensure} onEnabled={(c) => afterEnroll(c, "Authenticator app")} onCancel={() => setTotpOpen(false)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={keyOpen} onOpenChange={setKeyOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a security key or passkey</DialogTitle>
            <DialogDescription>Use a hardware key or this device&apos;s passkey.</DialogDescription>
          </DialogHeader>
          {keyOpen && (
            <AddSecurityKey
              ensureReauth={ensure}
              unavailableReason={status.webauthn.available ? null : status.webauthn.reason}
              onAdded={(c) => afterEnroll(c, "Security key")}
              onCancel={() => setKeyOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <RecoveryCodesDialog codes={codes} onClose={() => setCodes(null)} />
      {reauthDialog}
    </Card>
  );
}
