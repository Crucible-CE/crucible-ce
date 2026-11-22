"use client";

import { Suspense, useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { MfaStep, type PendingFactors } from "./mfa-step";

// useSearchParams() must live inside a Suspense boundary in Next 15 to avoid
// opting the entire route into client-side-only rendering.
function LoginRedirectParams({
  onResolve,
}: {
  onResolve: (from: string, verified: boolean) => void;
}) {
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "/dashboard";
  const verified = searchParams.get("verified") === "true";
  useEffect(() => {
    // Only accept same-origin relative paths as redirect targets to avoid
    // open-redirect abuse via ?from=https://evil.example.
    const safeFrom = from.startsWith("/") && !from.startsWith("//") ? from : "/dashboard";
    onResolve(safeFrom, verified);
  }, [from, verified, onResolve]);
  return null;
}

export default function LoginPage() {
  const router = useRouter();
  const { status } = useSession();

  const [from, setFrom] = useState("/dashboard");
  const [verifiedBanner, setVerifiedBanner] = useState(false);

  // Client-side redirect for already-authenticated users. When useSession()
  // calls /api/auth/session, the full JWT callback runs — if the cookie is
  // stale (deleted user, revoked token), NextAuth returns null and status
  // becomes "unauthenticated", showing the form.
  // A fresh install has no accounts to sign in with: send anyone who lands
  // on /login directly (bookmark, typed URL) to the first-run wizard.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/setup")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { needsSetup?: boolean } | null) => {
        if (!cancelled && data?.needsSetup) router.replace("/setup");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [router]);



  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [loading, setLoading] = useState(false);
  // Second step (two-factor): set when the password was accepted for an
  // account with MFA; no session exists until the factor is verified.
  const [mfa, setMfa] = useState<PendingFactors | null>(null);

  // The two-factor step navigates on its own once it completes.
  useEffect(() => {
    if (status === "authenticated" && !mfa) {
      router.replace(from);
    }
  }, [status, from, router, mfa]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setUnverified(null);
    setResent(false);
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      // NextAuth surfaces custom CredentialsSignin subclasses via `code`.
      const code = (result as { code?: string }).code;
      if (code === "email_not_verified") {
        setUnverified(email);
      } else if (code === "mfa_required") {
        const pending = (await fetch("/api/public/mfa/pending")
          .then((r) => r.json())
          .catch(() => null)) as { pending?: boolean; factors?: PendingFactors } | null;
        if (pending?.pending && pending.factors) {
          setPassword("");
          setMfa(pending.factors);
        } else {
          setError("Couldn't sign in. Try again.");
        }
      } else {
        setError("Invalid email or password");
      }
      setLoading(false);
      return;
    }

    router.push(from);
    router.refresh();
  }

  async function handleMfaSuccess(method: "totp" | "recovery" | "webauthn") {
    // A recovery code just got spent: when few are left, land on Settings >
    // Security, which explains how to generate a new set.
    if (method === "recovery") {
      const status = (await fetch("/api/user/mfa")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)) as { recovery?: { low?: boolean } } | null;
      if (status?.recovery?.low) {
        router.push("/settings?tab=security");
        router.refresh();
        return;
      }
    }
    router.push(from);
    router.refresh();
  }

  async function handleResend() {
    if (!unverified) return;
    setResending(true);
    try {
      const res = await fetch("/api/public/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: unverified, honeypot: "" }),
      });
      if (res.ok) {
        setResent(true);
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Couldn't resend the email. Try again.");
      }
    } catch {
      setError("Couldn't resend the email. Try again.");
    } finally {
      setResending(false);
    }
  }

  // Only hide the form while NextAuth is still determining session status.
  // If the router.replace() navigation stalls we don't want to block the
  // user on a spinner forever — show the form as soon as we know they are
  // not authenticated.
  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-8 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <Suspense fallback={null}>
        <LoginRedirectParams
          onResolve={(f, v) => {
            setFrom(f);
            setVerifiedBanner(v);
          }}
        />
      </Suspense>

      {mfa ? (
        <MfaStep
          factors={mfa}
          onSuccess={(m) => void handleMfaSuccess(m)}
          onExpired={() => {
            setMfa(null);
            setError("Sign-in expired. Enter your password again.");
          }}
          onBack={() => {
            setMfa(null);
            setError(null);
          }}
        />
      ) : (
      <>
      <div className="mb-6">
        <h2 className="text-xl font-extrabold tracking-tight">Sign in</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {verifiedBanner && !unverified && !error && (
          <div className="flex items-center gap-2 rounded-xl border border-green-500/40 bg-green-500/10 px-3 py-2.5 text-sm text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Email verified. You can sign in now.
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {unverified && (
          <div className="space-y-2 rounded-xl border border-[color:var(--mist-warn)]/40 bg-[color:var(--mist-warn)]/10 px-3 py-2.5 text-sm text-[color:var(--mist-warn)]">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1">
                <p>Verify your email before signing in.</p>
                {resent ? (
                  <p className="mt-1 text-[12px] text-[color:var(--mist-warn)]/80">
                    Sent to {unverified}.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resending}
                    className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-[color:var(--mist-warn)] underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
                  >
                    {resending && <Loader2 className="h-3 w-3 animate-spin" />}
                    Resend email
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
            className="h-11 rounded-xl"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="h-11 rounded-xl"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[color:var(--mist-indigo)] to-[color:var(--mist-indigo-hi)] text-[13px] font-semibold text-white shadow-lg shadow-[color:var(--mist-indigo)]/15 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[color:var(--mist-indigo)]/25 disabled:pointer-events-none disabled:opacity-50"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign in
        </button>

        <div className="space-y-2 text-center text-[13px] text-muted-foreground">
          <p>
            <Link href="/forgot-password" className="font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          </p>
        </div>
      </form>
      </>
      )}
    </div>
  );
}
