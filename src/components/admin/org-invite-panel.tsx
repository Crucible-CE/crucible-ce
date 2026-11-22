"use client";

// Org-scoped invite panel — the link-based invite flow for org admins, matching
// the platform /admin/org-invites experience (single-use, trackable signup
// links) but always scoped to the caller's own organization.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MailPlus, Plus, Copy, Check, Loader2, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ROLE_HELP, ROLE_LABELS, roleLabel } from "@/lib/auth/rbac";

// Mirrors ORG_INVITE_ALLOWED_ROLES (kept local: that lib pulls in node:crypto
// and must not be imported into a client bundle).
const ROLE_OPTIONS = ["contributor", "reader", "exercise_director", "administrator"] as const;

const EXPIRY_OPTIONS = [
  { value: 1, label: "1 day" },
  { value: 3, label: "3 days" },
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
] as const;

interface InviteRow {
  id: string;
  role: string;
  inviteeName: string | null;
  inviteeEmail: string | null;
  skipEmailVerification: boolean;
  createdBy: { name: string | null; email: string };
  usedBy: { name: string | null; email: string } | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  status: "active" | "used" | "expired" | "revoked";
}

interface CreatedInvite {
  inviteUrl: string;
  expiresAt: string;
  organizationName: string;
  role: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusBadgeClass(status: InviteRow["status"]): string {
  switch (status) {
    case "active":
      return "border-[color:var(--mist-ok)]/40 bg-[color:var(--mist-ok)]/10 text-[color:var(--mist-ok)]";
    case "used":
      return "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400";
    case "expired":
      return "border-[color:var(--mist-warn)]/40 bg-[color:var(--mist-warn)]/10 text-[color:var(--mist-warn)]";
    case "revoked":
      return "border-destructive/40 bg-destructive/10 text-destructive";
  }
}

function buildOutreachMessage(invite: CreatedInvite): string {
  return [
    `You're invited to join ${invite.organizationName} on Crucible CE as ${roleLabel(invite.role).toLowerCase()}.`,
    `Create your account with this link. It expires on ${formatDate(invite.expiresAt)}.`,
    ``,
    invite.inviteUrl,
  ].join("\n");
}

export function OrgInvitePanel() {
  const confirm = useConfirm();
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [role, setRole] = useState<string>("contributor");
  const [expiry, setExpiry] = useState<number>(7);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [skipVerification, setSkipVerification] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [creating, setCreating] = useState(false);

  const [createdInvite, setCreatedInvite] = useState<CreatedInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/org-admin/invites");
      if (!res.ok) {
        toast.error("Couldn't load invites. Try again.");
        return;
      }
      const data = await res.json();
      setInvites(data.invites ?? []);
      setEmailConfigured(data.emailConfigured !== false);
    } catch {
      toast.error("Couldn't load invites. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch("/api/org-admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          expiryDays: expiry,
          inviteeName: name.trim() || undefined,
          inviteeEmail: email.trim() || undefined,
          skipEmailVerification: skipVerification,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't create the invite. Try again.");
        return;
      }
      setCreatedInvite({
        inviteUrl: data.inviteUrl,
        expiresAt: data.expiresAt,
        organizationName: data.organizationName,
        role: data.role,
      });
      setCreateOpen(false);
      setName("");
      setEmail("");
      setSkipVerification(false);
      load();
    } catch {
      toast.error("Couldn't create the invite. Try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the text and copy it.");
    }
  }

  async function handleRevoke(id: string) {
    const ok = await confirm({
      title: "Revoke this invite?",
      description: "The link stops working now.",
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!ok) return;
    setRevokingId(id);
    try {
      const res = await fetch(`/api/org-admin/invites/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't revoke the invite. Try again.");
        return;
      }
      toast.success("Invite revoked");
      load();
    } catch {
      toast.error("Couldn't revoke the invite. Try again.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <MailPlus className="h-4 w-4 text-primary" />
            Invite people
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Create a single-use signup link to share.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setSkipVerification(!emailConfigured);
            setCreateOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New invite
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {createdInvite && (
          <div className="space-y-3 rounded-lg border border-[color:var(--mist-indigo)]/40 bg-[color:var(--mist-indigo)]/5 p-4">
            <p className="text-[13px] text-muted-foreground">
              Send this message to the invitee. The link works once and expires on{" "}
              <strong className="text-foreground">
                {formatDate(createdInvite.expiresAt)}
              </strong>.
            </p>
            <textarea
              readOnly
              rows={4}
              className="w-full resize-none rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              value={buildOutreachMessage(createdInvite)}
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCopy(buildOutreachMessage(createdInvite))}
              >
                {copied ? (
                  <Check className="mr-1.5 h-4 w-4 text-[color:var(--mist-ok)]" />
                ) : (
                  <Copy className="mr-1.5 h-4 w-4" />
                )}
                {copied ? "Copied" : "Copy message"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCreatedInvite(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : invites.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No invites yet.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {invites.map((i) => (
              <div key={i.id} className="flex items-center gap-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {i.inviteeName ?? i.inviteeEmail ?? "(unnamed)"}
                    </span>
                    <Badge variant="outline" className={statusBadgeClass(i.status)}>
                      {i.status}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {roleLabel(i.role)}
                    </Badge>
                    {i.skipEmailVerification && (
                      <Badge
                        variant="outline"
                        className="border-[color:var(--mist-warn)]/40 bg-[color:var(--mist-warn)]/10 text-[10px] text-[color:var(--mist-warn)]"
                      >
                        no email verification
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {i.inviteeEmail && i.inviteeName && <span>{i.inviteeEmail}</span>}
                    <span>Created {formatDate(i.createdAt)}</span>
                    {i.status === "active" && <span>Expires {formatDate(i.expiresAt)}</span>}
                    {i.usedAt && i.usedBy && (
                      <span>
                        Used by {i.usedBy.name ?? i.usedBy.email} at {formatDate(i.usedAt)}
                      </span>
                    )}
                    {i.revokedAt && <span>Revoked {formatDate(i.revokedAt)}</span>}
                  </div>
                </div>
                {i.status === "active" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revokingId === i.id}
                    onClick={() => handleRevoke(i.id)}
                  >
                    {revokingId === i.id ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New invite</DialogTitle>
            <DialogDescription>
              Creates a single-use signup link. The invitee sets their own password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[12px] text-[color:var(--color-muted-foreground)]">
                  {ROLE_HELP[role as (typeof ROLE_OPTIONS)[number]] ?? ""}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Expires in</Label>
                <Select value={String(expiry)} onValueChange={(v) => setExpiry(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((e) => (
                      <SelectItem key={e.value} value={String(e.value)}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="inviteeName">Invitee name (optional)</Label>
              <Input
                id="inviteeName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inviteeEmail">Invitee email (optional)</Label>
              <Input
                id="inviteeEmail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@example.com"
              />
            </div>

            <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 p-3">
              <div className="space-y-0.5">
                <Label htmlFor="skipVerification">Skip email verification</Label>
                <p className="text-[11px] text-muted-foreground">
                  The account starts verified. Applies to this invite only.
                </p>
                {!emailConfigured && (
                  <p className="text-[11px] text-[color:var(--mist-amber)]">
                    No email set up (SMTP_HOST or RESEND_API_KEY). Leave this on or the
                    invitee can&apos;t sign in.
                  </p>
                )}
              </div>
              <Switch
                id="skipVerification"
                checked={skipVerification}
                onCheckedChange={setSkipVerification}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Generate link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
