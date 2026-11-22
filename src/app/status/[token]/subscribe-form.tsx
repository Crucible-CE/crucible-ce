"use client";

import { useState } from "react";

export function StatusSubscribeForm({ token }: { token: string }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/public/status/${token}/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage(typeof d.message === "string" ? d.message : "Check your inbox to confirm.");
        setEmail("");
      } else setMessage(typeof d.error === "string" ? d.error : "Something went wrong. Try again.");
    } catch {
      setMessage("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap gap-2">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        aria-label="Email"
        className="h-10 min-w-56 flex-1 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-sm"
      />
      <button
        type="submit"
        disabled={busy}
        className="h-10 rounded-md bg-[color:var(--color-primary)] px-4 text-sm font-semibold text-[color:var(--color-primary-foreground)] disabled:opacity-50"
      >
        Subscribe
      </button>
      {message && <p className="w-full text-[12px] text-[color:var(--color-muted-foreground)]" role="status">{message}</p>}
    </form>
  );
}
