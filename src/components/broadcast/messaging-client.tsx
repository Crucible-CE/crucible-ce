"use client";

// Messaging: compose a broadcast (who, which channels, what), then follow its
// delivery and acknowledgements. Delivery runs on the server; an open
// broadcast refreshes every 5 seconds.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, ChevronDown, ChevronRight, Mail, MessageSquare, Phone, Send, Webhook } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Channel = "app" | "email" | "sms" | "voice" | "webhook";
const CHANNELS: { key: Channel; label: string; icon: typeof Bell }[] = [
  { key: "app", label: "In app", icon: Bell },
  { key: "email", label: "Email", icon: Mail },
  { key: "sms", label: "SMS", icon: MessageSquare },
  { key: "voice", label: "Voice call", icon: Phone },
  { key: "webhook", label: "Webhooks and plugins", icon: Webhook },
];
const ROLES = [
  { key: "administrator", label: "Administrators" },
  { key: "contributor", label: "Contributors" },
  { key: "reader", label: "Readers" },
] as const;
const CONTACT_ROLES: Record<string, string> = {
  technical: "Technical",
  executive: "Executive",
  legal: "Legal / Counsel",
  pr: "Communications / PR",
  vendor: "Vendor / MSSP",
  regulator: "Regulator",
  other: "Other",
};
const TIERS = [1, 2, 3];

interface Member { id: string; name: string | null; email: string }
interface Contact { id: string; name: string; title: string | null; tier: number; role: string }
interface Audience {
  allMembers: boolean;
  roles: string[];
  userIds: string[];
  allContacts: boolean;
  contactTiers: number[];
  contactRoles: string[];
  contactIds: string[];
}
type ChannelSummary = Record<string, { sent: number; failed: number; skipped: number; pending: number }>;
interface BroadcastRow {
  id: string;
  title: string;
  message: string;
  channels: Channel[];
  createdByName: string | null;
  createdAt: string;
  recipientCount: number;
  ackedCount: number;
  channelSummary: ChannelSummary;
}
interface Delivery { channel: string; provider: string; status: string; error: string | null; destination: string | null }
interface RecipientRow { id: string; name: string; acknowledgedAt: string | null; acknowledgedVia: string | null; deliveries: Delivery[] }

const EMPTY: Audience = { allMembers: false, roles: [], userIds: [], allContacts: false, contactTiers: [], contactRoles: [], contactIds: [] };

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function compact(a: Audience) {
  return {
    ...(a.allMembers ? { allMembers: true } : {}),
    ...(a.roles.length ? { roles: a.roles } : {}),
    ...(a.userIds.length ? { userIds: a.userIds } : {}),
    ...(a.allContacts ? { allContacts: true } : {}),
    ...(a.contactTiers.length ? { contactTiers: a.contactTiers } : {}),
    ...(a.contactRoles.length ? { contactRoles: a.contactRoles } : {}),
    ...(a.contactIds.length ? { contactIds: a.contactIds } : {}),
  };
}

const STATUS_STYLE: Record<string, string> = {
  sent: "text-[color:var(--mist-ok)]",
  failed: "text-[color:var(--mist-danger)]",
  skipped: "text-[color:var(--color-muted-foreground)]",
  pending: "text-[color:var(--mist-warn)]",
};

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[12px]",
        on ? "border-[color:var(--mist-indigo)] bg-[color:var(--mist-indigo)]/10 text-[color:var(--mist-indigo)]" : "border-[color:var(--color-border)] hover:bg-[color:var(--color-muted)]",
      )}
    >
      {children}
    </button>
  );
}

export function MessagingClient() {
  const confirm = useConfirm();
  const [members, setMembers] = useState<Member[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [audience, setAudience] = useState<Audience>(EMPTY);
  const [channels, setChannels] = useState<Channel[]>(["app", "email"]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<{ recipients: number; withEmail: number; withPhone: number; withApp: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [rows, setRows] = useState<BroadcastRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RecipientRow[] | null>(null);

  const loadList = useCallback(async () => {
    const res = await fetch("/api/broadcasts", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setRows((await res.json()).broadcasts ?? []);
  }, []);

  useEffect(() => {
    void loadList();
    void (async () => {
      const [m, c] = await Promise.all([fetch("/api/org-members").catch(() => null), fetch("/api/escalation-contacts").catch(() => null)]);
      if (m?.ok) setMembers(await m.json());
      if (c?.ok) setContacts(await c.json());
    })();
  }, [loadList]);

  const body = useMemo(() => compact(audience), [audience]);
  const hasAudience = Object.keys(body).length > 0;

  // Recipient count preview (debounced).
  useEffect(() => {
    if (!hasAudience) {
      setPreview(null);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch("/api/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "preview", message: "preview", channels: ["app"], audience: body, preview: true }),
      }).catch(() => null);
      if (res?.ok) setPreview(await res.json());
    }, 300);
    return () => clearTimeout(t);
  }, [body, hasAudience]);

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/broadcasts/${id}`, { cache: "no-store" }).catch(() => null);
    if (res?.ok) setDetail((await res.json()).broadcast.recipients ?? []);
  }, []);

  useEffect(() => {
    if (!openId) return;
    void loadDetail(openId);
    const t = setInterval(() => {
      void loadDetail(openId);
      void loadList();
    }, 5_000);
    return () => clearInterval(t);
  }, [openId, loadDetail, loadList]);

  const send = async () => {
    if (!title.trim() || !message.trim() || !hasAudience || channels.length === 0) return;
    const n = preview?.recipients ?? 0;
    const ok = await confirm({ title: `Send to ${n} ${n === 1 ? "person" : "people"}?`, description: "Messages go out right away.", confirmLabel: "Send" });
    if (!ok) return;
    setSending(true);
    try {
      const res = await fetch("/api/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), message: message.trim(), channels, audience: body }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof d.error === "string" ? d.error : "Couldn't send. Try again.");
        return;
      }
      toast.success("Broadcast sent");
      setTitle("");
      setMessage("");
      setAudience(EMPTY);
      setOpenId(d.id);
      void loadList();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="space-y-4 rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4" aria-label="New broadcast">
        <h2 className="text-sm font-semibold">New broadcast</h2>

        <div className="space-y-2">
          <p className="text-[12px] font-medium">Members</p>
          <div className="flex flex-wrap gap-1.5">
            <Chip on={audience.allMembers} onClick={() => setAudience({ ...audience, allMembers: !audience.allMembers })}>All members</Chip>
            {ROLES.map((r) => (
              <Chip key={r.key} on={audience.roles.includes(r.key)} onClick={() => setAudience({ ...audience, roles: toggle(audience.roles, r.key) })}>
                {r.label}
              </Chip>
            ))}
          </div>
          {members.length > 0 && (
            <details className="text-[12px]">
              <summary className="cursor-pointer text-[color:var(--color-muted-foreground)]">Pick members ({audience.userIds.length})</summary>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {members.map((m) => (
                  <label key={m.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={audience.userIds.includes(m.id)} onChange={() => setAudience({ ...audience, userIds: toggle(audience.userIds, m.id) })} />
                    {m.name ?? m.email}
                  </label>
                ))}
              </div>
            </details>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-[12px] font-medium">Escalation contacts</p>
          <div className="flex flex-wrap gap-1.5">
            <Chip on={audience.allContacts} onClick={() => setAudience({ ...audience, allContacts: !audience.allContacts })}>All contacts</Chip>
            {TIERS.map((t) => (
              <Chip key={t} on={audience.contactTiers.includes(t)} onClick={() => setAudience({ ...audience, contactTiers: toggle(audience.contactTiers, t) })}>
                Tier {t}
              </Chip>
            ))}
            {Object.entries(CONTACT_ROLES).map(([k, label]) => (
              <Chip key={k} on={audience.contactRoles.includes(k)} onClick={() => setAudience({ ...audience, contactRoles: toggle(audience.contactRoles, k) })}>
                {label}
              </Chip>
            ))}
          </div>
          {contacts.length > 0 && (
            <details className="text-[12px]">
              <summary className="cursor-pointer text-[color:var(--color-muted-foreground)]">Pick contacts ({audience.contactIds.length})</summary>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {contacts.map((c) => (
                  <label key={c.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={audience.contactIds.includes(c.id)} onChange={() => setAudience({ ...audience, contactIds: toggle(audience.contactIds, c.id) })} />
                    {c.name}
                    {c.title ? <span className="text-[color:var(--color-muted-foreground)]">{c.title}</span> : null}
                  </label>
                ))}
              </div>
            </details>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-[12px] font-medium">Channels</p>
          <div className="flex flex-wrap gap-1.5">
            {CHANNELS.map((c) => (
              <Chip key={c.key} on={channels.includes(c.key)} onClick={() => setChannels(toggle(channels, c.key))}>
                <span className="inline-flex items-center gap-1">
                  <c.icon className="h-3 w-3" aria-hidden /> {c.label}
                </span>
              </Chip>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="broadcast-title">Title</Label>
          <Input id="broadcast-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="broadcast-message">Message</Label>
          <Textarea id="broadcast-message" rows={4} value={message} maxLength={1500} onChange={(e) => setMessage(e.target.value)} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] text-[color:var(--color-muted-foreground)]" data-testid="broadcast-preview">
            {preview
              ? `${preview.recipients} ${preview.recipients === 1 ? "person" : "people"}: ${preview.withApp} in app, ${preview.withEmail} with email, ${preview.withPhone} with a verified phone.`
              : "Pick people or groups."}
          </p>
          <Button type="button" disabled={sending || !hasAudience || !title.trim() || !message.trim() || channels.length === 0 || !preview?.recipients} onClick={() => void send()}>
            <Send className="h-4 w-4" aria-hidden /> Send
          </Button>
        </div>
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)]" aria-label="Sent broadcasts">
        <h2 className="border-b border-[color:var(--color-border)] px-4 py-3 text-sm font-semibold">Sent</h2>
        {rows.length === 0 ? (
          <p className="p-4 text-[13px] text-[color:var(--color-muted-foreground)]">No broadcasts yet.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--color-border)]">
            {rows.map((b) => {
              const open = openId === b.id;
              return (
                <li key={b.id} data-testid="broadcast-row">
                  <button
                    type="button"
                    onClick={() => {
                      setDetail(null);
                      setOpenId(open ? null : b.id);
                    }}
                    className="flex w-full items-start gap-2 px-4 py-3 text-left hover:bg-[color:var(--color-muted)]/50"
                    aria-expanded={open}
                  >
                    {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{b.title}</span>
                      <span className="block text-[11px] text-[color:var(--color-muted-foreground)]">
                        {new Date(b.createdAt).toLocaleString()} · {b.createdByName ?? "Unknown"} · {b.ackedCount} of {b.recipientCount} acknowledged
                      </span>
                      <span className="mt-1 flex flex-wrap gap-2 text-[11px]">
                        {Object.entries(b.channelSummary).map(([ch, s]) => (
                          <span key={ch} className="rounded border border-[color:var(--color-border)] px-1.5 py-0.5">
                            {ch}: {s.sent} sent{s.failed ? `, ${s.failed} failed` : ""}
                            {s.skipped ? `, ${s.skipped} skipped` : ""}
                            {s.pending ? `, ${s.pending} pending` : ""}
                          </span>
                        ))}
                      </span>
                    </span>
                  </button>
                  {open && (
                    <div className="space-y-2 px-4 pb-4">
                      <p className="whitespace-pre-wrap text-[12px] text-[color:var(--color-muted-foreground)]">{b.message}</p>
                      {!detail ? (
                        <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Loading.</p>
                      ) : (
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="text-left text-[color:var(--color-muted-foreground)]">
                              <th className="py-1 font-medium">Recipient</th>
                              <th className="py-1 font-medium">Delivery</th>
                              <th className="py-1 font-medium">Acknowledged</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.map((r) => (
                              <tr key={r.id} className="border-t border-[color:var(--color-border)] align-top" data-testid="broadcast-recipient">
                                <td className="py-1.5 pr-2">{r.name}</td>
                                <td className="py-1.5 pr-2">
                                  {r.deliveries.map((d, i) => (
                                    <span key={i} className={cn("mr-2 inline-block", STATUS_STYLE[d.status])} title={d.error ?? d.destination ?? undefined}>
                                      {d.channel} {d.status}
                                    </span>
                                  ))}
                                </td>
                                <td className="py-1.5">{r.acknowledgedAt ? `${new Date(r.acknowledgedAt).toLocaleTimeString()} (${r.acknowledgedVia})` : "No"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
