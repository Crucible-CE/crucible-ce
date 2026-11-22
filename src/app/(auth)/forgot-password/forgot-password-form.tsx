"use client";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, Loader2, MailX } from "lucide-react";

/** Shown instead of the form when the server can't send email. */
export function NoEmailNotice({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-8 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className="flex flex-col items-center gap-4 text-center">
        <MailX className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-xl font-extrabold tracking-tight">Reset password</h2>
        <p className="text-[13px] text-muted-foreground" data-testid="no-email-notice">
          {message}
        </p>
        <Link
          href="/login"
          className="mt-4 text-[13px] font-medium text-primary hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [noEmail, setNoEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/public/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; message?: string; emailConfigured?: boolean }
        | null;

      if (!res.ok) {
        setError(data?.error ?? "Couldn't send the link. Try again.");
        setLoading(false);
        return;
      }
      // Email was turned off after this page loaded: nothing was sent.
      if (data?.emailConfigured === false) {
        setNoEmail(data.message ?? "Email isn't set up on this server.");
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Couldn't send the link. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (noEmail) return <NoEmailNotice message={noEmail} />;

  if (submitted) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/70 p-8 shadow-2xl shadow-black/30 backdrop-blur-xl">
        <div className="flex flex-col items-center gap-4 text-center">
          <CheckCircle2 className="h-10 w-10 text-green-500" />
          <h2 className="text-xl font-extrabold tracking-tight">Check your email</h2>
          <p className="text-[13px] text-muted-foreground">
            If that email has an account, a reset link is on its way.
          </p>
          <Link
            href="/login"
            className="mt-4 text-[13px] font-medium text-primary hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-8 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className="mb-6">
        <h2 className="text-xl font-extrabold tracking-tight">Reset password</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          We&apos;ll email you a reset link.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
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

        <button
          type="submit"
          disabled={loading}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[color:var(--mist-indigo)] to-[color:var(--mist-indigo-hi)] text-[13px] font-semibold text-white shadow-lg shadow-[color:var(--mist-indigo)]/15 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[color:var(--mist-indigo)]/25 disabled:pointer-events-none disabled:opacity-50"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Send reset link
        </button>

        <p className="text-center text-[13px] text-muted-foreground">
          <Link href="/login" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
