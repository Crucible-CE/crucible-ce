"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useStepUp } from "@/components/security/reauth-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Loader2,
  Trash2,
  UserCog,
  MoreVertical,
  MailCheck,
  KeyRound,
  KeySquare,
  Copy,
  LogOut,
  CheckSquare,
  Square,
  LockOpen,
  PhoneCall,
  ShieldOff,
} from "lucide-react";

import { ORG_ROLES, ROLE_HELP, ROLE_LABELS } from "@/lib/auth/rbac";

interface ManagedUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  /** Notification phone (SMS/voice alerts) and its toll-fraud status. */
  notificationPhone?: string | null;
  phoneVerified?: boolean;
  phoneOverride?: boolean;
  /** Two-factor sign-in methods (null = none). */
  mfa?: { totp: boolean; securityKeys: number } | null;
}

interface UserManagementProps {
  initialUsers: ManagedUser[];
  currentUserId: string;
  /** An email transport is configured (shows "Email reset link"). */
  emailConfigured: boolean;
}


export function UserManagement({
  initialUsers,
  currentUserId,
  emailConfigured,
}: UserManagementProps) {
  const confirm = useConfirm();
  // MFA reset and reset links need the admin's own "confirm it's you".
  const { withStepUp, dialog: stepUpDialog } = useStepUp();
  const [users, setUsers] = useState(initialUsers);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  // A reset link just created; shown once.
  const [resetLink, setResetLink] = useState<{ name: string; url: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<
    "force_logout" | "deactivate" | "activate"
  >("force_logout");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setUsers(initialUsers);
    setSelectedIds(new Set());
  }, [initialUsers]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runBulk() {
    if (selectedIds.size === 0) return;
    const label = {
      force_logout: "force-logout",
      deactivate: "deactivate",
      activate: "activate",
    }[bulkAction];
    const ok = await confirm({
      title: `${label[0].toUpperCase() + label.slice(1)} ${selectedIds.size} selected user${
        selectedIds.size === 1 ? "" : "s"
      }?`,
      confirmLabel: "Apply",
      destructive: bulkAction === "deactivate" || bulkAction === "force_logout",
    });
    if (!ok) return;
    setBulkSubmitting(true);
    try {
      const res = await fetch("/api/admin/users/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: Array.from(selectedIds),
          action: bulkAction,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; affected?: number; selfSkipped?: number }
        | null;
      if (!res.ok) {
        toast.error(data?.error ?? "Couldn't apply. Try again.");
        return;
      }
      const skipNote =
        data?.selfSkipped && data.selfSkipped > 0
          ? ` (skipped yourself)`
          : "";
      toast.success(`Applied to ${data?.affected ?? 0} user${data?.affected === 1 ? "" : "s"}${skipNote}`);
      setSelectedIds(new Set());
      // Refresh visible state for deactivate/activate (server is source of truth for isActive)
      if (bulkAction === "deactivate" || bulkAction === "activate") {
        setUsers((prev) =>
          prev.map((u) =>
            selectedIds.has(u.id) && u.id !== currentUserId
              ? { ...u, isActive: bulkAction === "activate" }
              : u,
          ),
        );
      }
    } finally {
      setBulkSubmitting(false);
    }
  }

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
  }, [users]);

  async function updateUser(id: string, payload: Record<string, unknown>) {
    setSavingUserId(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error ?? "Couldn't update the user. Try again.");
        return;
      }

      const updated = (await res.json()) as ManagedUser;
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...updated } : u)));
      toast.success("User updated");
    } finally {
      setSavingUserId(null);
    }
  }

  async function handleForceVerify(user: ManagedUser) {
    setSavingUserId(user.id);
    try {
      const res = await fetch(
        `/api/admin/users/${user.id}/verify-email`,
        { method: "POST" }
      );
      const data = (await res.json().catch(() => null)) as
        | { error?: string; alreadyVerified?: boolean }
        | null;
      if (!res.ok) {
        toast.error(data?.error ?? "Couldn't verify the email. Try again.");
        return;
      }
      toast.success(
        data?.alreadyVerified
          ? `${user.email} is already verified`
          : `Verified ${user.email}`
      );
    } finally {
      setSavingUserId(null);
    }
  }

  async function handlePhoneOverride(user: ManagedUser) {
    const allow = !user.phoneOverride;
    const ok = await confirm({
      title: allow
        ? `Allow SMS/voice to ${user.notificationPhone} without verification?`
        : `Require ${user.email} to verify their phone again?`,
      description: allow
        ? "Unverified numbers risk toll fraud. Only allow a number you have confirmed yourself."
        : "No SMS or voice pages until they confirm the number by SMS code.",
      confirmLabel: allow ? "Allow unverified phone" : "Require verification",
      destructive: allow,
    });
    if (!ok) return;
    setSavingUserId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/notification-phone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowUnverified: allow }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast.error(data?.error ?? "Couldn't update the phone setting. Try again.");
        return;
      }
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, phoneOverride: allow } : u)));
      toast.success(allow ? `SMS/voice allowed to ${user.notificationPhone}` : "Phone verification required");
    } finally {
      setSavingUserId(null);
    }
  }

  async function handleSendPasswordReset(user: ManagedUser) {
    const ok = await confirm({
      title: `Email a reset link to ${user.email}?`,
      description: "The link expires in 1 hour.",
      confirmLabel: "Email reset link",
    });
    if (!ok) return;
    setSavingUserId(user.id);
    try {
      const res = await fetch(
        `/api/admin/users/${user.id}/send-password-reset`,
        { method: "POST" }
      );
      const data = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!res.ok) {
        toast.error(data?.error ?? "Couldn't send the reset email. Try again.");
        return;
      }
      toast.success(`Reset link sent to ${user.email}`);
    } finally {
      setSavingUserId(null);
    }
  }

  async function handleCopyResetLink(user: ManagedUser) {
    setSavingUserId(user.id);
    try {
      const res = await withStepUp(() => fetch(
        `/api/admin/users/${user.id}/reset-link`,
        { method: "POST" },
      ));
      if (!res) return;
      const data = (await res.json().catch(() => null)) as
        | { error?: string; url?: string }
        | null;
      if (!res.ok || !data?.url) {
        toast.error(data?.error ?? "Couldn't create a reset link. Try again.");
        return;
      }
      setResetLink({ name: user.name ?? user.email, url: data.url });
    } finally {
      setSavingUserId(null);
    }
  }

  async function handleForceLogout(user: ManagedUser) {
    const ok = await confirm({
      title: `Force-logout ${user.email}?`,
      description: "Ends all their sessions now.",
      confirmLabel: "Force logout",
      destructive: true,
    });
    if (!ok) return;
    setSavingUserId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/force-logout`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!res.ok) {
        toast.error(data?.error ?? "Couldn't sign out the user. Try again.");
        return;
      }
      toast.success(`Force-logged out ${user.email}`);
    } finally {
      setSavingUserId(null);
    }
  }

  // Clears the sign-in delay that failed attempts put on this account (e.g.
  // someone guessing its password). Sessions and password are unchanged.
  async function handleUnlockSignIn(user: ManagedUser) {
    setSavingUserId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/unlock`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!res.ok) {
        toast.error(data?.error ?? "Couldn't unlock sign-in. Try again.");
        return;
      }
      toast.success(`Sign-in unlocked for ${user.email}`);
    } finally {
      setSavingUserId(null);
    }
  }

  // Removes every two-factor method of a member who lost their phone / key
  // and recovery codes; their sessions end. Audited.
  async function handleResetMfa(user: ManagedUser) {
    const ok = await confirm({
      title: `Reset two-factor sign-in for ${user.email}?`,
      description:
        "Removes their authenticator app, security keys and recovery codes, and signs them out. Confirm who is asking first.",
      confirmLabel: "Reset two-factor",
      destructive: true,
    });
    if (!ok) return;
    setSavingUserId(user.id);
    try {
      const res = await withStepUp(() => fetch(`/api/admin/users/${user.id}/mfa-reset`, { method: "POST" }));
      if (!res) return;
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast.error(data?.error ?? "Couldn't reset two-factor sign-in. Try again.");
        return;
      }
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, mfa: null } : u)));
      toast.success(`Two-factor sign-in reset for ${user.email}`);
    } finally {
      setSavingUserId(null);
    }
  }

  function openDelete(user: ManagedUser) {
    setDeleteConfirmEmail("");
    setDeleteTarget(user);
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/users/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail: deleteConfirmEmail.trim() }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error ?? "Couldn't delete the user. Try again.");
        return;
      }

      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      toast.success(`Deleted ${deleteTarget.email}`);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-4 w-4 text-primary" />
            Users
          </CardTitle>
        </div>

      </CardHeader>

      <CardContent>
        {sortedUsers.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/30 p-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => {
                const selectable = sortedUsers.filter((u) => u.id !== currentUserId);
                if (selectedIds.size >= selectable.length) {
                  setSelectedIds(new Set());
                } else {
                  setSelectedIds(new Set(selectable.map((u) => u.id)));
                }
              }}
            >
              {selectedIds.size >= sortedUsers.filter((u) => u.id !== currentUserId).length &&
              sortedUsers.length > 1
                ? "Clear selection"
                : "Select all"}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {selectedIds.size} selected
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Select
                value={bulkAction}
                onValueChange={(v) => setBulkAction(v as typeof bulkAction)}
                disabled={selectedIds.size === 0 || bulkSubmitting}
              >
                <SelectTrigger className="h-7 w-[180px] text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="force_logout">Force logout</SelectItem>
                  <SelectItem value="deactivate">Deactivate</SelectItem>
                  <SelectItem value="activate">Activate</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="h-7 text-[11px]"
                disabled={selectedIds.size === 0 || bulkSubmitting}
                onClick={runBulk}
              >
                {bulkSubmitting ? (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                ) : null}
                Apply
              </Button>
            </div>
          </div>
        )}
        {sortedUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users found.</p>
        ) : (
          <div className="space-y-2">
            {sortedUsers.map((user) => {
              const isSelf = user.id === currentUserId;
              const isSaving = savingUserId === user.id;
              const isSelected = selectedIds.has(user.id);
              return (
                <div
                  key={user.id}
                  className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 lg:flex-row lg:items-center lg:justify-between"
                >
                  <button
                    type="button"
                    onClick={() => !isSelf && toggleSelect(user.id)}
                    disabled={isSelf}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-40"
                    title={isSelf ? "You can't select yourself" : "Select"}
                  >
                    {isSelected ? (
                      <CheckSquare className="h-4 w-4 text-[color:var(--mist-indigo)]" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{user.name ?? user.email}</span>
                      {!user.isActive && <Badge variant="destructive">Inactive</Badge>}
                      {isSelf && <Badge variant="outline">You</Badge>}
                      {user.mfa ? (
                        <Badge
                          variant="success"
                          data-testid="member-mfa"
                          title={[user.mfa.totp ? "Authenticator app" : null, user.mfa.securityKeys ? `${user.mfa.securityKeys} security key${user.mfa.securityKeys === 1 ? "" : "s"}` : null].filter(Boolean).join(", ")}
                        >
                          Two-factor
                        </Badge>
                      ) : (
                        <Badge variant="outline" data-testid="member-mfa">No two-factor</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {user.email}
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 lg:w-[380px]">
                    <Select
                      value={user.role}
                      onValueChange={(value) => updateUser(user.id, { role: value })}
                      disabled={isSaving || user.id === currentUserId}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ORG_ROLES.map((role) => (
                          <SelectItem key={role} value={role} title={ROLE_HELP[role]}>
                            {ROLE_LABELS[role]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 flex-1"
                        disabled={isSaving || isSelf}
                        onClick={() => updateUser(user.id, { isActive: !user.isActive })}
                      >
                        {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : user.isActive ? "Deactivate" : "Activate"}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-8 w-8"
                            disabled={isSaving}
                            title="More actions"
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => handleForceVerify(user)}
                          >
                            <MailCheck className="mr-2 h-3.5 w-3.5" />
                            Force-verify email
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleCopyResetLink(user)}
                            disabled={isSelf || !user.isActive}
                          >
                            <KeySquare className="mr-2 h-3.5 w-3.5" />
                            Copy reset link
                          </DropdownMenuItem>
                          {emailConfigured && (
                            <DropdownMenuItem
                              onClick={() => handleSendPasswordReset(user)}
                            >
                              <KeyRound className="mr-2 h-3.5 w-3.5" />
                              Email reset link
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => handleForceLogout(user)}
                            disabled={user.id === currentUserId}
                          >
                            <LogOut className="mr-2 h-3.5 w-3.5" />
                            Force logout
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleUnlockSignIn(user)}
                          >
                            <LockOpen className="mr-2 h-3.5 w-3.5" />
                            Unlock sign-in
                          </DropdownMenuItem>
                          {user.mfa && !isSelf && (
                            <DropdownMenuItem onClick={() => handleResetMfa(user)}>
                              <ShieldOff className="mr-2 h-3.5 w-3.5" />
                              Reset two-factor
                            </DropdownMenuItem>
                          )}
                          {user.notificationPhone && !user.phoneVerified && (
                            <DropdownMenuItem onClick={() => handlePhoneOverride(user)}>
                              <PhoneCall className="mr-2 h-3.5 w-3.5" />
                              {user.phoneOverride ? "Require phone verification" : "Allow unverified phone"}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        size="icon"
                        variant="destructive"
                        className="h-8 w-8"
                        disabled={isSaving || isSelf}
                        onClick={() => openDelete(user)}
                      >
                        {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog
        open={!!resetLink}
        onOpenChange={(open) => {
          if (!open) setResetLink(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset link</DialogTitle>
            <DialogDescription>
              Send this link to {resetLink?.name}. It works once and expires in 1 hour.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 p-3 font-mono text-sm">
            <span className="flex-1 break-all" data-testid="reset-link">
              {resetLink?.url}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                if (!resetLink) return;
                try {
                  await navigator.clipboard.writeText(resetLink.url);
                  toast.success("Copied");
                } catch {
                  toast.error("Couldn't copy. Select the text and copy it.");
                }
              }}
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Copy
            </Button>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setResetLink(null)}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete user</DialogTitle>
            <DialogDescription>
              Permanently deletes <strong>{deleteTarget?.email}</strong> and their data. This can&apos;t
              be undone. Type their email to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="deleteConfirmEmail">Email</Label>
            <Input
              id="deleteConfirmEmail"
              type="email"
              autoComplete="off"
              value={deleteConfirmEmail}
              onChange={(event) => setDeleteConfirmEmail(event.target.value)}
              placeholder={deleteTarget?.email}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                deleting ||
                !deleteTarget ||
                deleteConfirmEmail.trim().toLowerCase() !==
                  deleteTarget.email.toLowerCase()
              }
              onClick={handleDeleteConfirmed}
            >
              {deleting ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Delete user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {stepUpDialog}
    </Card>
  );
}
