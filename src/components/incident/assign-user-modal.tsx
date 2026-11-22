"use client";

import { useEffect, useState } from "react";
import { X, Search, Loader2 } from "lucide-react";

interface Member {
  id: string;
  name: string | null;
  email: string;
}

// Reusable org-member picker modal. Used to assign command roles, tasks, and
// stakeholders to people in the caller's organization.
export function AssignUserModal({
  open,
  onClose,
  onSelect,
  title = "Assign user",
  allowUnassign = false,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (userId: string | null, member?: Member) => void;
  title?: string;
  allowUnassign?: boolean;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setQ("");
    fetch("/api/org-members")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setMembers(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const filtered = members.filter((m) => {
    const hay = `${m.name ?? ""} ${m.email}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] shadow-[var(--elevation-3)]">
        <div className="flex items-center justify-between border-b border-[color:var(--color-border)] px-4 py-2.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4 text-[color:var(--color-muted-foreground)]" />
          </button>
        </div>
        <div className="p-3">
          <div className="mb-2 flex items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] px-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search people"
              className="h-8 flex-1 bg-transparent text-[13px] outline-none"
              autoFocus
            />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {loading ? (
              <div className="py-6 text-center">
                <Loader2 className="mx-auto h-4 w-4 animate-spin text-[color:var(--color-muted-foreground)]" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-6 text-center text-xs text-[color:var(--color-muted-foreground)]">No matches.</p>
            ) : (
              <ul className="space-y-0.5">
                {allowUnassign && (
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(null);
                        onClose();
                      }}
                      className="w-full rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[13px] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-muted)]"
                    >
                      Unassign
                    </button>
                  </li>
                )}
                {filtered.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(m.id, m);
                        onClose();
                      }}
                      className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left hover:bg-[color:var(--color-muted)]"
                    >
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[color:var(--mist-indigo-soft)] text-[10px] font-semibold text-[color:var(--mist-indigo)]">
                        {(m.name ?? m.email).slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium">{m.name ?? m.email}</span>
                        <span className="block truncate text-[10.5px] text-[color:var(--color-muted-foreground)]">{m.email}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
