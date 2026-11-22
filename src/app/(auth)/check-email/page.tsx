"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, MailCheck } from "lucide-react";

export default function CheckEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <CheckEmailContent />
    </Suspense>
  );
}

function CheckEmailContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";

  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState("");

  async function handleResend() {
    if (!email) {
      setError("No email address. Go back to sign in.");
      return;
    }
    setError(null);
    setResending(true);
    try {
      const res = await fetch("/api/public/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, honeypot }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Couldn't resend the email. Try again.");
        return;
      }
      setResent(true);
    } catch {
      setError("Couldn't resend the email. Try again.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-8 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className="flex flex-col items-center gap-4 text-center">
        <MailCheck className="h-10 w-10 text-[color:var(--mist-indigo)]" />
        <h2 className="text-xl font-extrabold tracking-tight">Check your email</h2>
        <p className="text-[13px] text-muted-foreground">
          {email ? (
            <>
              We sent a verification link to{" "}
              <strong className="text-foreground">{email}</strong>.
            </>
          ) : (
            <>We sent you a verification link.</>
          )}
        </p>
        <p className="text-[12px] text-muted-foreground">
          The link expires in 24 hours.
        </p>
      </div>

      <div className="mt-6 space-y-3">
        {resent && (
          <div className="flex items-center gap-2 rounded-xl border border-green-500/40 bg-green-500/10 px-3 py-2.5 text-sm text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Email sent.
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Honeypot */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "-10000px",
            top: "auto",
            width: "1px",
            height: "1px",
            overflow: "hidden",
          }}
        >
          <label htmlFor="website_url">Website</label>
          <input
            id="website_url"
            name="website_url"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </div>

        {!resent && (
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border/60 bg-card/60 text-[13px] font-semibold text-foreground transition-colors hover:bg-card disabled:pointer-events-none disabled:opacity-50"
          >
            {resending && <Loader2 className="h-4 w-4 animate-spin" />}
            Resend email
          </button>
        )}

        <p className="text-center text-[13px] text-muted-foreground">
          <Link href="/login" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
