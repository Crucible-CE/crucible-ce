"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Loader2, MailQuestion } from "lucide-react";

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgInviteToken = searchParams.get("orgInvite");
  const hasInvite = Boolean(orgInviteToken);

  // Admin-generated org invite (stateful, 3-part token).
  const orgInviteInfo = (() => {
    if (!orgInviteToken) return null;
    try {
      const parts = orgInviteToken.split(".");
      if (parts.length !== 3) return null;
      const payload = JSON.parse(
        atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
      );
      if (payload.expiresAt && payload.expiresAt < Date.now()) return null;
      return {
        orgSlug: payload.orgSlug as string,
        role: payload.role as string,
      };
    } catch {
      return null;
    }
  })();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // CE registration is invite-only: members join via an admin-minted invite
  // link. Without a token there is nothing to submit.
  if (!hasInvite) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/70 p-8 shadow-2xl shadow-black/30 backdrop-blur-xl">
        <div className="mb-4 flex items-center gap-2">
          <MailQuestion className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-extrabold tracking-tight">Invite required</h2>
        </div>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Ask your admin for an invite link.
        </p>
        <p className="mt-4 text-center text-[13px] text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    setLoading(true);

    try {
      const body: Record<string, string | boolean> = {
        name,
        email,
        password,
        honeypot,
      };
      if (orgInviteToken) body.orgInviteToken = orgInviteToken;

      const res = await fetch("/api/public/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.error ?? "Couldn't create your account. Try again.");
        setLoading(false);
        return;
      }

      // Do NOT auto-sign-in. Send user to check-email so they verify first —
      // unless the invite waived verification, in which case they can log in
      // immediately.
      if (data?.emailVerificationRequired === false) {
        router.push("/login?verified=true");
      } else {
        router.push(`/check-email?email=${encodeURIComponent(email)}`);
      }
    } catch {
      setError("Couldn't create your account. Try again.");
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-8 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className="mb-6">
        <h2 className="text-xl font-extrabold tracking-tight">Create account</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {orgInviteInfo ? (
            <>
              Join{" "}
              <strong className="text-foreground">{orgInviteInfo.orgSlug}</strong>
              {orgInviteInfo.role ? ` as ${orgInviteInfo.role}` : null}
            </>
          ) : (
            "Join this organization."
          )}
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
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            type="text"
            placeholder="Jane Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            className="h-11 rounded-xl"
          />
        </div>

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
            className="h-11 rounded-xl"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            className="h-11 rounded-xl"
          />
        </div>

        {/* Honeypot — hidden from humans, filled by bots. */}
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
          <label htmlFor="company_website">Website</label>
          <input
            id="company_website"
            name="company_website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[color:var(--mist-indigo)] to-[color:var(--mist-indigo-hi)] text-[13px] font-semibold text-white shadow-lg shadow-[color:var(--mist-indigo)]/15 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[color:var(--mist-indigo)]/25 disabled:pointer-events-none disabled:opacity-50"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Join organization
        </button>

        <div className="space-y-2 text-center text-[13px] text-muted-foreground">
          <p>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
          <p>
            <Link href="/forgot-password" className="font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
