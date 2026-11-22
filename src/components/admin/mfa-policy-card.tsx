"use client";

// Members page: the org's "Require two-factor sign-in" policy.

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useStepUp } from "@/components/security/reauth-dialog";

export function MfaPolicyCard({
  initialRequireMfa,
  membersWithoutMfa,
  selfHasMfa,
}: {
  initialRequireMfa: boolean;
  membersWithoutMfa: number;
  selfHasMfa: boolean;
}) {
  const confirm = useConfirm();
  // Changing the org's sign-in policy needs the admin's own "confirm it's you".
  const { withStepUp, dialog } = useStepUp();
  const [requireMfa, setRequireMfa] = useState(initialRequireMfa);
  const [without, setWithout] = useState(membersWithoutMfa);
  const [saving, setSaving] = useState(false);

  async function toggle(next: boolean) {
    if (next) {
      const ok = await confirm({
        title: "Require two-factor sign-in for everyone?",
        description:
          without > 0
            ? `${without} active member${without === 1 ? "" : "s"} will be signed out and asked to set it up.`
            : "All active members already use it.",
        confirmLabel: "Require two-factor",
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const res = await withStepUp(() =>
        fetch("/api/admin/security-policy", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requireMfa: next }),
        }),
      );
      if (!res) return;
      const data = (await res.json().catch(() => null)) as { error?: string; requireMfa?: boolean; membersWithoutMfa?: number } | null;
      if (!res.ok) {
        toast.error(data?.error ?? "Couldn't update the policy. Try again.");
        return;
      }
      setRequireMfa(!!data?.requireMfa);
      if (typeof data?.membersWithoutMfa === "number") setWithout(data.membersWithoutMfa);
      const out = (data as { membersSignedOut?: number } | null)?.membersSignedOut ?? 0;
      toast.success(
        next
          ? `Two-factor sign-in required${out > 0 ? `. ${out} member${out === 1 ? "" : "s"} signed out.` : ""}`
          : "Two-factor sign-in optional",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card id="security-policy" data-testid="mfa-policy">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-[color:var(--mist-indigo)]" aria-hidden />
          Sign-in security
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <label htmlFor="require-mfa" className="text-sm font-medium">
              Require two-factor sign-in for all members
            </label>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Members without two-factor sign-in are signed out and must set it up.
              {" "}
              <span data-testid="members-without-mfa">
                {without === 0 ? "All active members have it." : `${without} active member${without === 1 ? "" : "s"} without it.`}
              </span>
            </p>
            {!selfHasMfa && !requireMfa && (
              <p className="text-[12px] text-[color:var(--mist-warn)]">
                Turn on two-factor sign-in for your account first in{" "}
                <Link href="/settings?tab=security" className="font-medium underline underline-offset-2">
                  Settings &gt; Security
                </Link>
                .
              </p>
            )}
          </div>
          <Switch
            id="require-mfa"
            aria-label="Require two-factor sign-in for all members"
            checked={requireMfa}
            disabled={saving}
            onCheckedChange={(v) => void toggle(v)}
          />
        </div>
      </CardContent>
      {dialog}
    </Card>
  );
}
