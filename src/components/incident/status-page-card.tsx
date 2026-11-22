"use client";

// Public status page controls on the Comms tab: create the page, publish or
// take it offline, choose which update audiences it shows, replace the link.
// The public link is shown once, when it is made.

import { useCallback, useEffect, useState } from "react";
import { Copy, Globe, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useIncidentShell } from "@/components/incident/incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

interface PageInfo {
  id: string;
  isPublished: boolean;
  live: boolean;
  title: string;
  audienceScope: "public" | "customer";
  subscriberCount: number;
}

export function StatusPageCard({ incidentId, onChange }: { incidentId: string; onChange?: () => void }) {
  const confirm = useConfirm();
  const { readOnly } = useIncidentShell();
  const [page, setPage] = useState<PageInfo | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/incidents/${incidentId}/status-page`, { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      setPage(d.page);
      setRestricted(!!d.restricted);
    } finally {
      setLoaded(true);
    }
  }, [incidentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/status-page`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(apiErrorMessage(d, "Couldn't save. Try again."));
        return;
      }
      if (d?.publicUrl) setLink(d.publicUrl);
      toast.success(success);
      await load();
      onChange?.();
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    const ok = await confirm({ title: "Replace the public link?", description: "The current link stops working.", confirmLabel: "Replace", destructive: true });
    if (ok) await save({ rotateLink: true }, "New link created");
  };

  if (!loaded) return null;

  return (
    <div className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4" data-testid="status-page-card">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Globe className="h-4 w-4 text-[color:var(--mist-indigo)]" aria-hidden /> Public status page
        </h2>
        {page && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${page.live ? "bg-[color:var(--mist-ok)]/15 text-[color:var(--mist-ok)]" : "bg-[color:var(--color-muted)] text-muted-foreground"}`}>
            {page.live ? "Live" : "Offline"}
          </span>
        )}
      </div>

      {restricted ? (
        <p className="text-xs text-muted-foreground">A locked incident has no public status page.</p>
      ) : !page ? (
        readOnly ? (
          <p className="text-xs text-muted-foreground">No status page.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Shows the updates you post to it and nothing else.</p>
            <div className="flex gap-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder="Public title, for example Email service disruption"
                aria-label="Public title"
                className="min-w-0 flex-1 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                disabled={busy || !title.trim()}
                onClick={() => void save({ title: title.trim(), isPublished: false }, "Status page created")}
                className="rounded-md bg-[color:var(--mist-indigo)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="space-y-2 text-xs">
          <p className="text-sm font-medium">{page.title}</p>
          <p className="text-muted-foreground">
            Shows {page.audienceScope === "customer" ? "customer and public" : "public"} updates. {page.subscriberCount} confirmed {page.subscriberCount === 1 ? "subscriber" : "subscribers"}.
          </p>
          {link && (
            <div className="flex gap-2">
              <input readOnly value={link} aria-label="Public link" data-testid="status-page-link" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1 font-mono text-[11px]" />
              <button type="button" onClick={() => void navigator.clipboard?.writeText(link).then(() => toast.success("Link copied"), () => undefined)} className="inline-flex items-center gap-1 rounded-md border border-[color:var(--color-border)] px-2 py-1">
                <Copy className="h-3 w-3" aria-hidden /> Copy
              </button>
            </div>
          )}
          {link && <p className="text-muted-foreground">Copy the link now. It is shown only once.</p>}
          {!readOnly && (
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => void save({ isPublished: !page.isPublished }, page.isPublished ? "Status page taken offline" : "Status page published")}
                className="rounded-md bg-[color:var(--mist-indigo)] px-2.5 py-1 font-medium text-white disabled:opacity-50"
              >
                {page.isPublished ? "Take offline" : "Publish"}
              </button>
              <select
                value={page.audienceScope}
                disabled={busy}
                onChange={(e) => void save({ audienceScope: e.target.value }, "Audience saved")}
                aria-label="Updates shown"
                className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1"
              >
                <option value="public">Public updates</option>
                <option value="customer">Customer and public updates</option>
              </select>
              <button type="button" disabled={busy} onClick={() => void rotate()} className="inline-flex items-center gap-1 rounded-md border border-[color:var(--color-border)] px-2 py-1 disabled:opacity-50">
                <RefreshCw className="h-3 w-3" aria-hidden /> {link ? "Replace link" : "Get a new link"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
