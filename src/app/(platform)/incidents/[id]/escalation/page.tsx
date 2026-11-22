"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Phone, Mail, Siren, Loader2, PhoneCall, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { PageDeliveries } from "@/components/incident/page-deliveries";
import { useIncidentShell } from "@/components/incident/incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

interface Contact {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  alternatePhone: string | null;
  tier: number;
  role: string;
}

interface Member {
  id: string;
  name: string | null;
  email: string;
}

const TIER_LABELS: Record<number, string> = {
  1: "Tier 1 · Primary",
  2: "Tier 2 · Secondary",
  3: "Tier 3 · Escalation",
};

const ROLE_LABELS: Record<string, string> = {
  technical: "Technical",
  executive: "Executive",
  legal: "Legal",
  pr: "PR / Comms",
  vendor: "Vendor",
  regulator: "Regulator",
  other: "Other",
};

export default function IncidentEscalationPage() {
  const { id } = useParams<{ id: string }>();
  // Paging is a write (incidents.edit + lock guard on POST /page): read-only
  // viewers see the call tree and delivery log but no Page buttons.
  const { readOnly } = useIncidentShell();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    const [cRes, mRes] = await Promise.all([
      fetch(`/api/escalation-contacts`),
      fetch(`/api/org-members`),
    ]);
    if (cRes.ok) setContacts(await cRes.json());
    if (mRes.ok) setMembers(await mRes.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const page = async (target: { userId: string } | { contactId: string }, key: string, name: string) => {
    setPaging(key);
    try {
      const res = await fetch(`/api/incidents/${id}/page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      });
      const data = (await res.json().catch(() => ({}))) as {
        deliveries?: { channel: string; status: string }[];
        warning?: string | null;
      };
      if (res.ok) {
        const sent = (data.deliveries ?? []).filter((d) => d.status === "sent").map((d) => d.channel);
        const failed = (data.deliveries ?? []).filter((d) => d.status === "failed").map((d) => d.channel);
        const detail = sent.length ? `Sent by ${[...new Set(sent)].join(", ")}.` : "In-app only.";
        if (data.warning) toast.warning(`Paged ${name} in the app only. No email, SMS or voice channel reached them.`, { description: data.warning, duration: 15_000 });
        else if (failed.length) toast.warning(`Paged ${name}. ${detail} Failed: ${[...new Set(failed)].join(", ")}, retrying.`);
        else toast.success(`Paged ${name}. ${detail}`);
      } else toast.error(apiErrorMessage(data, "Couldn't send page. Try again."));
    } finally {
      setPaging(null);
      setRefreshKey((k) => k + 1);
    }
  };

  const tiers = [1, 2, 3].map((t) => ({ tier: t, items: contacts.filter((c) => c.tier === t) }));

  if (loading) {
    return <div className="h-40 animate-pulse rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-muted)]/30" />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ── Call tree ─────────────────────────────────────────────── */}
      <section className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-[color:var(--mist-indigo)]" />
            <h2 className="text-sm font-semibold">Escalation call tree</h2>
          </div>
          <Link href="/escalation-matrix" className="inline-flex items-center gap-1 text-[11px] text-[color:var(--mist-indigo)] hover:underline">
            Manage <ExternalLink className="h-3 w-3" />
          </Link>
        </div>

        {contacts.length === 0 ? (
          <p className="py-6 text-center text-xs text-[color:var(--color-muted-foreground)]">
            No escalation contacts. Add them in the escalation matrix.
          </p>
        ) : (
          <div className="space-y-3">
            {tiers.map(({ tier, items }) =>
              items.length === 0 ? null : (
                <div key={tier}>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">
                    {TIER_LABELS[tier]}
                  </div>
                  <ul className="space-y-1.5">
                    {items.map((c) => (
                      <li key={c.id} className="rounded-[var(--radius-md)] border border-[color:var(--color-border)] p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-medium">
                              {c.name}
                              {c.title && <span className="text-[color:var(--color-muted-foreground)]"> · {c.title}</span>}
                            </div>
                            <div className="text-[10.5px] uppercase tracking-wide text-[color:var(--color-muted-foreground)]">
                              {ROLE_LABELS[c.role] ?? c.role}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {!readOnly && <button
                              type="button"
                              onClick={() => page({ contactId: c.id }, `c:${c.id}`, c.name)}
                              disabled={paging === `c:${c.id}` || (!c.phone && !c.email)}
                              title={c.phone || c.email ? "Page this contact" : "No phone or email"}
                              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[color:var(--mist-danger)] px-2 py-0.5 text-[10.5px] font-semibold text-[color:var(--mist-danger)] disabled:opacity-50"
                            >
                              {paging === `c:${c.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Siren className="h-3 w-3" />}
                              Page
                            </button>}
                            {c.phone && (
                              <a href={`tel:${c.phone}`} title={c.phone} aria-label={`Call ${c.name}`} className="text-[color:var(--mist-indigo)]">
                                <PhoneCall className="h-3.5 w-3.5" />
                              </a>
                            )}
                            {c.email && (
                              <a href={`mailto:${c.email}`} title={c.email} aria-label={`Email ${c.name}`} className="text-[color:var(--mist-indigo)]">
                                <Mail className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}
          </div>
        )}
      </section>

      {/* ── Page responders ──────────────────────────────────────── */}
      <section className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
        <div className="mb-1 flex items-center gap-2">
          <Siren className="h-4 w-4 text-[color:var(--mist-danger)]" />
          <h2 className="text-sm font-semibold">Page responders</h2>
        </div>
        {readOnly && (
          <p className="mb-3 rounded-[var(--radius-md)] border border-[color:var(--color-border)] px-2.5 py-2 text-[11px] text-[color:var(--color-muted-foreground)]">
            Read-only. You can see pages but not send them.
          </p>
        )}
        <p className="mb-3 text-[11px] text-[color:var(--color-muted-foreground)]">
          Pages go to the app and every configured channel. Unacknowledged pages escalate.
        </p>

        {members.length === 0 ? (
          <p className="py-6 text-center text-xs text-[color:var(--color-muted-foreground)]">No members.</p>
        ) : (
          <ul className="space-y-1.5">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] p-2">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{m.name ?? m.email}</div>
                  <div className="truncate text-[10.5px] text-[color:var(--color-muted-foreground)]">{m.email}</div>
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => page({ userId: m.id }, m.id, m.name ?? m.email)}
                    disabled={paging === m.id}
                    className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] bg-[color:var(--mist-danger)] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
                  >
                    {paging === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Siren className="h-3 w-3" />}
                    Page
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <PageDeliveries incidentId={id} refreshKey={refreshKey} />
    </div>
  );
}
