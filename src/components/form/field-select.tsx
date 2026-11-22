"use client";

// Native <select> styled like the Mist inputs. Used for long lists (time
// zones) where a native control is faster and more accessible than a popover.
import { cn } from "@/lib/utils";

export interface FieldSelectOption {
  value: string;
  label: string;
}

export function FieldSelect({
  id,
  value,
  onChange,
  options,
  className,
  disabled,
  ...rest
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: FieldSelectOption[];
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-11 w-full rounded-md border border-[color:var(--color-input)] bg-[color:var(--color-card)] px-3 text-sm text-[color:var(--color-foreground)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-ring)] disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
