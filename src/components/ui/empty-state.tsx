import * as React from "react";
import { type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Shared empty-state primitive.
// One recipe everywhere: a soft-tinted glyph + a specific, slightly
// opinionated headline + one orienting sentence + (optionally) the single
// next action. Replaces the ad-hoc "No data" blocks that were hand-rolled
// per page. Restrained by design — it should read as calm, not decorative.
interface EmptyStateProps {
  /** A lucide glyph for the concept this surface represents. */
  icon?: LucideIcon;
  /** Specific, concrete headline — e.g. "No active incidents", not "No data". */
  title: string;
  /** One sentence of orientation: what this is, or what to do next. */
  description?: string;
  /** The single next action (a Button, or a couple of them). */
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] bg-[color:var(--color-card)] px-6 py-14 text-center shadow-[var(--elevation-1)]",
        className,
      )}
    >
      {Icon && (
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] bg-[color:var(--mist-indigo-soft)] text-[color:var(--mist-indigo)]">
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </span>
      )}
      <div className="space-y-1">
        <p className="text-[14px] font-semibold text-[color:var(--color-foreground)]">
          {title}
        </p>
        {description && (
          <p className="mx-auto max-w-sm text-[12.5px] leading-relaxed text-[color:var(--color-muted-foreground)]">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-1 flex items-center gap-2">{action}</div>}
    </div>
  );
}
