"use client";

// Guest links on the Access card: invite an outside party to this incident,
// copy the link once, revoke it. Everyone who can see the incident sees the
// list; the incident commander, the reporter and administrators manage it.

import { useCallback, useEffect, useState } from "react";
import { Copy, Link2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

interface Invite {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  canUpload: boolean;
  expiresAt: string;
  lastAccessAt: string | null;
  state: "active" | "expired" | "revoked" | "suspended";
}

const STATE_LABEL: Record<Invite["state"], string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
  suspended: "Paused by the lock",
};

export function GuestInvites({ incidentId }: { incidentId: string }) {
  const confirm = useConfirm();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", name: "", company: "", days: "7", canUpload: true });

  const load = useCallback(async () => {
    const res = await fetch(`/api/incidents/${incidentId}/guest-invites`, { cache: "no-store" });
    if (!res.ok) return;
    const d = await res.json();
    setInvites(d.invites ?? []);
    setCanManage(!!d.canManage);
  }, [incidentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/guest-invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim(),
          name: form.name.trim() || undefined,
          company: form.company.trim() || undefined,
          expiresInDays: Number(form.days) || 7,
          canUpload: form.canUpload,
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(apiErrorMessage(d, "Couldn't create the link. Try again."));
        return;
      }
      setLink(d.inviteUrl);
      toast.success(d.emailed ? "Link created and emailed" : "Link created");
      void load();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (inv: Invite) => {
    const ok = await confirm({ title: `Revoke the link for ${inv.email}?`, description: "The link stops working right away.", confirmLabel: "Revoke", destructive: true });
    if (!ok) return;
    const res = await fetch(`/api/incidents/${incidentId}/guest-invites/${inv.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Link revoked");
      void load();
    } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't revoke. Try again."));
  };

  const close = () => {
    setOpen(false);
    setLink(null);
    setForm({ email: "", name: "", company: "", days: "7", canUpload: true });
  };

  if (!canManage && invites.length === 0) return null;

  return (
    <div className="mt-4 border-t border-[color:var(--color-border)] pt-3" data-testid="guest-invites">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">Guests ({invites.filter((i) => i.state === "active").length})</p>
        {canManage && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] px-1.5 py-1 text-[10.5px] hover:border-[color:var(--mist-indigo)]/50"
          >
            <Plus className="h-3 w-3" aria-hidden /> Invite guest
          </button>
        )}
      </div>
      <ul className="space-y-1">
        {invites.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium">{i.name || i.email}</p>
              <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">
                {[i.company, STATE_LABEL[i.state], i.state === "active" ? `until ${new Date(i.expiresAt).toLocaleDateString()}` : null].filter(Boolean).join(" · ")}
              </p>
            </div>
            {canManage && i.state !== "revoked" && (
              <button
                type="button"
                onClick={() => revoke(i)}
                title="Revoke"
                aria-label={`Revoke the link for ${i.email}`}
                className="shrink-0 text-[color:var(--color-muted-foreground)] hover:text-[color:var(--mist-danger)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </li>
        ))}
        {invites.length === 0 && <li className="py-1 text-[11px] text-[color:var(--color-muted-foreground)]">No guests.</li>}
      </ul>

      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a guest</DialogTitle>
          </DialogHeader>
          {link ? (
            <div className="space-y-2">
              <p className="text-sm text-[color:var(--color-muted-foreground)]">Copy the link now. It is shown only once.</p>
              <div className="flex gap-2">
                <Input readOnly value={link} aria-label="Guest link" data-testid="guest-link" onFocus={(e) => e.currentTarget.select()} />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard?.writeText(link).then(() => toast.success("Link copied"), () => undefined);
                  }}
                >
                  <Copy className="h-4 w-4" aria-hidden /> Copy
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-[color:var(--color-muted-foreground)]">The guest sees this incident&apos;s summary, chat and evidence. Nothing else.</p>
              <div className="space-y-1">
                <Label htmlFor="guest-email">Email</Label>
                <Input id="guest-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="guest-name">Name</Label>
                  <Input id="guest-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="guest-company">Company</Label>
                  <Input id="guest-company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="guest-days">Expires after (days)</Label>
                  <Input id="guest-days" type="number" min={1} max={90} value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
                </div>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input type="checkbox" checked={form.canUpload} onChange={(e) => setForm({ ...form, canUpload: e.target.checked })} />
                  Can upload evidence
                </label>
              </div>
            </div>
          )}
          <DialogFooter>
            {link ? (
              <Button type="button" onClick={close}>Done</Button>
            ) : (
              <Button type="button" disabled={busy || !form.email.trim()} onClick={create}>
                <Link2 className="h-4 w-4" aria-hidden /> Create link
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
