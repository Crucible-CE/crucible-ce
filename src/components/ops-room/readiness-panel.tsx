"use client";

// "Readiness": paging and setup health. One green line when everything is in
// order; opens by itself when something needs attention, each issue with a
// link to fix it. Administrators see the server checks; everyone else sees
// only their own items.

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronDown, Info, OctagonAlert, RadioTower } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReadinessItem, ReadinessLevel, ReadinessView } from "@/lib/ops-room/readiness";
import { Panel, SectionTitle } from "./bits";

const LEVEL_ICON: Record<ReadinessLevel, React.ComponentType<{ className?: string }>> = {
  error: OctagonAlert,
  warn: AlertTriangle,
  info: Info,
  ok: CheckCircle2,
};

const LEVEL_TONE: Record<ReadinessLevel, string> = {
  error: "text-[color:var(--mist-danger)]",
  warn: "text-[color:var(--mist-warn)]",
  info: "text-[color:var(--color-muted-foreground)]",
  ok: "text-[color:var(--mist-ok)]",
};

function Item({ item }: { item: ReadinessItem }) {
  const Icon = LEVEL_ICON[item.level];
  return (
    <li data-level={item.level} data-key={item.key} className="flex min-w-0 items-start gap-3 px-4 py-2.5">
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", LEVEL_TONE[item.level])} />
      <div className="min-w-0 flex-1">
        <p className={cn("text-[13px] break-words", item.level === "ok" || item.level === "info" ? "" : "font-medium")}>
          {item.title}
          {item.audience === "personal" && (
            <span className="ml-1.5 rounded-full bg-[color:var(--mist-indigo-soft)] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-[color:var(--mist-indigo)]">
              You
            </span>
          )}
        </p>
        {item.detail && <p className="mt-0.5 text-[12px] leading-relaxed text-[color:var(--color-muted-foreground)] break-words">{item.detail}</p>}
      </div>
      {item.fix && (
        <Link
          href={item.fix.href}
          className="shrink-0 whitespace-nowrap pt-0.5 text-[12px] font-medium text-[color:var(--mist-indigo)] hover:underline"
        >
          {item.fix.label}
        </Link>
      )}
    </li>
  );
}

export function ReadinessPanel({ view }: { view: ReadinessView }) {
  const [open, setOpen] = useState(!view.ready);
  const Icon = view.ready ? CheckCircle2 : AlertTriangle;
  return (
    <section className="space-y-2" aria-labelledby="readiness-title">
      <SectionTitle icon={<RadioTower className="h-3 w-3 text-[color:var(--mist-indigo)]" />}>
        <span id="readiness-title">Readiness</span>
      </SectionTitle>
      <Panel>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="readiness-items"
          data-testid="readiness-summary"
          data-ready={view.ready ? "true" : "false"}
          className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left hover:bg-[color:var(--color-muted)]/40"
        >
          <Icon className={cn("h-4 w-4 shrink-0", view.ready ? "text-[color:var(--mist-ok)]" : "text-[color:var(--mist-warn)]")} />
          <span className={cn("min-w-0 flex-1 text-[13px] break-words", !view.ready && "font-medium")}>{view.summary}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)] transition-transform", open && "rotate-180")} />
        </button>
        {open && view.items.length > 0 && (
          <ul id="readiness-items" className="divide-y divide-[color:var(--mist-hairline)] hairline-t" data-testid="readiness-items">
            {view.items.map((item) => (
              <Item key={item.key} item={item} />
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}
