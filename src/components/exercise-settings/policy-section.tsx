"use client";

// Exercise policy: how often each enabled framework needs an exercise, the
// roles every exercise should have in the room, the confidentiality marking
// for report headers and the email domains reminders may go to. Feeds the
// program report and Appendix C of the after-action report. Also lists the
// signing keys (current and past) with public key downloads.

import { useEffect, useState } from "react";
import { Download, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Loaded {
  cadence: Record<string, number>;
  requiredRoles: string[];
  confidentialityMarking?: string;
  reminderDomains?: string[];
  defaults: Record<string, number>;
}

interface KeyList {
  current: string | null;
  keys: Array<{ keyId: string; createdAt: string; retiredAt: string | null; current: boolean }>;
}

/** Signing key IDs with public key downloads. Third parties pin evidence bundles to these. */
export function SigningKeysSection() {
  const [data, setData] = useState<KeyList | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings/signing-keys", { cache: "no-store" });
        const body = (await res.json()) as KeyList & { error?: string };
        if (!res.ok) setError(body.error ?? "The signing keys did not load.");
        else setData(body);
      } catch {
        setError("The signing keys did not load. Check your connection and reload.");
      }
    })();
  }, []);
  return (
    <Card className="h-fit" data-testid="signing-keys">
      <div className="space-y-3">
        <h2 className="text-base font-semibold">Signing keys</h2>
        <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">Give these key IDs or public keys to anyone who checks an evidence bundle.</p>
        {error && <p role="alert" className="text-[13px] text-[color:var(--mist-danger)]">{error}</p>}
        {data && data.keys.length === 0 && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No signing key is set. Set EXPORT_SIGNING_PRIVATE_KEY on the server to sign reports.</p>}
        {data && data.keys.length > 0 && (
          <ul className="space-y-1.5">
            {data.keys.map((k) => (
              <li key={k.keyId} className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-mono">{k.keyId}</span>
                <span className="text-[color:var(--color-muted-foreground)]">
                  {k.current ? "Current" : k.retiredAt ? `Retired ${k.retiredAt.slice(0, 10)}` : "Past"}, added {k.createdAt.slice(0, 10)}
                </span>
                <a
                  href={`/api/settings/signing-keys?keyId=${k.keyId}&format=pem`}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-medium hover:bg-[color:var(--color-muted)]"
                >
                  <Download className="h-3.5 w-3.5" />
                  Public key
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function PolicySection({ frameworks }: { frameworks: Array<{ key: string; label: string }> }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [cadence, setCadence] = useState<Record<string, string>>({});
  const [roles, setRoles] = useState<string[]>([]);
  const [newRole, setNewRole] = useState("");
  const [marking, setMarking] = useState("");
  const [domains, setDomains] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings/policy", { cache: "no-store" });
        const body = (await res.json()) as Loaded & { error?: string };
        if (!res.ok) {
          setError(body.error ?? "The policy did not load. Reload the page.");
          return;
        }
        setData(body);
        setCadence(Object.fromEntries(Object.entries(body.cadence).map(([k, v]) => [k, String(v)])));
        setRoles(body.requiredRoles);
        setMarking(body.confidentialityMarking ?? "");
        setDomains((body.reminderDomains ?? []).join(", "));
      } catch {
        setError("The policy did not load. Check your connection and reload.");
      }
    })();
  }, []);

  function addRole() {
    const r = newRole.trim();
    if (!r || roles.some((x) => x.toLowerCase() === r.toLowerCase())) return;
    setRoles([...roles, r]);
    setNewRole("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(cadence)) {
      if (!v.trim()) continue;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 60) {
        setError("Use whole months from 1 to 60.");
        return;
      }
      out[k] = n;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cadence: out,
          requiredRoles: roles,
          confidentialityMarking: marking.trim(),
          reminderDomains: domains
            .split(/[\s,]+/)
            .map((x) => x.trim())
            .filter(Boolean),
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; details?: { fieldErrors?: Record<string, string[]> } } | null;
      if (!res.ok) {
        const field = body?.details?.fieldErrors ? Object.values(body.details.fieldErrors).flat()[0] : undefined;
        setError(field ?? body?.error ?? "The policy was not saved. Try again.");
        return;
      }
      toast.success("Policy saved.");
    } catch {
      setError("The policy was not saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <Card className="h-fit">
      <form onSubmit={save} className="space-y-5">
        <h2 className="text-base font-semibold">Exercise policy</h2>
        {!data && !error && <Loader2 className="h-5 w-5 animate-spin text-[color:var(--color-muted-foreground)]" />}
        {data && (
          <>
            <section className="space-y-3">
              <h3 className="text-[13px] font-semibold">Cadence in months</h3>
              {frameworks.length === 0 ? (
                <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">Enable a control framework above first.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {frameworks.map((f) => (
                    <div key={f.key} className="space-y-1">
                      <Label htmlFor={`cad-${f.key}`}>{f.label}</Label>
                      <Input
                        id={`cad-${f.key}`}
                        type="number"
                        min={1}
                        max={60}
                        inputMode="numeric"
                        value={cadence[f.key] ?? ""}
                        placeholder={data.defaults[f.key] ? `Default ${data.defaults[f.key]}` : "No cadence"}
                        onChange={(e) => setCadence({ ...cadence, [f.key]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="space-y-2">
              <h3 className="text-[13px] font-semibold">Required roles</h3>
              <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">Roles every exercise should include, such as Legal or Communications.</p>
              <ul className="flex flex-wrap gap-1.5">
                {roles.map((r) => (
                  <li key={r} className="inline-flex items-center gap-1 rounded-md bg-[color:var(--color-muted)] py-1 pl-2.5 pr-1 text-[12.5px]">
                    {r}
                    <button type="button" aria-label={`Remove ${r}`} onClick={() => setRoles(roles.filter((x) => x !== r))} className="rounded p-0.5 hover:bg-[color:var(--mist-paper-2)]">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Input
                  aria-label="New role"
                  value={newRole}
                  maxLength={80}
                  onChange={(e) => setNewRole(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addRole();
                    }
                  }}
                  placeholder="Role"
                />
                <Button type="button" variant="outline" onClick={addRole} disabled={!newRole.trim() || roles.length >= 20}>
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </div>
            </section>
            <section className="space-y-2">
              <Label htmlFor="policy-marking">Confidentiality marking</Label>
              <Input id="policy-marking" value={marking} maxLength={120} onChange={(e) => setMarking(e.target.value)} placeholder="For example Confidential" />
              <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">Printed in the header of report PDFs and Word files. Leave empty for none.</p>
            </section>
            <section className="space-y-2">
              <Label htmlFor="policy-domains">Reminder email domains</Label>
              <Input id="policy-domains" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="example.com, partner.example" />
              <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">Action owner reminders go only to these domains.</p>
            </section>
          </>
        )}
        {error && (
          <p role="alert" className="text-[13px] text-[color:var(--mist-danger)]">
            {error}
          </p>
        )}
        {data && (
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save policy
            </Button>
          </div>
        )}
      </form>
    </Card>
    <SigningKeysSection />
    </>
  );
}
