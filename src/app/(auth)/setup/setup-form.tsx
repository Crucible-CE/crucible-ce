"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Loader2, Rocket } from "lucide-react";

export function SetupForm() {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/public/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName, name, email, password, setupCode }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Couldn't finish setup. Try again.");
        setLoading(false);
        return;
      }
      router.push("/login?setup=done");
    } catch {
      setError("Couldn't finish setup. Try again.");
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-8 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <Rocket className="h-5 w-5 text-[color:var(--mist-indigo)]" />
          <h2 className="text-xl font-extrabold tracking-tight">Set up Crucible CE</h2>
        </div>
        <p className="text-[13px] text-muted-foreground">
          Create your organization and admin account.
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
          <Label htmlFor="setupCode">Setup code</Label>
          <Input
            id="setupCode"
            type="text"
            placeholder="XXXX-XXXX-XXXX-XXXX"
            value={setupCode}
            onChange={(e) => setSetupCode(e.target.value)}
            required
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-describedby="setupCode-help"
            className="h-11 rounded-xl font-mono tracking-wider"
          />
          <p id="setupCode-help" className="text-[12px] text-muted-foreground">
            Printed in the server log at startup. Run{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              docker compose logs app | grep &quot;setup code&quot;
            </code>{" "}
            to find it.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="orgName">Organization name</Label>
          <Input
            id="orgName"
            type="text"
            placeholder="Acme Security"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            required
            className="h-11 rounded-xl"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            type="text"
            placeholder="Jane Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
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

        <button
          type="submit"
          disabled={loading}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[color:var(--mist-indigo)] to-[color:var(--mist-indigo-hi)] text-[13px] font-semibold text-white shadow-lg shadow-[color:var(--mist-indigo)]/15 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[color:var(--mist-indigo)]/25 disabled:pointer-events-none disabled:opacity-50"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Create organization
        </button>
      </form>
    </div>
  );
}
