"use client";

// Small building blocks for the report editor: section card with origin
// badge and refresh, inline text editing, evidence chips.

import { useState, type ReactNode } from "react";
import { Loader2, Pencil, Plus, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SafeMarkdown } from "@/components/markdown/safe-markdown";
import { formatInZone } from "@/lib/exercise/time";
import type { Evidence } from "@/lib/exercise/aar/schema";
import { evidenceFromOption, type EvidenceOption } from "@/lib/exercise/aar/evidence";
import type { SectionOrigin } from "./types";

const ORIGIN_LABEL: Record<SectionOrigin, string> = { human: "Edited", system: "From record" };

export function OriginBadge({ origin }: { origin: SectionOrigin | null }) {
  if (!origin) return null;
  return (
    <Badge variant={origin === "human" ? "success" : "outline"} data-testid="origin-badge">
      {ORIGIN_LABEL[origin]}
    </Badge>
  );
}

export function SectionCard({
  id,
  title,
  origin,
  onRefresh,
  refreshing,
  note,
  children,
}: {
  id: string;
  title: string;
  origin: SectionOrigin | null;
  /** Rebuild this record section from the exercise. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** A line under the heading, such as a Cloud note. */
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="gap-4" id={`section-${id}`} data-testid={`aar-section-${id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 font-display text-lg font-semibold tracking-tight">{title}</h2>
        <OriginBadge origin={origin} />
        {onRefresh && (
          <Button size="xs" variant="ghost" onClick={onRefresh} disabled={refreshing} aria-label={`Refresh ${title} from the record`}>
            {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Refresh
          </Button>
        )}
      </div>
      {note}
      {children}
    </Card>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{children}</div>;
}

/**
 * Text with an Edit button. Saving calls onSave; it resolves true on success.
 * Multiline uses a textarea and renders markdown-safe text when not editing.
 */
export function EditableText({
  value,
  editable,
  onSave,
  multiline = true,
  placeholder = "Not written yet.",
  label,
  maxLength,
}: {
  value: string;
  editable: boolean;
  onSave: (next: string) => Promise<boolean>;
  multiline?: boolean;
  placeholder?: string;
  label?: string;
  maxLength?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  if (editing) {
    return (
      <div className="space-y-2">
        {multiline ? (
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} maxLength={maxLength} aria-label={label ?? "Text"} autoFocus />
        ) : (
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={maxLength} aria-label={label ?? "Text"} autoFocus />
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const ok = await onSave(draft.trim());
              setSaving(false);
              if (ok) setEditing(false);
            }}
          >
            {saving && <Loader2 className="animate-spin" />}
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="group flex items-start gap-2">
      <div className="min-w-0 flex-1 text-[14px] leading-relaxed">
        {value ? (
          multiline ? (
            <SafeMarkdown text={value} />
          ) : (
            <span>{value}</span>
          )
        ) : (
          <span className="text-[color:var(--color-muted-foreground)]">{placeholder}</span>
        )}
      </div>
      {editable && (
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={label ? `Edit ${label.toLowerCase()}` : "Edit"}
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
        >
          <Pencil />
        </Button>
      )}
    </div>
  );
}

const KIND_LABEL: Record<Evidence["kind"], string> = {
  entry: "Entry",
  answer: "Answer",
  vote: "Vote",
  observation: "Observation",
  event: "Decision",
};

/** One evidence item: quote, time and role. The source id points at the record row it quotes. */
export function EvidenceChip({ e, timezone, onRemove }: { e: Evidence; timezone: string; onRemove?: () => void }) {
  let when = e.at ?? "";
  if (e.at && !Number.isNaN(Date.parse(e.at))) when = formatInZone(new Date(e.at), timezone);
  return (
    <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-muted)]/40 px-2.5 py-1.5 text-[12px]" data-testid="evidence-chip">
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          {e.quote && <p className="italic">&ldquo;{e.quote}&rdquo;</p>}
          <p className="text-[color:var(--color-muted-foreground)]" data-source-id={e.sourceId}>
            {[KIND_LABEL[e.kind], when, e.speakerRole].filter(Boolean).join(", ")}
          </p>
        </div>
        {onRemove && (
          <button type="button" onClick={onRemove} aria-label="Remove evidence" className="rounded p-0.5 text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-muted)]">
            <X className="size-3" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Pick an item from the exercise record to cite: observations, answers,
 * entries, votes and decisions. Items already cited are left out.
 */
export function EvidencePicker({
  options,
  cited,
  onPick,
}: {
  options: EvidenceOption[];
  cited: Evidence[];
  onPick: (e: Evidence) => Promise<boolean> | void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const taken = new Set(cited.map((c) => `${c.kind}:${c.sourceId}`));
  const needle = q.trim().toLowerCase();
  const list = options
    .filter((o) => !taken.has(`${o.kind}:${o.sourceId}`))
    .filter((o) => !needle || o.quote.toLowerCase().includes(needle) || o.context.toLowerCase().includes(needle))
    .slice(0, 40);
  if (!open) {
    return (
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)} disabled={options.length === 0} title={options.length === 0 ? "The record has nothing to cite yet." : undefined}>
        <Plus />
        Add evidence
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-[color:var(--color-border)] p-2" data-testid="evidence-picker">
      <div className="flex items-center gap-2">
        <Input aria-label="Search the record" placeholder="Search the record" value={q} onChange={(e) => setQ(e.target.value)} className="h-8" />
        <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      {list.length === 0 ? (
        <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Nothing matches.</p>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {list.map((o) => (
            <li key={`${o.kind}:${o.sourceId}`}>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const ok = await onPick(evidenceFromOption(o));
                  setBusy(false);
                  if (ok !== false) setOpen(false);
                }}
                className="w-full rounded px-2 py-1 text-left text-[12px] hover:bg-[color:var(--color-muted)]"
              >
                <span className="font-medium">{KIND_LABEL[o.kind]}</span>
                {o.context && <span className="text-[color:var(--color-muted-foreground)]">, {o.context}</span>}
                <span className="line-clamp-2 block">{o.quote}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
