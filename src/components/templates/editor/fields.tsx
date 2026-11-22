"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldSelect } from "@/components/form/field-select";

export function Field({
  label,
  hint,
  children,
  className,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-[13px]">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[12px] text-[color:var(--color-muted-foreground)]">{hint}</p>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">{children}</h2>
      {action}
    </div>
  );
}

function parseIntOrNull(text: string): number | null {
  const t = text.trim();
  if (!/^-?\d+$/.test(t)) return null;
  return Number(t);
}

/**
 * Integer input that lets the author type freely. Commits whole numbers as
 * they are typed; an empty box commits null when allowEmpty is set.
 */
export function NumberField({
  id,
  value,
  onChange,
  allowEmpty = false,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: number | null;
  onChange: (n: number | null) => void;
  allowEmpty?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    if (parseIntOrNull(text) !== value) setText(value === null ? "" : String(value));
  }
  return (
    <Input
      id={id}
      inputMode="numeric"
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={cn("h-9", className)}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = parseIntOrNull(t);
        if (n !== null) onChange(n);
        else if (allowEmpty && t.trim() === "") onChange(null);
      }}
      onBlur={() => {
        if (parseIntOrNull(text) === null && !(allowEmpty && text.trim() === "")) setText(value === null ? "" : String(value));
      }}
    />
  );
}

/** Toggle chips. */
export function ChipGroup({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (next: string[]) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
              on
                ? "border-transparent bg-[color:var(--mist-indigo-soft)] text-[color:var(--mist-indigo)]"
                : "border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-muted)]",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Selected keys as removable chips, plus a select to add one. */
export function KeyPicker({
  options,
  value,
  onChange,
  max,
  addLabel,
  label,
}: {
  options: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (next: string[]) => void;
  max: number;
  addLabel: string;
  label: string;
}) {
  const id = useId();
  const labelOf = (k: string) => options.find((o) => o.value === k)?.label ?? k;
  const free = options.filter((o) => !value.includes(o.value));
  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={label}>
          {value.map((k) => (
            <li
              key={k}
              className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-muted)] py-0.5 pr-1 pl-2.5 text-[12px]"
            >
              <span className="max-w-[16rem] truncate">{labelOf(k)}</span>
              <button
                type="button"
                aria-label={`Remove ${labelOf(k)}`}
                onClick={() => onChange(value.filter((v) => v !== k))}
                className="rounded-full p-0.5 hover:bg-[color:var(--mist-paper-2)]"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.length < max && free.length > 0 && (
        <FieldSelect
          id={id}
          aria-label={addLabel}
          value=""
          onChange={(v) => v && onChange([...value, v])}
          options={[{ value: "", label: addLabel }, ...free]}
          className="h-9 max-w-sm"
        />
      )}
    </div>
  );
}
