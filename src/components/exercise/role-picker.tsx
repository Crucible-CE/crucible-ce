"use client";

import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "./types";

export const ALL_ROLES = ["lead_facilitator", "controller", "evaluator", "scribe", "player", "observer"] as const;
/** Guests are never facilitator, controller or evaluator. */
export const GUEST_ROLES = ["player", "observer", "scribe"] as const;

/** Roles after excusing a player: player out, observer in. */
export function excusedRoles(roles: readonly string[]): string[] {
  return [...new Set([...roles.filter((r) => r !== "player"), "observer"])];
}

export function RolePicker({
  value,
  onChange,
  allowed = ALL_ROLES,
  label,
  disabled,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  allowed?: readonly string[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {allowed.map((r) => {
        const on = value.includes(r);
        return (
          <button
            key={r}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((x) => x !== r) : [...value, r])}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[12px] font-medium disabled:opacity-50",
              on
                ? "border-transparent bg-[color:var(--mist-indigo-soft)] text-[color:var(--mist-indigo)]"
                : "border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-muted)]",
            )}
          >
            {ROLE_LABELS[r] ?? r}
          </button>
        );
      })}
    </div>
  );
}
