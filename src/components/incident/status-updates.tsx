"use client";

import { useCallback, useEffect, useState } from "react";
import { Globe, Megaphone, Pencil, Plus, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useIncidentShell } from "@/components/incident/incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

interface Update { id: string; audience: string; headline: string; body: string; publishedByName: string | null; createdAt: string; unpublishedAt: string | null; editedAt: string | null; publishedToPageAt?: string | null }
interface PageInfo { isPublished: boolean; live: boolean; audienceScope: string }
const pageAudiences = (scope: string) => (scope === "customer" ? ["public", "customer"] : ["public"]);
const AUD_STYLE: Record<string, string> = {
  customer: "bg-[color:var(--mist-indigo)]/15 text-[color:var(--mist-indigo)]",
  public: "bg-[color:var(--mist-amber)]/15 text-[color:var(--mist-amber)]",
  internal: "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]",
};

// Customer / public status updates — external comms cadence, distinct from
// internal stakeholder notifications. Publishing to an
// external audience confirms first; published updates can be edited
// (ledgered) or unpublished (retracted — stays visible greyed, the original
// publish ledger event is retained for legal defensibility).
export function StatusUpdates({ incidentId, pageVersion = 0 }: { incidentId: string; pageVersion?: number }) {
  const confirm = useConfirm();
  const { readOnly } = useIncidentShell();
  const [updates, setUpdates] = useState<Update[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ audience: "customer", headline: "", body: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ headline: "", body: "" });
  const [statusPage, setStatusPage] = useState<PageInfo | null>(null);
  const [toPage, setToPage] = useState(true);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/status-updates`);
      if (res.ok) setUpdates((await res.json()).updates);
      else setLoadError(true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [incidentId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/incidents/${incidentId}/status-page`, { cache: "no-store" });
        if (res.ok) setStatusPage((await res.json()).page ?? null);
      } catch {
        // the status page controls just stay hidden
      }
    })();
  }, [incidentId, pageVersion]);
  const canGoOnPage = (audience: string) => !!statusPage && pageAudiences(statusPage.audienceScope).includes(audience);

  const postToPage = async (u: Update) => {
    const ok = await confirm({
      title: `Post "${u.headline}" to the status page?`,
      description: statusPage?.live ? "Subscribers get it by email." : "The page is not published yet. Subscribers get nothing until it is.",
      confirmLabel: "Post",
    });
    if (!ok) return;
    const res = await fetch(`/api/incidents/${incidentId}/status-updates/${u.id}/page`, { method: "POST" });
    if (res.ok) { toast.success("Posted to the status page"); void load(); }
    else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't post. Try again."));
  };

  const removeFromPage = async (u: Update) => {
    const res = await fetch(`/api/incidents/${incidentId}/status-updates/${u.id}/page`, { method: "DELETE" });
    if (res.ok) { toast.success("Removed from the status page"); void load(); }
    else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't remove. Try again."));
  };

  const publish = async () => {
    if (!form.headline.trim() || !form.body.trim()) return;
    if (form.audience === "public" || form.audience === "customer") {
      const ok = await confirm({
        title: `Publish this ${form.audience} update?`,
        description: "You can edit or unpublish it later. The publication stays on the ledger.",
        confirmLabel: "Publish",
      });
      if (!ok) return;
    }
    const res = await fetch(`/api/incidents/${incidentId}/status-updates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, postToStatusPage: canGoOnPage(form.audience) && toPage }) });
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      setForm({ audience: "customer", headline: "", body: "" });
      setOpen(false);
      if (d.statusPage && !d.statusPage.posted) toast.error(d.statusPage.error ?? "Published, but not posted to the status page.");
      else toast.success(d.statusPage?.posted ? "Update published and posted to the status page" : "Update published");
      void load();
    } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't publish. Try again."));
  };

  const startEdit = (u: Update) => {
    setEditingId(u.id);
    setEditForm({ headline: u.headline, body: u.body });
  };

  const saveEdit = async (updateId: string) => {
    if (!editForm.headline.trim() || !editForm.body.trim()) return;
    const res = await fetch(`/api/incidents/${incidentId}/status-updates/${updateId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editForm) });
    if (res.ok) { setEditingId(null); toast.success("Update edited"); void load(); }
    else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't edit update. Try again."));
  };

  const unpublish = async (u: Update) => {
    const ok = await confirm({
      title: `Unpublish "${u.headline}"?`,
      description: "It stays visible here, greyed out. The original publication stays on the ledger.",
      confirmLabel: "Unpublish",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/incidents/${incidentId}/status-updates/${u.id}/unpublish`, { method: "POST" });
    if (res.ok) { toast.success("Update unpublished"); void load(); }
    else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't unpublish. Try again."));
  };

  return (
    <div className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4" data-testid="status-updates">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Megaphone className="h-4 w-4 text-[color:var(--mist-indigo)]" /> Customer / public updates</h2>
        {!readOnly && <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 rounded-md border border-[color:var(--color-border)] px-2 py-1 text-xs"><Plus className="h-3 w-3" /> New</button>}
      </div>

      {open && !readOnly && (
        <div className="mb-3 space-y-2 rounded-lg border border-[color:var(--color-border)] p-3">
          <div className="flex items-center gap-2">
            <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-sm">
              <option value="customer">Customer</option><option value="public">Public</option><option value="internal">Internal</option>
            </select>
            <input value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} placeholder="Headline" className="flex-1 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-sm" />
          </div>
          <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={3} placeholder="Update text" className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-sm" />
          {canGoOnPage(form.audience) && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={toPage} onChange={(e) => setToPage(e.target.checked)} />
              Post to the status page{statusPage?.live ? " and email subscribers" : ""}
            </label>
          )}
          <div className="flex justify-end"><button onClick={publish} className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--mist-indigo)] px-3 py-1.5 text-sm font-medium text-white"><Send className="h-3.5 w-3.5" /> Publish</button></div>
        </div>
      )}

      {loading && updates.length === 0 ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : loadError && updates.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Couldn&apos;t load status updates.</span>
          <button onClick={() => { setLoading(true); void load(); }} className="rounded-md border border-[color:var(--color-border)] px-2 py-1 text-xs hover:bg-[color:var(--color-muted)]">Retry</button>
        </div>
      ) : updates.length === 0 ? <p className="text-xs text-muted-foreground">No status updates.</p> : (
        <div className="space-y-2">
          {updates.map((u) => (
            <div key={u.id} className={cn("rounded-lg border border-[color:var(--color-border)] p-2.5", u.unpublishedAt && "opacity-60")}>
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${AUD_STYLE[u.audience]}`}>{u.audience}</span>
                {u.unpublishedAt && <span className="rounded bg-[color:var(--mist-danger)]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[color:var(--mist-danger)]">Unpublished</span>}
                {u.publishedToPageAt && !u.unpublishedAt && <span className="inline-flex items-center gap-1 rounded bg-[color:var(--mist-ok)]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[color:var(--mist-ok)]"><Globe className="h-2.5 w-2.5" aria-hidden /> On status page</span>}
                {u.editedAt && !u.unpublishedAt && <span className="rounded bg-[color:var(--color-muted)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">Edited</span>}
                <span className="text-sm font-medium">{u.headline}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{new Date(u.createdAt).toLocaleString()}</span>
                {!readOnly && !u.unpublishedAt && editingId !== u.id && (
                  <span className="flex items-center gap-1">
                    {canGoOnPage(u.audience) && !u.publishedToPageAt && (
                      <button onClick={() => void postToPage(u)} title="Post to status page" aria-label="Post to status page" className="text-muted-foreground hover:text-foreground"><Globe className="h-3 w-3" /></button>
                    )}
                    {u.publishedToPageAt && (
                      <button onClick={() => void removeFromPage(u)} title="Remove from status page" aria-label="Remove from status page" className="text-[10px] text-muted-foreground underline-offset-2 hover:underline">Remove from page</button>
                    )}
                    <button onClick={() => startEdit(u)} title="Edit" aria-label="Edit" className="text-muted-foreground hover:text-foreground"><Pencil className="h-3 w-3" /></button>
                    <button onClick={() => void unpublish(u)} title="Unpublish" aria-label="Unpublish" className="text-muted-foreground hover:text-[color:var(--mist-danger)]"><Undo2 className="h-3 w-3" /></button>
                  </span>
                )}
              </div>
              {editingId === u.id && !readOnly ? (
                <div className="mt-2 space-y-2">
                  <input value={editForm.headline} onChange={(e) => setEditForm({ ...editForm, headline: e.target.value })} className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-sm" />
                  <textarea value={editForm.body} onChange={(e) => setEditForm({ ...editForm, body: e.target.value })} rows={3} className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-sm" />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingId(null)} className="rounded-md border border-[color:var(--color-border)] px-2.5 py-1 text-xs">Cancel</button>
                    <button onClick={() => void saveEdit(u.id)} className="rounded-md bg-[color:var(--mist-indigo)] px-2.5 py-1 text-xs font-medium text-white">Save edit</button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{u.body}</p>
              )}
              {u.publishedByName && <p className="mt-1 text-[10px] text-muted-foreground">By {u.publishedByName}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
