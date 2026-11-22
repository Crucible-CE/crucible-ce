"use client";

// Studio canvas node: handles per layout direction, content for template injects.

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CircleStop } from "lucide-react";
import { cn } from "@/lib/utils";

export interface InjectNodeData {
  seq: number;
  title: string;
  offset: string;
  absolute: string | null;
  teamsLabel: string | null;
  phase: string | null;
  objectives: string[];
  end: boolean;
  start: boolean;
  selected: boolean;
  severity: "error" | "warning" | null;
  direction: "TB" | "LR";
  [key: string]: unknown;
}

const PHASE_LABELS: Record<string, string> = { opening: "Opening", main: "Main", resolution: "Resolution" };

function InjectNodeView({ data }: NodeProps) {
  const d = data as unknown as InjectNodeData;
  const tb = d.direction !== "LR";
  return (
    <div
      className={cn(
        "w-[240px] rounded-lg border bg-[color:var(--color-card)] px-3 py-2 text-left shadow-[var(--elevation-1)]",
        d.selected ? "border-[color:var(--mist-indigo)] ring-2 ring-[color:var(--mist-indigo-soft)]" : "border-[color:var(--color-border)]",
      )}
    >
      <Handle type="target" position={tb ? Position.Top : Position.Left} className="!h-2 !w-2 !bg-[color:var(--color-muted-foreground)]" />
      <Handle type="source" position={tb ? Position.Bottom : Position.Right} className="!h-2.5 !w-2.5 !bg-[color:var(--mist-indigo)]" />
      <div className="flex items-start gap-2">
        <span className="mt-0.5 font-mono text-[11px] text-[color:var(--color-muted-foreground)]">{d.seq}</span>
        <p className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-snug font-medium">{d.title || "Untitled inject"}</p>
        {d.severity && (
          <span
            title={d.severity === "error" ? "Has errors" : "Has warnings"}
            className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", d.severity === "error" ? "bg-[color:var(--mist-danger)]" : "bg-[color:var(--mist-warn)]")}
          />
        )}
      </div>
      <p className="mt-1 text-[11px] text-[color:var(--color-muted-foreground)]">
        {d.offset}
        {d.absolute ? `, ${d.absolute}` : ""}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {d.start && <Chip tone="accent">Start</Chip>}
        {d.end && (
          <Chip tone="muted">
            <CircleStop className="h-3 w-3" />
            End
          </Chip>
        )}
        {d.phase && <Chip tone="muted">{PHASE_LABELS[d.phase] ?? d.phase}</Chip>}
        {d.teamsLabel && <Chip tone="muted">{d.teamsLabel}</Chip>}
        {d.objectives.slice(0, 3).map((o) => (
          <Chip key={o} tone="outline">
            {o}
          </Chip>
        ))}
        {d.objectives.length > 3 && <Chip tone="outline">+{d.objectives.length - 3}</Chip>}
      </div>
    </div>
  );
}

function Chip({ tone, children }: { tone: "accent" | "muted" | "outline"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-[120px] items-center gap-0.5 truncate rounded-full px-1.5 py-px text-[10px] font-medium",
        tone === "accent" && "bg-[color:var(--mist-indigo-soft)] text-[color:var(--mist-indigo)]",
        tone === "muted" && "bg-[color:var(--color-muted)] text-[color:var(--color-foreground)]",
        tone === "outline" && "border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)]",
      )}
    >
      {children}
    </span>
  );
}

export const InjectNode = memo(InjectNodeView);
