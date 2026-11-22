"use client";

// Shared pieces of the lobby editor sections.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { zonedWallTime } from "@/lib/exercise/time";

/** Local draft that follows the server copy until the user edits it. reset() drops edits. */
export function useDraft<T>(source: T): [T, (v: T | ((p: T) => T)) => void, boolean, () => void] {
  const [draft, setDraftState] = useState<T>(source);
  const [dirty, setDirty] = useState(false);
  const key = JSON.stringify(source);
  const sourceRef = useRef(source);
  useEffect(() => {
    sourceRef.current = source;
  });
  useEffect(() => {
    if (!dirty) setDraftState(sourceRef.current);
  }, [key, dirty]);
  const setDraft = useCallback((v: T | ((p: T) => T)) => {
    setDirty(true);
    setDraftState(v as T);
  }, []);
  const reset = useCallback(() => {
    setDirty(false);
    setDraftState(sourceRef.current);
  }, []);
  return [draft, setDraft, dirty, reset];
}

/** ISO instant to a datetime-local value showing the wall time in the instance zone. */
export function toZoneInput(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const p: Record<string, string> = {};
  try {
    for (const x of new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(iso)))
      p[x.type] = x.value;
  } catch {
    return iso.slice(0, 16);
  }
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** A datetime-local value read as wall time in the instance zone. */
export function fromZoneInput(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  return zonedWallTime(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), timeZone).toISOString();
}

export function Section({ title, description, children, action }: { title: string; description?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card className="gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-[12.5px] text-[color:var(--color-muted-foreground)]">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function SaveBar({ dirty, busy, onSave, onReset }: { dirty: boolean; busy: boolean; onSave: () => void; onReset: () => void }) {
  if (!dirty) return null;
  return (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onClick={onReset} disabled={busy}>
        Discard
      </Button>
      <Button size="sm" onClick={onSave} disabled={busy}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Save
      </Button>
    </div>
  );
}

/** PATCH /api/exercises/{id} with a toast. Resolves true when saved. */
export type Patch = (body: Record<string, unknown>, success?: string) => Promise<boolean>;
