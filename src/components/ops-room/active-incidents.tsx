"use client";

// "Active incidents": compact list of the open incidents the member can see
// (lock rules applied server-side), most severe first, with the member's own
// role and the SLA clock. The full, filterable list is /incidents.

import Link from "next/link";
import { ChevronRight, Lock, Plus, Siren } from "lucide-react";
import { ROLE_LABELS } from "@/lib/ops-room/rules";
import type { ActiveIncidents as Data } from "@/lib/ops-room/incidents";
import { Panel, SectionTitle, SeverityDot, SlaChip, useClock } from "./bits";

export function ActiveIncidents({ data, canDeclare, serverNow }: { data: Data; canDeclare: boolean; serverNow: string }) {
  const now = useClock(serverNow);
  return (
    <section className="space-y-2" aria-labelledby="active-incidents-title">
      <SectionTitle
        icon={<Siren className="h-3 w-3 text-[color:var(--mist-danger)]" />}
        aside={
          <Link
            href="/incidents"
            className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-[color:var(--mist-indigo)] hover:underline"
          >
            View all <ChevronRight className="h-3 w-3" />
          </Link>
        }
      >
        <span id="active-incidents-title">Active incidents</span>
        {data.total > 0 && (
          <span className="ml-1 font-normal normal-case tracking-normal text-[color:var(--color-muted-foreground)]">
            {data.total} open{data.critical > 0 ? ` · ${data.critical} critical` : ""}
          </span>
        )}
      </SectionTitle>

      <Panel>
        {data.rows.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
            <span className="text-[13px] text-[color:var(--color-muted-foreground)]">No open incidents.</span>
            {canDeclare && (
              <Link
                href="/incidents?declare=1"
                className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[color:var(--mist-danger)] px-3 text-[12.5px] font-semibold text-white hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" />
                Declare incident
              </Link>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-[color:var(--mist-hairline)]" data-testid="active-incidents">
            {data.rows.map((i) => (
              <li key={i.id}>
                <Link href={`/incidents/${i.id}`} className="flex min-w-0 items-center gap-3 px-4 py-2.5 hover:bg-[color:var(--color-muted)]/40">
                  <SeverityDot severity={i.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {i.restricted && <Lock className="h-3 w-3 shrink-0 text-[color:var(--color-muted-foreground)]" aria-label="Locked" />}
                      <span className="min-w-0 truncate text-[13px] font-medium">{i.title}</span>
                    </div>
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] uppercase tracking-[0.06em] text-[color:var(--color-muted-foreground)]">
                      <span>{i.severity}</span>
                      <span aria-hidden>·</span>
                      <span>{i.status.replace(/_/g, " ")}</span>
                      {i.roles.length > 0 && (
                        <span className="normal-case tracking-normal font-semibold text-[color:var(--mist-indigo)]">
                          You: {i.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}
                        </span>
                      )}
                      <SlaChip sla={i.sla} now={now} className="normal-case tracking-normal" />
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}
