"use client";

import { Fragment, useState } from "react";
import { ChevronDown, Hourglass, Loader2, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldSelect } from "@/components/form/field-select";
import { SafeMarkdown } from "@/components/markdown/safe-markdown";
import type { ModeViewProps } from "@/lib/exercise/modes/ui";
import { ENTRY_TYPES, ENTRY_TYPE_LABELS, GRADE_RATING_LABELS, QUESTION_CATEGORY_LABELS, type EntryType } from "../schema";
import type { DocEntry, DocGrade, DocModule, DocState } from "./types";

export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]", className)}>{children}</p>;
}

export function Notice({ icon = "wait", text }: { icon?: "wait" | "info"; text: string }) {
  return (
    <Card dense className="flex-row items-center gap-3 text-sm text-[color:var(--color-muted-foreground)]">
      {icon === "wait" ? <Hourglass className="h-4 w-4 shrink-0" aria-hidden /> : <MessagesSquare className="h-4 w-4 shrink-0" aria-hidden />}
      <span>{text}</span>
    </Card>
  );
}

export function sectionHeading(state: DocState, id: string | null | undefined): string | null {
  if (!id) return null;
  return state.document?.sections.find((s) => s.id === id)?.heading ?? null;
}

export function categoryLabel(c: string): string {
  return (QUESTION_CATEGORY_LABELS as Record<string, string>)[c] ?? c;
}

export function scenarioClock(state: DocState, at: string | null): string | null {
  if (!at || !state.exercise.scenarioStartAt) return null;
  const mins = Math.round((Date.parse(at) - Date.parse(state.exercise.scenarioStartAt)) / 60_000);
  if (!Number.isFinite(mins)) return null;
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  return `T+${h}h${m ? ` ${m}m` : ""}`;
}

const STATUS_CHIP: Record<string, { label: string; variant: "outline" | "success" | "destructive" }> = {
  submitted: { label: "Pending", variant: "outline" },
  confirmed: { label: "Confirmed", variant: "success" },
  denied: { label: "Denied", variant: "destructive" },
};

export function StatusChip({ status }: { status: string }) {
  const s = STATUS_CHIP[status] ?? STATUS_CHIP.submitted;
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function GradeChip({ grade }: { grade: DocGrade | null | undefined }) {
  if (!grade) return null;
  const variant = grade.rating === "met" ? "success" : grade.rating === "partially_met" ? "warning" : "destructive";
  const label = grade.rating ? GRADE_RATING_LABELS[grade.rating] : "Graded";
  return (
    <Badge variant={variant} title={grade.rationale ?? undefined}>
      {label}
      {typeof grade.score === "number" ? ` ${grade.score} of 4` : ""}
    </Badge>
  );
}

/** Scenario update, key issues and questions of one module. */
export function ModuleBody({ state, module, large = false }: { state: DocState; module: DocModule; large?: boolean }) {
  return (
    <div className="space-y-4">
      <SafeMarkdown text={module.scenarioUpdate} className={large ? "text-2xl leading-snug" : "text-[15px]"} />
      {module.keyIssues.length > 0 && (
        <div className="space-y-1.5">
          <SectionLabel>Key issues</SectionLabel>
          <ul className={cn("list-disc space-y-1 pl-5", large ? "text-xl" : "text-sm")}>
            {module.keyIssues.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        </div>
      )}
      {module.questions.length > 0 && (
        <div className="space-y-1.5">
          <SectionLabel>Questions</SectionLabel>
          <ol className={cn("space-y-2", large ? "text-xl" : "text-sm")}>
            {module.questions.map((q, i) => (
              <li key={q.key} className="flex gap-2">
                <span className="font-mono text-[color:var(--color-muted-foreground)]">{i + 1}.</span>
                <span className="flex-1">
                  {q.text}
                  {!large && (
                    <span className="ml-2 text-xs text-[color:var(--color-muted-foreground)]">
                      {categoryLabel(q.category)}
                      {q.docSectionRefs.length > 0 && `, ${q.docSectionRefs.map((r) => sectionHeading(state, r) ?? r).join(", ")}`}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export function questionNumber(module: DocModule, key: string | null): string | null {
  if (!key) return null;
  const i = module.questions.findIndex((q) => q.key === key);
  return i >= 0 ? `Question ${i + 1}` : null;
}

/** One entry line: type, status, text, question and section. */
export function EntryRow({ state, module, entry, children }: { state: DocState; module: DocModule; entry: DocEntry; children?: React.ReactNode }) {
  const section = sectionHeading(state, entry.docSectionRef);
  const q = questionNumber(module, entry.questionKey);
  return (
    <li className={cn("space-y-1.5 rounded-lg border border-[color:var(--color-border)] px-3 py-2.5", entry.status === "denied" && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge variant="secondary">{ENTRY_TYPE_LABELS[entry.type] ?? entry.type}</Badge>
        {entry.type === "gap" && entry.severity && <Badge variant={entry.severity === "high" ? "destructive" : entry.severity === "medium" ? "warning" : "outline"}>{entry.severity} severity</Badge>}
        <StatusChip status={entry.status} />
        {q && <span className="text-[color:var(--color-muted-foreground)]">{q}</span>}
        <span className="ml-auto text-[color:var(--color-muted-foreground)]">
          {entry.speakerRole ? `${entry.speakerRole}, via ${entry.by}` : entry.by}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm">{entry.text}</p>
      {section && <p className="text-xs text-[color:var(--color-muted-foreground)]">Section {section}</p>}
      {children}
    </li>
  );
}

const SEVERITIES = [
  { value: "", label: "No severity" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

/** Post an entry to the open module. */
export function EntryComposer({
  state,
  module,
  respond,
  disabled,
}: {
  state: DocState;
  module: DocModule;
  respond: ModeViewProps["respond"];
  disabled?: boolean;
}) {
  const scribe = Boolean(state.me?.roles.includes("scribe"));
  const [type, setType] = useState<EntryType>("discussion");
  const [text, setText] = useState("");
  const [questionKey, setQuestionKey] = useState(module.questions.find((q) => !q.answered)?.key ?? "");
  const [severity, setSeverity] = useState("");
  const [section, setSection] = useState("");
  const [speakerRole, setSpeakerRole] = useState("");
  const [busy, setBusy] = useState(false);

  const sections = state.document?.sections ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await respond(module.id, "entry", {
        type,
        text: text.trim(),
        questionKey: questionKey || null,
        severity: type === "gap" && severity ? severity : null,
        docSectionRef: section || null,
        speakerRole: speakerRole.trim() || null,
      });
      if (!r.ok) toast.error(r.error ?? "The entry was not saved. Try again.");
      else {
        setText("");
        setSeverity("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card dense>
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        <SectionLabel>New entry</SectionLabel>
        <div className="grid gap-2 sm:grid-cols-2">
          <FieldSelect
            aria-label="Entry type"
            value={type}
            onChange={(v) => setType(v as EntryType)}
            options={ENTRY_TYPES.map((t) => ({ value: t, label: ENTRY_TYPE_LABELS[t] }))}
          />
          <FieldSelect
            aria-label="Question"
            value={questionKey}
            onChange={setQuestionKey}
            options={[{ value: "", label: "No question" }, ...module.questions.map((q, i) => ({ value: q.key, label: `Question ${i + 1}: ${q.text.slice(0, 70)}${q.text.length > 70 ? "..." : ""}` }))]}
          />
          {type === "gap" && <FieldSelect aria-label="Severity" value={severity} onChange={setSeverity} options={SEVERITIES} />}
          {sections.length > 0 && (
            <FieldSelect
              aria-label="Document section"
              value={section}
              onChange={setSection}
              options={[{ value: "", label: "No document section" }, ...sections.map((s) => ({ value: s.id, label: `${"  ".repeat(Math.max(0, s.level - 1))}${s.heading}` }))]}
            />
          )}
          {(scribe || state.viewer.isControl) && (
            <Input aria-label="Speaker role" placeholder="Speaker role, optional" value={speakerRole} maxLength={80} onChange={(e) => setSpeakerRole(e.target.value)} />
          )}
        </div>
        <Textarea
          aria-label="Entry text"
          placeholder={type === "gap" ? "What is missing or unclear in the plan." : "What the group said or decided."}
          value={text}
          maxLength={4000}
          rows={3}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={disabled || busy || !text.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Post entry
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Closed modules, collapsed. */
export function EarlierModules({ state, modules, renderEntry }: { state: DocState; modules: DocModule[]; renderEntry?: (m: DocModule, e: DocEntry) => React.ReactNode }) {
  if (modules.length === 0) return null;
  return (
    <div className="space-y-2">
      <SectionLabel>Earlier modules</SectionLabel>
      {modules.map((m) => (
        <details key={m.id} className="group rounded-xl bg-[color:var(--color-card)] shadow-[var(--elevation-1)]">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
            <span>
              Module {m.seq}. {m.title}
            </span>
            <span className="ml-auto text-xs text-[color:var(--color-muted-foreground)]">{m.entries.length} entries</span>
          </summary>
          <div className="space-y-4 px-4 pb-4">
            <ModuleBody state={state} module={m} />
            {m.entries.length > 0 && (
              <ul className="space-y-2">
                {m.entries.map((e) => (renderEntry ? <Fragment key={e.id}>{renderEntry(m, e)}</Fragment> : <EntryRow key={e.id} state={state} module={m} entry={e} />))}
              </ul>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

