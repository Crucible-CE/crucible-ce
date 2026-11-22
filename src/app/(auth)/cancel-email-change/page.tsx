"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Loader2,
  ShieldAlert,
  XCircle,
} from "lucide-react";

export default function CancelEmailChangePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <CancelEmailChangeContent />
    </Suspense>
  );
}

function CancelEmailChangeContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const status = searchParams.get("status");

  const [phase] = useState<"working" | "done">(
    status ? "done" : "working"
  );

  useEffect(() => {
    if (phase !== "working") return;
    if (!token) {
      window.location.replace("/cancel-email-change?status=invalid");
      return;
    }
    // Bounce to the API route, which does the work and redirects back with
    // ?status=success|expired|invalid|conflict|error
    window.location.replace(
      `/api/public/email-change-cancel?token=${encodeURIComponent(token)}`
    );
  }, [phase, token]);

  if (phase === "working") {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/70 p-8 shadow-2xl shadow-black/30 backdrop-blur-xl">
        <div className="flex flex-col items-center gap-4 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[color:var(--mist-indigo)]" />
          <p className="text-sm text-muted-foreground">
            Cancelling email change…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-8 shadow-2xl shadow-black/30 backdrop-blur-xl">
      {status === "success" && (
        <div className="flex flex-col items-center gap-4 text-center">
          <CheckCircle2 className="h-10 w-10 text-green-700 dark:text-green-400" />
          <h2 className="text-xl font-extrabold tracking-tight">
            Email change cancelled
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Your original email is restored and other sessions are signed out.
          </p>
          <p className="text-[13px] text-[color:var(--mist-warn)]">
            Change your password now.
          </p>
          <Link
            href="/login"
            className="mt-2 inline-flex h-11 items-center justify-center rounded-xl bg-[color:var(--mist-indigo)] px-5 text-[13px] font-semibold text-white hover:bg-[color:var(--mist-indigo)]"
          >
            Sign in
          </Link>
        </div>
      )}

      {status === "expired" && (
        <div className="flex flex-col items-center gap-4 text-center">
          <ShieldAlert className="h-10 w-10 text-[color:var(--mist-warn)]" />
          <h2 className="text-xl font-extrabold tracking-tight">Link expired</h2>
          <p className="text-[13px] text-muted-foreground">
            This link is more than 7 days old. Contact your admin to recover
            the account.
          </p>
        </div>
      )}

      {status === "invalid" && (
        <div className="flex flex-col items-center gap-4 text-center">
          <XCircle className="h-10 w-10 text-destructive" />
          <h2 className="text-xl font-extrabold tracking-tight">Invalid link</h2>
          <p className="text-[13px] text-muted-foreground">
            This link was already used or the change was already confirmed.
          </p>
        </div>
      )}

      {status === "conflict" && (
        <div className="flex flex-col items-center gap-4 text-center">
          <ShieldAlert className="h-10 w-10 text-[color:var(--mist-warn)]" />
          <h2 className="text-xl font-extrabold tracking-tight">
            Couldn&apos;t restore your email
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Another account now uses the original email. Contact your admin.
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-col items-center gap-4 text-center">
          <XCircle className="h-10 w-10 text-destructive" />
          <h2 className="text-xl font-extrabold tracking-tight">
            Couldn&apos;t cancel the change
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Open the link again in a moment.
          </p>
        </div>
      )}

      {!["success", "expired", "invalid", "conflict", "error"].includes(
        status ?? ""
      ) && (
        <div className="flex flex-col items-center gap-4 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[color:var(--mist-indigo)]" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      )}
    </div>
  );
}
