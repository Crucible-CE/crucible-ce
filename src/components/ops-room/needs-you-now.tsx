"use client";

// "Needs you now": the signed-in member's own action items. Pages awaiting MY
// ack come first (red, with an inline Acknowledge through the normal page-ack
// API), then incidents I hold a role on with their SLA clock, then my tasks
// that are overdue or due within 24h, then unread @mentions.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AtSign, BellRing, CheckCircle2, ChevronRight, ListTodo, Loader2, Lock, Shield, Siren } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatAgo } from "@/lib/ops-room/format";
import { ROLE_LABELS } from "@/lib/ops-room/rules";
import { formatMinutes } from "@/lib/ops-room/sla-headline";
import type { NeedsYou } from "@/lib/ops-room/needs-you";
import { Panel, SectionTitle, SeverityDot, SlaChip, useClock } from "./bits";

const rowClass = "flex min-w-0 items-center gap-3 px-4 py-3";

function AckButton({ busy, onClick, label = "Acknowledge" }: { busy: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex h-9 w-full shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[color:var(--mist-danger)] px-3 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-60 sm:h-8 sm:w-auto"
    >
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {label}
    </button>
  );
}

export function NeedsYouNow({ needs, serverNow }: { needs: NeedsYou; serverNow: string }) {
  const router = useRouter();
  const now = useClock(serverNow);
  const [busy, setBusy] = useState<string | null>(null);
  const empty = needs.count === 0 && needs.roles.length === 0;

  const ackPage = async (incidentId: string, pageId: string) => {
    setBusy(pageId);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/page/ack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      if (res.ok || res.status === 404) {
        // 404 = already acknowledged or escalated elsewhere: either way it no longer needs me.
        if (res.ok) toast.success("Page acknowledged");
        router.refresh();
      } else {
        const d = await res.json().catch(() => null);
        toast.error((d as { error?: string } | null)?.error ?? "Couldn't acknowledge the page. Try again.");
      }
    } finally {
      setBusy(null);
    }
  };

  const ackTest = async () => {
    setBusy("test");
    try {
      const res = await fetch("/api/onboarding/test-page/ack", { method: "POST" });
      if (res.ok) toast.success("Test page acknowledged");
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const openMention = async (id: string, link: string | null) => {
    setBusy(id);
    try {
      await fetch(`/api/notifications/${id}`, { method: "PATCH" }).catch(() => undefined);
    } finally {
      setBusy(null);
    }
    if (link) router.push(link);
    else router.refresh();
  };

  return (
    <section className="space-y-2" aria-labelledby="needs-you-title">
      <SectionTitle icon={<BellRing className="h-3 w-3 text-[color:var(--mist-danger)]" />}>
        <span id="needs-you-title">Needs you now</span>
        {needs.count > 0 && (
          <span className="ml-1 rounded-full bg-[color:var(--mist-danger)] px-1.5 py-px text-[10px] font-semibold tracking-normal text-white tabular-nums">
            {needs.count}
          </span>
        )}
      </SectionTitle>

      <Panel>
        {empty ? (
          <div className="flex items-center gap-2.5 px-4 py-4 text-[13px] text-[color:var(--color-muted-foreground)]">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[color:var(--mist-ok)]" />
            Nothing needs you.
          </div>
        ) : (
          <ul className="divide-y divide-[color:var(--mist-hairline)]" data-testid="needs-you-list">
            {needs.pages.map((p) => (
              <li
                key={p.id}
                data-testid="needs-you-page"
                className={cn(rowClass, "flex-wrap sm:flex-nowrap border-l-[3px] border-[color:var(--mist-danger)] bg-[color:var(--mist-danger)]/[0.06]")}
              >
                <Siren className="h-4 w-4 shrink-0 text-[color:var(--mist-danger)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[color:var(--mist-danger)]">Paged</span>
                    {p.restricted && <Lock className="h-3 w-3 shrink-0 text-[color:var(--color-muted-foreground)]" />}
                    {p.incidentId ? (
                      <Link href={`/incidents/${p.incidentId}`} className="min-w-0 truncate text-[13px] font-semibold hover:underline sm:whitespace-nowrap">
                        {p.title}
                      </Link>
                    ) : (
                      <span className="min-w-0 truncate text-[13px] font-semibold">{p.title}</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11.5px] text-[color:var(--color-muted-foreground)]">
                    <span className="uppercase">{p.severity}</span> · paged {formatAgo(new Date(p.createdAt), now)}
                    {p.ackDeadlineAt &&
                      (new Date(p.ackDeadlineAt) > now
                        ? ` · escalates in ${formatMinutes((new Date(p.ackDeadlineAt).getTime() - now.getTime()) / 60_000)}`
                        : " · escalating")}
                  </p>
                </div>
                <div className="w-full pl-7 sm:w-auto sm:pl-0">
                {p.restricted || !p.incidentId ? (
                  p.ackUrl ? (
                    <a
                      href={p.ackUrl}
                      className="inline-flex h-9 w-full shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[color:var(--mist-danger)] px-3 text-[12.5px] font-semibold text-white hover:opacity-90 sm:h-8 sm:w-auto"
                    >
                      Acknowledge
                    </a>
                  ) : null
                ) : (
                  <AckButton busy={busy === p.id} onClick={() => void ackPage(p.incidentId!, p.id)} />
                )}
                </div>
              </li>
            ))}

            {needs.testPage && (
              <li data-testid="needs-you-test-page" className={cn(rowClass, "flex-wrap sm:flex-nowrap border-l-[3px] border-[color:var(--mist-indigo)]")}>
                <BellRing className="h-4 w-4 shrink-0 text-[color:var(--mist-indigo)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[color:var(--mist-indigo)]">Test page</span>
                    <span className="min-w-0 truncate text-[13px] font-semibold">Acknowledge your test page</span>
                  </div>
                  <p className="mt-0.5 truncate text-[11.5px] text-[color:var(--color-muted-foreground)]">
                    Sent {formatAgo(new Date(needs.testPage.sentAt), now)}
                  </p>
                </div>
                <div className="w-full pl-7 sm:w-auto sm:pl-0">
                  <AckButton busy={busy === "test"} onClick={() => void ackTest()} />
                </div>
              </li>
            )}

            {needs.roles.map((r) => (
              <li key={r.incidentId}>
                <Link href={`/incidents/${r.incidentId}`} className={cn(rowClass, "hover:bg-[color:var(--color-muted)]/40")}>
                  <Shield className="h-4 w-4 shrink-0 text-[color:var(--mist-indigo)]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <SeverityDot severity={r.severity} />
                      <span className="min-w-0 truncate text-[13px] font-medium">{r.title}</span>
                    </div>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="text-[11.5px] font-semibold text-[color:var(--mist-indigo)]">
                        You: {r.roles.map((role) => ROLE_LABELS[role] ?? role).join(", ")}
                      </span>
                      <SlaChip sla={r.sla} now={now} />
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />
                </Link>
              </li>
            ))}

            {needs.tasks.map((t) => (
              <li key={t.id} data-testid="needs-you-task">
                <Link href={`/incidents/${t.incidentId}/tasks/${t.id}`} className={cn(rowClass, "hover:bg-[color:var(--color-muted)]/40")}>
                  <ListTodo className={cn("h-4 w-4 shrink-0", t.due === "overdue" ? "text-[color:var(--mist-danger)]" : "text-[color:var(--mist-warn)]")} />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{t.title}</span>
                    <span className="block truncate text-[11.5px] text-[color:var(--color-muted-foreground)]">
                      <span className={cn("font-semibold", t.due === "overdue" ? "text-[color:var(--mist-danger)]" : "text-[color:var(--mist-warn)]")}>
                        {new Date(t.dueAt) < now
                          ? `Overdue ${formatMinutes((now.getTime() - new Date(t.dueAt).getTime()) / 60_000)}`
                          : `Due in ${formatMinutes((new Date(t.dueAt).getTime() - now.getTime()) / 60_000)}`}
                      </span>{" "}
                      · {t.incidentTitle}
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />
                </Link>
              </li>
            ))}

            {needs.mentions.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => void openMention(m.id, m.link)}
                  disabled={busy === m.id}
                  className={cn(rowClass, "w-full text-left hover:bg-[color:var(--color-muted)]/40")}
                >
                  <AtSign className="h-4 w-4 shrink-0 text-[color:var(--mist-indigo)]" />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{m.title}</span>
                    <span className="block truncate text-[11.5px] text-[color:var(--color-muted-foreground)]">
                      {formatAgo(new Date(m.createdAt), now)} · {m.body}
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}
