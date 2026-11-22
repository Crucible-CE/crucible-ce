import * as React from "react";

import { cn } from "@/lib/utils";

// A "fact of record" — an incident ID, timestamp, hash digest, ledger
// sequence, version, AAL level, or SLA timer. Renders in the mono
// typeface with tabular figures and tightened tracking, so operational data
// reads as instrumentation a professional bets their job on, not as prose.
// Use it anywhere the *exact value* is the point.
interface DataValueProps extends React.ComponentProps<"span"> {
  /** Dim to muted-foreground for secondary / supporting facts. */
  muted?: boolean;
}

export function DataValue({ className, muted, ...props }: DataValueProps) {
  return (
    <span
      className={cn(
        "font-mono text-[0.92em] tabular-nums tracking-tight",
        muted && "text-[color:var(--color-muted-foreground)]",
        className,
      )}
      {...props}
    />
  );
}
