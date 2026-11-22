"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Phone,
  Plus,
  Pencil,
  Trash2,
  Mail,
  Shield,
  Building2,
  Landmark,
  Siren,
  Stethoscope,
  Upload,
  Download,
  List,
  Network,
  BookOpen,
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataValue } from "@/components/ui/data-value";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { downloadVCards } from "@/lib/escalation/io";
import { CsvImportDialog } from "@/components/escalation/csv-import";
import { DirectoryPicker } from "@/components/escalation/directory-picker";

// React Flow is bulky — load only when the chart view is opened.
const EscalationChart = dynamic(() => import("@/components/escalation/escalation-chart"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[640px] items-center justify-center rounded-xl bg-[color:var(--color-card)] shadow-[var(--elevation-1)]">
      <span className="text-[12px] text-[color:var(--color-muted-foreground)]">Loading chart...</span>
    </div>
  ),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EscalationContact {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  alternatePhone: string | null;
  tier: number;
  severityLevel: string;
  role: string;
  notes: string | null;
  isActive: boolean;
  sortOrder: number;
  /** ISO: the email was confirmed (emailed link, or an administrator). */
  emailVerifiedAt?: string | null;
  /** ISO: the phone was confirmed (SMS link, or an administrator). Opens SMS/voice. */
  phoneVerifiedAt?: string | null;
  /** Linked org member (gets app push for pages). */
  userId?: string | null;
  /** Administrator override: SMS/voice even though the number is unverified. */
  allowUnverifiedPhone?: boolean;
  updatedAt?: string;
  /** Reader role: the API withholds email / phones / notes. */
  detailsHidden?: boolean;
}

type ContactRole = "technical" | "executive" | "legal" | "pr" | "vendor" | "regulator" | "other";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Keys match the Zod constraint in /api/escalation-contacts (POST/PATCH)
// which validates tier as z.number().int().min(1).max(3). Both sides
// stay in sync — if a new tier is added there, add it here too.
const TIER_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: "Tier 1: Primary", color: "text-[color:var(--mist-danger)] bg-[color:var(--mist-danger)]/10 border-[color:var(--mist-danger)]/20" },
  2: { label: "Tier 2: Secondary", color: "text-orange-700 dark:text-orange-400 bg-orange-400/10 border-orange-400/20" },
  3: { label: "Tier 3: Escalation", color: "text-[color:var(--mist-warn)] bg-[color:var(--mist-warn)]/10 border-[color:var(--mist-warn)]/20" },
};

const ROLE_LABELS: Record<ContactRole, string> = {
  technical: "Technical", executive: "Executive", legal: "Legal / Counsel",
  pr: "Communications / PR", vendor: "Vendor / MSSP", regulator: "Regulator",
  other: "Other",
};

const SEVERITY_LABELS: Record<string, string> = {
  any: "All incidents", high: "High+", critical: "Critical only",
};

const DEFAULT_FORM = {
  name: "", title: "", email: "", phone: "", alternatePhone: "",
  tier: 1, severityLevel: "any" as string, role: "technical" as ContactRole, notes: "",
  userId: "" as string, allowUnverifiedPhone: false,
};

const NO_MEMBER = "__none__";
const TOLL_FRAUD_WARNING =
  "Unverified numbers risk toll fraud. Only allow a number you have confirmed yourself.";

interface OrgMember { id: string; name: string | null; email: string }

// ---------------------------------------------------------------------------
// Contact form dialog
// ---------------------------------------------------------------------------

interface ContactDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: (c: EscalationContact) => void;
  editing?: EscalationContact | null;
  /** Administrators may waive phone verification (L7). */
  isAdmin: boolean;
}

function ContactDialog({ open, onClose, onSaved, editing, isAdmin }: ContactDialogProps) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/org-members")
      .then((r) => (r.ok ? r.json() : []))
      .then((m: OrgMember[]) => { if (!cancelled) setMembers(Array.isArray(m) ? m : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        name: editing.name, title: editing.title ?? "", email: editing.email ?? "",
        phone: editing.phone ?? "", alternatePhone: editing.alternatePhone ?? "",
        tier: editing.tier, severityLevel: editing.severityLevel,
        role: editing.role as ContactRole, notes: editing.notes ?? "",
        userId: editing.userId ?? "", allowUnverifiedPhone: !!editing.allowUnverifiedPhone,
      });
    } else { setForm(DEFAULT_FORM); }
    setError(null);
  }, [open, editing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/escalation-contacts/${editing.id}` : "/api/escalation-contacts", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactBody(form, isAdmin)),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; details?: { fieldErrors?: Record<string, string[]> } };
        const fieldMsg = data.details?.fieldErrors ? Object.values(data.details.fieldErrors).flat()[0] : undefined;
        setError(fieldMsg ?? data.error ?? "Couldn't save. Try again.");
        return;
      }
      onSaved(await res.json());
      onClose();
    } catch { setError("Couldn't reach the server. Try again."); }
    finally { setSaving(false); }
  };

  const f = <K extends keyof typeof form>(k: K) => (v: typeof form[K]) => setForm((s) => ({ ...s, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent aria-describedby={undefined} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit contact" : "Add contact"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ec-name">Name *</Label>
              <Input id="ec-name" value={form.name} onChange={(e) => f("name")(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-title">Title</Label>
              <Input id="ec-title" value={form.title} onChange={(e) => f("title")(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ec-email">Email</Label>
              <Input id="ec-email" type="email" value={form.email} onChange={(e) => f("email")(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-phone">Phone</Label>
              <Input id="ec-phone" value={form.phone} onChange={(e) => f("phone")(e.target.value)} placeholder="+15551234567" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ec-altphone">Alternate phone</Label>
            <Input id="ec-altphone" value={form.alternatePhone} onChange={(e) => f("alternatePhone")(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Tier</Label>
              <Select value={String(form.tier)} onValueChange={(v) => f("tier")(parseInt(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Tier 1: Primary</SelectItem>
                  <SelectItem value="2">Tier 2: Secondary</SelectItem>
                  <SelectItem value="3">Tier 3: Escalation</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => f("role")(v as ContactRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notify on</Label>
              <Select value={form.severityLevel} onValueChange={f("severityLevel")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">All incidents</SelectItem>
                  <SelectItem value="high">High+</SelectItem>
                  <SelectItem value="critical">Critical only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Linked member</Label>
            <Select value={form.userId || NO_MEMBER} onValueChange={(v) => f("userId")(v === NO_MEMBER ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Not linked" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_MEMBER}>Not linked (external)</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name ?? m.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
              Linked members also get in-app pages.
            </p>
          </div>
          {isAdmin && (
            <div className="space-y-1.5 rounded-md border border-[color:var(--mist-warn)]/30 bg-[color:var(--mist-warn)]/5 p-2.5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="ec-allow-unverified" className="flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-[color:var(--mist-warn)]" />
                  Allow SMS/voice before verification
                </Label>
                <Switch
                  id="ec-allow-unverified"
                  checked={form.allowUnverifiedPhone}
                  onCheckedChange={(v) => f("allowUnverifiedPhone")(!!v)}
                />
              </div>
              <p className="text-[11px] leading-snug text-[color:var(--color-muted-foreground)]">{TOLL_FRAUD_WARNING}</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ec-notes">Notes</Label>
            <Input id="ec-notes" value={form.notes} onChange={(e) => f("notes")(e.target.value)}
              placeholder="Preferred contact method, availability" />
          </div>
          {error && <p className="text-[12px] text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving..." : editing ? "Save" : "Add contact"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Contact card
// ---------------------------------------------------------------------------

function ContactCard({ contact, onEdit, onDelete, onVerified, isAdmin }: {
  contact: EscalationContact;
  onEdit: () => void;
  onDelete: () => void;
  onVerified: (updated: EscalationContact) => void;
  isAdmin: boolean;
}) {
  const tierCfg = TIER_LABELS[contact.tier];
  const [verifying, setVerifying] = useState(false);
  const hasEmail = Boolean(contact.email) || Boolean(contact.detailsHidden && contact.emailVerifiedAt);
  const hasPhone = Boolean(contact.phone || contact.alternatePhone) || Boolean(contact.detailsHidden);
  const emailStatus = stalenessOf(contact.emailVerifiedAt ?? null, "Email");
  const phoneStatus = stalenessOf(contact.phoneVerifiedAt ?? null, "Phone");

  async function markVerified(channel: "email" | "phone") {
    setVerifying(true);
    try {
      const res = await fetch(`/api/escalation-contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markVerified: channel }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Couldn't mark verified. Try again.");
        return;
      }
      const updated = (await res.json()) as EscalationContact;
      onVerified(updated);
      toast.success(`${contact.name}: ${channel} marked verified`);
    } finally {
      setVerifying(false);
    }
  }
  const badgeVariant = (tone: "ok" | "warn" | "stale") => (tone === "ok" ? "success" : tone === "warn" ? "warning" : "destructive");

  return (
    <div className="rounded-lg bg-[color:var(--color-card)] px-3 py-2.5 shadow-[var(--elevation-1)] space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-[13px] font-semibold leading-tight truncate">{contact.name}</p>
            <Badge className={cn("text-[10px] px-1.5 py-0", tierCfg.color)}>{tierCfg.label}</Badge>
          </div>
          {contact.title && (
            <p className="text-[11px] text-[color:var(--color-muted-foreground)] truncate">{contact.title}</p>
          )}
        </div>
        <div className="flex gap-0.5 flex-shrink-0">
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onEdit}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onDelete}>
            <Trash2 className="h-3 w-3 text-[color:var(--color-muted-foreground)]" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">
        {contact.phone && (
          <a href={`tel:${contact.phone}`} className="flex items-center gap-1 hover:text-[color:var(--color-foreground)]">
            <Phone className="h-2.5 w-2.5" /> {contact.phone}
          </a>
        )}
        {contact.alternatePhone && (
          <a href={`tel:${contact.alternatePhone}`} className="flex items-center gap-1 hover:text-[color:var(--color-foreground)]">
            <Phone className="h-2.5 w-2.5" /> {contact.alternatePhone} (alt)
          </a>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}`} className="flex items-center gap-1 hover:text-[color:var(--color-foreground)]">
            <Mail className="h-2.5 w-2.5" /> {contact.email}
          </a>
        )}
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {ROLE_LABELS[contact.role as ContactRole] ?? contact.role}
        </Badge>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-[color:var(--color-muted-foreground)]">
          <Shield className="h-2 w-2 mr-0.5" />
          {SEVERITY_LABELS[contact.severityLevel] ?? contact.severityLevel}
        </Badge>
        {hasEmail && (
          <Badge variant={badgeVariant(emailStatus.tone)} className="text-[10px] px-1.5 py-0" title="Confirmed by email link or an administrator">
            <Mail className="h-2 w-2 mr-0.5" />
            {emailStatus.label}
          </Badge>
        )}
        {hasPhone && (
          <Badge variant={badgeVariant(phoneStatus.tone)} className="text-[10px] px-1.5 py-0" title="Confirmed by SMS link or an administrator">
            <Phone className="h-2 w-2 mr-0.5" />
            {phoneStatus.label}
          </Badge>
        )}
        {(contact.phone || contact.alternatePhone || contact.detailsHidden) && !contact.phoneVerifiedAt && (
          contact.allowUnverifiedPhone ? (
            <Badge variant="warning" className="text-[10px] px-1.5 py-0" title={TOLL_FRAUD_WARNING}>
              <ShieldAlert className="h-2 w-2 mr-0.5" />
              SMS/voice allowed unverified
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-[color:var(--color-muted-foreground)]" title="SMS and voice pages go only to verified numbers">
              SMS/voice off until verified
            </Badge>
          )
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-1 hairline-t pt-1.5">
        {isAdmin ? (
          <div className="flex flex-wrap items-center gap-1">
            {contact.email && (
              <Button
                variant="ghost"
                size="xs"
                className="h-6 px-1.5 text-[11px]"
                onClick={() => markVerified("email")}
                disabled={verifying}
                title="You confirmed this email yourself"
              >
                <CheckCircle2 className="h-3 w-3" />
                Mark email verified
              </Button>
            )}
            {contact.phone && (
              <Button
                variant="ghost"
                size="xs"
                className="h-6 px-1.5 text-[11px]"
                onClick={() => markVerified("phone")}
                disabled={verifying}
                title="You confirmed this number yourself. Turns on SMS and voice pages to it."
              >
                <CheckCircle2 className="h-3 w-3" />
                Mark phone verified
              </Button>
            )}
          </div>
        ) : (
          <span />
        )}
        <Button
          variant="ghost"
          size="xs"
          className="h-6 px-1.5 text-[11px]"
          onClick={() => exportSingleVCard(contact)}
          title="Download .vcf"
        >
          <Download className="h-3 w-3" />
          .vcf
        </Button>
      </div>

      {contact.notes && (
        <p className="text-[11px] text-[color:var(--color-muted-foreground)] hairline-t pt-1.5 leading-snug line-clamp-2">
          {contact.notes}
        </p>
      )}
    </div>
  );
}

/** Request body for create/edit. The override is sent only by administrators. */
function contactBody(form: typeof DEFAULT_FORM, isAdmin: boolean) {
  const { allowUnverifiedPhone, userId, ...rest } = form;
  return {
    ...rest,
    email: form.email || undefined,
    userId: userId || null,
    ...(isAdmin ? { allowUnverifiedPhone } : {}),
  };
}

function exportSingleVCard(c: EscalationContact) {
  downloadVCards(
    [
      {
        name: c.name,
        title: c.title,
        email: c.email,
        phone: c.phone,
        alternatePhone: c.alternatePhone,
        notes: c.notes,
      },
    ],
    `${c.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.vcf`,
  );
}

// Relative-time staleness label + tone for one channel's verified badge.
// Input is that channel's real timestamp (emailVerifiedAt / phoneVerifiedAt,
// set by the emailed / SMS link or an administrator); null = never verified.
function stalenessOf(iso: string | null, what: "Email" | "Phone"): { label: string; tone: "ok" | "warn" | "stale" } {
  if (!iso) return { label: `${what} never verified`, tone: "stale" };
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (days <= 30) return { label: days === 0 ? `${what} verified today` : `${what} verified ${days}d ago`, tone: "ok" };
  if (days <= 90) return { label: `${what} verified ${days}d ago`, tone: "warn" };
  return { label: `${what} verified ${days}d ago`, tone: "stale" };
}

const STALE_MS = 90 * 86_400_000;
const channelStale = (iso: string | null | undefined) => !iso || Date.now() - new Date(iso).getTime() > STALE_MS;

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function EscalationMatrixPage() {
  const confirm = useConfirm();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "administrator";
  const [contacts, setContacts] = useState<EscalationContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<EscalationContact | null>(null);
  // Phase 2 features
  const [viewMode, setViewMode] = useState<"list" | "chart">("list");
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [showDirectory, setShowDirectory] = useState(false);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/escalation-contacts");
      if (res.ok) setContacts(await res.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  const handleSaved = (contact: EscalationContact) => {
    setContacts((prev) => {
      const idx = prev.findIndex((c) => c.id === contact.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = contact; return n; }
      return [...prev, contact];
    });
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: "Remove this contact?",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/escalation-contacts/${id}`, { method: "DELETE" });
    if (res.ok) setContacts((prev) => prev.filter((c) => c.id !== id));
  };

  const openEdit = (c: EscalationContact) => { setEditing(c); setShowDialog(true); };
  const openCreate = () => { setEditing(null); setShowDialog(true); };

  // the verification campaign (tokenized one-click confirm emails to
  // every unverified/stale contact) was fully built server-side with no UI
  // caller. This button is the missing caller.
  const [campaignSending, setCampaignSending] = useState(false);
  const staleCount = contacts.filter((c) => {
    if (!c.isActive) return false;
    return (Boolean(c.email) && channelStale(c.emailVerifiedAt)) || (Boolean(c.phone) && channelStale(c.phoneVerifiedAt));
  }).length;

  async function sendVerificationCampaign() {
    setCampaignSending(true);
    try {
      const res = await fetch("/api/escalation-contacts/verify-campaign", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Couldn't send verification links. Try again.");
        return;
      }
      const { sent, failed, smsSent = 0, smsFailed = 0, staleCount, emailConfigured, smsConfigured } = (await res.json()) as {
        sent: number;
        failed?: number;
        smsSent?: number;
        smsFailed?: number;
        staleCount: number;
        emailConfigured?: boolean;
        smsConfigured?: boolean;
      };
      const smsNote = smsConfigured === false ? "No SMS set up, so phones can't be verified by text. An administrator can mark a phone verified." : "";
      if (emailConfigured === false && smsConfigured === false) {
        toast.error("No email or SMS set up. Nothing sent.", {
          description:
            staleCount > 0
              ? `${staleCount} contact${staleCount === 1 ? " needs" : "s need"} verification. Set up email or Twilio in Delivery settings.`
              : undefined,
        });
      } else if (staleCount === 0) {
        toast.success("All contacts verified in the last 90 days");
      } else if (sent + smsSent === 0) {
        toast.error(`Couldn't send verification links (${(failed ?? 0) + smsFailed} failed)`, { description: smsNote || undefined });
      } else {
        const parts = [
          sent ? `${sent} email${sent === 1 ? "" : "s"}` : "",
          smsSent ? `${smsSent} SMS` : "",
        ].filter(Boolean);
        const fails = (failed ?? 0) + smsFailed;
        toast.success(`Verification links sent: ${parts.join(", ")}` + (fails ? ` (${fails} failed)` : ""), {
          description: smsNote || undefined,
        });
      }
      await fetchContacts();
    } finally {
      setCampaignSending(false);
    }
  }

  // Group by tier
  const byTier = [1, 2, 3].map((tier) => ({
    tier, contacts: contacts.filter((c) => c.tier === tier),
  }));

  return (
    <div className="min-w-0 space-y-6">

      <header className="flex flex-wrap items-end justify-between gap-3 pb-4 hairline-b">
        <div className="space-y-1">
          <h1 className="headline">Escalation matrix</h1>
          <p className="text-[13px] leading-relaxed text-[color:var(--color-muted-foreground)] max-w-xl">
            Contacts by tier, plus external emergency lines.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowDirectory(true)}>
            <BookOpen className="h-4 w-4" />
            Add from directory
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowCsvImport(true)}>
            <Upload className="h-4 w-4" />
            Import CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportAllVCards(contacts)}
            disabled={contacts.length === 0}
          >
            <Download className="h-4 w-4" />
            Export .vcf
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={sendVerificationCampaign}
            disabled={campaignSending || contacts.length === 0}
            title="Send a confirm link to every contact not verified in 90 days, by email and SMS"
          >
            <ShieldCheck className="h-4 w-4" />
            {campaignSending ? "Sending..." : `Verify contacts${staleCount > 0 ? ` (${staleCount})` : ""}`}
          </Button>
          <Button onClick={openCreate} size="sm">
            <Plus className="h-4 w-4" />
            Add contact
          </Button>
        </div>
      </header>

      {contacts.some((c) => c.detailsHidden) && (
        <p className="rounded-[var(--radius-md)] border border-[color:var(--color-border)] px-3 py-2 text-[12px] text-[color:var(--color-muted-foreground)]">
          Readers cannot see phone numbers and emails.
        </p>
      )}

      {/* External emergency contacts — pinned at the top, always
          visible. Sector-agnostic defaults that every org should have
          ready. */}
      <ExternalEmergencyRow contacts={contacts} />

      {/* View toggle — list vs visual org chart */}
      <div className="flex items-center justify-between">
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "list" | "chart")}>
          <TabsList>
            <TabsTrigger value="list" className="gap-1.5">
              <List className="h-3.5 w-3.5" />
              List
            </TabsTrigger>
            <TabsTrigger value="chart" className="gap-1.5">
              <Network className="h-3.5 w-3.5" />
              Org chart
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-[11.5px] text-[color:var(--color-muted-foreground)]">
          {contacts.length} contact{contacts.length !== 1 ? "s" : ""} on file
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[color:var(--mist-indigo)] border-t-transparent" />
        </div>
      ) : contacts.length === 0 ? (
        <EmptyState
          icon={Phone}
          title="No escalation contacts yet"
          description="Add the people to call during an incident."
          action={
            <>
              <Button variant="outline" size="sm" onClick={() => setShowDirectory(true)}>
                <BookOpen className="h-4 w-4" />
                Add from directory
              </Button>
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                Add contact
              </Button>
            </>
          }
        />
      ) : viewMode === "chart" ? (
        <EscalationChart contacts={contacts} onEdit={openEdit} />
      ) : (
        <div className="space-y-6">
          {byTier.map(({ tier, contacts: tierContacts }) => {
            if (tierContacts.length === 0) return null;
            const cfg = TIER_LABELS[tier];
            return (
              <div key={tier}>
                <div className="flex items-center gap-2 mb-3">
                  <div className={cn("text-[11px] font-semibold px-2 py-1 rounded-md border", cfg.color)}>
                    {cfg.label}
                  </div>
                  <div className="flex-1 hairline-t" />
                  <span className="text-[12px] text-[color:var(--color-muted-foreground)]">
                    {tierContacts.length} contact{tierContacts.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {tierContacts.map((c) => (
                    <ContactCard
                      key={c.id}
                      contact={c}
                      onEdit={() => openEdit(c)}
                      onDelete={() => handleDelete(c.id)}
                      isAdmin={isAdmin}
                      onVerified={(updated) =>
                        setContacts((prev) =>
                          prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)),
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ContactDialog open={showDialog} onClose={() => setShowDialog(false)}
        onSaved={handleSaved} editing={editing} isAdmin={isAdmin} />

      <CsvImportDialog
        open={showCsvImport}
        onClose={() => setShowCsvImport(false)}
        onImported={fetchContacts}
      />
      <DirectoryPicker
        open={showDirectory}
        onClose={() => setShowDirectory(false)}
        existing={contacts.map((c) => ({ name: c.name, phone: c.phone }))}
        onAdded={fetchContacts}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// vCard bulk export helper. Wraps the lib helper with the org-aware
// contact shape used here.
// ---------------------------------------------------------------------------
function exportAllVCards(contacts: EscalationContact[]) {
  if (contacts.length === 0) return;
  downloadVCards(
    contacts.map((c) => ({
      name: c.name,
      title: c.title,
      email: c.email,
      phone: c.phone,
      alternatePhone: c.alternatePhone,
      notes: c.notes,
    })),
    `escalation-contacts-${new Date().toISOString().slice(0, 10)}.vcf`,
  );
}


// ---------------------------------------------------------------------------
// External emergency contacts — 4 always-visible cards across the top.
//
// Federal, local law enforcement, sector regulator, and your IR
// retainer / MSSP. Defaults are inert placeholders that any org can
// edit; values are read from existing escalation contacts tagged with
// role=regulator|vendor at tier 1, falling back to a "PROVIDE"
// instruction so authors know what to fill in.
// ---------------------------------------------------------------------------

interface EmergencyCard {
  key: string;
  title: string;
  icon: React.ReactNode;
  defaultBody: string;
  defaultPhone: string;
  matchRole: ContactRole;
}

const EMERGENCY_CARDS: EmergencyCard[] = [
  {
    key: "federal",
    title: "Federal cyber",
    icon: <Landmark className="h-4 w-4" />,
    defaultBody: "CISA · FBI Cyber Division · US-CERT incident reporting",
    defaultPhone: "1-888-282-0870 (CISA 24/7)",
    matchRole: "regulator",
  },
  {
    key: "law",
    title: "Local law enforcement",
    icon: <Siren className="h-4 w-4" />,
    defaultBody: "Local police non-emergency · FBI field office liaison",
    defaultPhone: "911 (emergency) · [PROVIDE local non-emergency #]",
    matchRole: "other",
  },
  {
    key: "regulator",
    title: "Sector regulator",
    icon: <Building2 className="h-4 w-4" />,
    defaultBody: "HHS OCR · SEC · NYDFS · FERC · NERC",
    defaultPhone: "[PROVIDE regulator hotline]",
    matchRole: "regulator",
  },
  {
    key: "retainer",
    title: "IR retainer / MSSP",
    icon: <Stethoscope className="h-4 w-4" />,
    defaultBody: "Incident response, forensics, ransomware negotiation",
    defaultPhone: "[PROVIDE retainer 24/7 line]",
    matchRole: "vendor",
  },
];

function ExternalEmergencyRow({ contacts }: { contacts: EscalationContact[] }) {
  // Pick the highest-tier active contact matching the role for each
  // card. Falls back to the placeholder defaults when nothing matches.
  function pick(role: ContactRole): EscalationContact | undefined {
    return contacts
      .filter((c) => c.isActive && c.role === role)
      .sort((a, b) => a.tier - b.tier || a.sortOrder - b.sortOrder)[0];
  }

  return (
    <section className="space-y-2">
      <div className="eyebrow inline-flex items-center gap-1.5">
        <Siren className="h-3 w-3 text-[color:var(--mist-danger)]" />
        External emergency
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {EMERGENCY_CARDS.map((card) => {
          const match = pick(card.matchRole);
          const phone = match?.phone ?? card.defaultPhone;
          const altPhone = match?.alternatePhone;
          const body = match ? (match.title || card.defaultBody) : card.defaultBody;
          return (
            <div
              key={card.key}
              className="min-w-0 rounded-xl bg-[color:var(--color-card)] p-4 shadow-[var(--elevation-1)]"
            >
              <div className="flex items-start gap-2">
                <div className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[color:color-mix(in_srgb,var(--mist-danger),transparent_88%)] text-[color:var(--mist-danger)]">
                  {card.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold leading-tight">{card.title}</div>
                  {match?.name && (
                    <div className="mt-0.5 text-[11.5px] text-[color:var(--color-foreground)]">
                      {match.name}
                    </div>
                  )}
                </div>
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-[color:var(--color-muted-foreground)]">
                {body}
              </p>
              <div className="mt-3 flex min-w-0 items-start gap-1.5 text-[12.5px] font-medium">
                <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--mist-indigo)]" />
                <a
                  href={`tel:${phone.replace(/[^0-9+]/g, "")}`}
                  className="min-w-0 [overflow-wrap:anywhere] hover:underline"
                >
                  <DataValue>{phone}</DataValue>
                </a>
              </div>
              {altPhone && (
                <div className="mt-1 ml-5 text-[11px] tabular-nums text-[color:var(--color-muted-foreground)]">
                  Alt {altPhone}
                </div>
              )}
              {match?.email && (
                <div className="mt-1 ml-5 truncate text-[11px] text-[color:var(--color-muted-foreground)]">
                  {match.email}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
