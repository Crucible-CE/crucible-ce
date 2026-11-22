"use client";

// MITRE ATT&CK tag picker: search the catalog by ID or name, add up to max
// techniques, remove them as chips. Only catalog IDs can be added.

import { useId, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { MAX_ATTACK_TAGS, getTechniqueFullName, searchTechniques } from "@/lib/exercise/content/mitre";

export function TechniquePicker({
  value,
  onChange,
  label,
  id,
  max = MAX_ATTACK_TAGS,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  label: string;
  id?: string;
  max?: number;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const listId = `${inputId}-results`;
  const [query, setQuery] = useState("");
  const results = searchTechniques(query, 8).filter((t) => !value.includes(t.id));
  const full = value.length >= max;

  function add(techId: string) {
    if (full || value.includes(techId)) return;
    onChange([...value, techId]);
    setQuery("");
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={label}>
          {value.map((t) => {
            const name = getTechniqueFullName(t) ?? "";
            return (
              <li key={t} className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-muted)] py-0.5 pr-1 pl-2.5 text-[12px]">
                <span className="font-mono">{t}</span>
                <span className="max-w-[14rem] truncate">{name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${t}`}
                  onClick={() => onChange(value.filter((v) => v !== t))}
                  className="rounded-full p-0.5 hover:bg-[color:var(--mist-paper-2)]"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!full && (
        <div className="relative max-w-md">
          <Input
            id={inputId}
            className="h-9"
            placeholder="Search by ID or name"
            aria-label={`Add ${label}`}
            aria-controls={listId}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (results[0]) add(results[0].id);
              } else if (e.key === "Escape") {
                setQuery("");
              }
            }}
          />
          {results.length > 0 && (
            <ul
              id={listId}
              className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-1 shadow-sm"
            >
              {results.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => add(t.id)}
                    className="flex w-full items-start gap-2 rounded px-2 py-1 text-left text-[12px] hover:bg-[color:var(--color-muted)]"
                  >
                    <span className="w-16 shrink-0 font-mono">{t.id}</span>
                    <span className="min-w-0">{getTechniqueFullName(t.id)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim() && results.length === 0 && <p className="mt-1 text-[12px] text-[color:var(--color-muted-foreground)]">No matching technique.</p>}
        </div>
      )}
    </div>
  );
}
