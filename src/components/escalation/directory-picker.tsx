"use client";

// ---------------------------------------------------------------------------
// Directory picker — pre-seeded external emergency-contact catalog.
// Users tap entries to add them to their org's escalation matrix in
// one click. Already-imported entries (matched by name) are flagged
// with a disabled "Added" pill.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Loader2, Check, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  directoryByCategory,
  type DirectoryContact,
} from "@/lib/escalation/directory";

interface ExistingContact {
  name: string;
  phone: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  existing: ExistingContact[];
  onAdded: () => void;
}

export function DirectoryPicker({ open, onClose, existing, onAdded }: Props) {
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  function isAdded(d: DirectoryContact): boolean {
    // Punctuation-insensitive so renamed directory entries still match contacts added earlier.
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return existing.some((c) => norm(c.name) === norm(d.name));
  }

  async function addContact(d: DirectoryContact) {
    if (isAdded(d)) return;
    setPendingSlug(d.slug);
    try {
      const res = await fetch("/api/escalation-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: d.name,
          title: d.title,
          phone: d.phone,
          alternatePhone: d.alternatePhone,
          email: d.email,
          tier: d.tier,
          severityLevel: d.severityLevel,
          role: d.role,
          notes: d.notes,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Couldn't add the contact. Try again.");
        return;
      }
      toast.success(`Added ${d.name}`);
      onAdded();
    } finally {
      setPendingSlug(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add from directory</DialogTitle>
        </DialogHeader>
        <p className="text-[12.5px] leading-relaxed text-[color:var(--color-muted-foreground)]">
          Federal agencies, regulators and IR retainers. Fill in numbers marked <code className="font-mono text-[11px]">[PROVIDE …]</code> after adding.
        </p>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {directoryByCategory().map((group) => (
            <section key={group.category} className="space-y-2">
              <div className="eyebrow">{group.category}</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {group.contacts.map((d) => {
                  const added = isAdded(d);
                  const pending = pendingSlug === d.slug;
                  return (
                    <div
                      key={d.slug}
                      className="flex items-start gap-2 rounded-lg bg-[color:var(--color-card)] p-3 shadow-[var(--elevation-0)]"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="text-[12.5px] font-semibold">{d.name}</div>
                          <Badge variant="outline" className="text-[10px]">
                            Tier {d.tier}
                          </Badge>
                        </div>
                        <div className="mt-0.5 text-[11.5px] tabular-nums text-[color:var(--color-muted-foreground)]">
                          {d.phone}
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-[color:var(--color-muted-foreground)]">
                          {d.description}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="xs"
                        variant={added ? "ghost" : "outline"}
                        disabled={added || pending}
                        onClick={() => addContact(d)}
                      >
                        {added ? (
                          <>
                            <Check className="h-3 w-3" />
                            Added
                          </>
                        ) : pending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <Plus className="h-3 w-3" />
                            Add
                          </>
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
