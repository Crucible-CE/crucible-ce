"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Fingerprint, Loader2, LogOut, ShieldCheck, Smartphone } from "lucide-react";
import { signOutAndRedirect } from "@/lib/auth/sign-out-client";
import { fetchMfaStatus, type MfaStatus } from "@/components/security/mfa-api";
import { useReauth } from "@/components/security/reauth-dialog";
import { TotpSetup } from "@/components/security/totp-setup";
import { AddSecurityKey } from "@/components/security/add-security-key";
import { RecoveryCodesDialog } from "@/components/security/recovery-codes";

// Require-MFA funnel. While the org requires two-factor sign-in and this
// member has no factor, middleware and the platform layout send every page
// here. Enrolling (authenticator app or security key) refreshes the session
// claim and continues to the dashboard.

export const dynamic = "force-dynamic";

export default function MfaSetupRequiredPage() {
  const router = useRouter();
  const { data: session, status: sessionStatus, update } = useSession();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [method, setMethod] = useState<null | "totp" | "key">(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [leaving, setLeaving] = useState(false);

  const { ensure, dialog } = useReauth(status);

  const proceed = useCallback(async () => {
    setLeaving(true);
    await update();
    router.replace("/dashboard");
    router.refresh();
  }, [router, update]);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    void fetchMfaStatus()
      .then((s) => {
        setStatus(s);
        // Already enrolled (another tab) or no longer required: move on.
        if (s.enabled || !s.requireMfa) void proceed();
      })
      .catch(() => setStatus(null));
  }, [sessionStatus, proceed]);

  useEffect(() => {
    if (sessionStatus === "unauthenticated") router.replace("/login");
  }, [sessionStatus, router]);

  function enrolled(recoveryCodes: string[] | null) {
    setMethod(null);
    if (recoveryCodes) setCodes(recoveryCodes);
    else void proceed();
  }

  if (sessionStatus !== "authenticated" || !status || leaving) {
    return (
      <div className="relative flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-br from-orange-500/8 via-emerald-500/5 to-transparent blur-3xl" />
      </div>

      <div className="relative z-10 mb-8 flex items-center justify-center">
        <Image src="/branding/logos/mark.svg" alt="Crucible CE" width={32} height={32} priority unoptimized className="h-16 w-16" />
      </div>

      <main className="relative z-10 w-full max-w-lg rounded-2xl border border-border/60 bg-card/70 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8" data-testid="mfa-funnel">
        <div className="mb-5 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--mist-indigo)]/10 text-[color:var(--mist-indigo)]">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">Turn on two-factor sign-in</h1>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Your organization requires it. Set it up to continue.
            </p>
          </div>
        </div>

        {session?.user?.email && (
          <div className="mb-5 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{session.user.email}</span>
          </div>
        )}

        {method === null && (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void ensure().then((ok) => ok && setMethod("totp"))}
              className="flex flex-col items-start gap-1.5 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-[color:var(--mist-indigo)]/60 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Smartphone className="h-5 w-5 text-[color:var(--mist-indigo)]" aria-hidden />
              <span className="text-sm font-semibold">Authenticator app</span>
              <span className="text-[12px] text-muted-foreground">Scan a QR code.</span>
            </button>
            <button
              type="button"
              onClick={() => void ensure().then((ok) => ok && setMethod("key"))}
              disabled={!status.webauthn.available}
              className="flex flex-col items-start gap-1.5 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-[color:var(--mist-indigo)]/60 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Fingerprint className="h-5 w-5 text-[color:var(--mist-indigo)]" aria-hidden />
              <span className="text-sm font-semibold">Security key or passkey</span>
              <span className="text-[12px] text-muted-foreground">
                {status.webauthn.available ? "Hardware key or device passkey." : status.webauthn.reason}
              </span>
            </button>
          </div>
        )}

        {method === "totp" && <TotpSetup ensureReauth={ensure} onEnabled={enrolled} onCancel={() => setMethod(null)} />}
        {method === "key" && (
          <AddSecurityKey
            ensureReauth={ensure}
            unavailableReason={status.webauthn.available ? null : status.webauthn.reason}
            onAdded={enrolled}
            onCancel={() => setMethod(null)}
          />
        )}

        <div className="mt-6 flex items-center justify-between border-t border-border/60 pt-4">
          <button onClick={() => void signOutAndRedirect()} className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground">
            <LogOut className="h-3 w-3" aria-hidden />
            Sign out
          </button>
          <span className="text-[11px] text-muted-foreground">Lost access? An administrator can help.</span>
        </div>
      </main>

      <RecoveryCodesDialog
        codes={codes}
        onClose={() => {
          setCodes(null);
          void proceed();
        }}
      />
      {dialog}
      <span className="sr-only" aria-live="polite">
        {codes ? "Two-factor sign-in is on. Save your recovery codes." : ""}
      </span>
    </div>
  );
}
