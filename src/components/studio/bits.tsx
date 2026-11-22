"use client";

import { useState } from "react";
import { EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { SafeMarkdown } from "@/components/markdown/safe-markdown";

/** Marks a field that players never see. */
export function HiddenBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[color:color-mix(in_srgb,var(--mist-warn),transparent_88%)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--mist-warn)]">
      <EyeOff className="h-3 w-3" />
      Hidden from players
    </span>
  );
}

export function PanelSection({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3 border-t border-[color:var(--color-border)] pt-4 first:border-t-0 first:pt-0", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A textarea edited as one item per line. Blank lines are dropped on blur. */
export function LinesField({
  value,
  onChange,
  max,
  rows = 3,
  placeholder,
  "aria-label": ariaLabel,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  max: number;
  rows?: number;
  placeholder?: string;
  "aria-label"?: string;
  disabled?: boolean;
}) {
  return (
    <Textarea
      aria-label={ariaLabel}
      rows={rows}
      disabled={disabled}
      placeholder={placeholder}
      value={value.join("\n")}
      onChange={(e) => onChange(e.target.value.split("\n").slice(0, max))}
      onBlur={(e) =>
        onChange(
          e.target.value
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, max),
        )
      }
    />
  );
}

/** Markdown textarea with a preview toggle. */
export function MarkdownField({
  id,
  value,
  onChange,
  rows = 6,
  maxLength,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1 text-[12px]">
        {(["Write", "Preview"] as const).map((label) => {
          const on = (label === "Preview") === preview;
          return (
            <button
              key={label}
              type="button"
              aria-pressed={on}
              onClick={() => setPreview(label === "Preview")}
              className={cn(
                "rounded-md px-2 py-0.5 font-medium",
                on ? "bg-[color:var(--color-muted)] text-[color:var(--color-foreground)]" : "text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      {preview ? (
        <div className="min-h-24 rounded-md border border-[color:var(--color-border)] p-3 text-[13px]">
          {value.trim() ? <SafeMarkdown text={value} /> : <p className="text-[color:var(--color-muted-foreground)]">Nothing to preview.</p>}
        </div>
      ) : (
        <Textarea id={id} rows={rows} maxLength={maxLength} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

/** Issues for one node, shown at the top of its panel. */
export function IssueLines({ issues }: { issues: Array<{ severity: string; message: string }> }) {
  if (!issues.length) return null;
  return (
    <ul className="flex flex-col gap-1 rounded-md bg-[color:var(--color-muted)] p-3 text-[12px]">
      {issues.map((i, n) => (
        <li key={n} className={cn(i.severity === "error" ? "text-[color:var(--mist-danger)]" : i.severity === "warning" ? "text-[color:var(--mist-warn)]" : "text-[color:var(--color-muted-foreground)]")}>
          {i.message}
        </li>
      ))}
    </ul>
  );
}
