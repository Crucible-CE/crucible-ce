"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ClipboardSignature, Loader2, Save, UserPlus, CheckCircle2, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AssignUserModal } from "@/components/incident/assign-user-modal";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { useFormDirty } from "@/hooks/use-form-dirty";
import { useIncidentShell } from "@/components/incident/incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";
import { CloudSeam } from "@/components/cloud/cloud-seam";

// Business Impact + Shift Handover. Extracted into a component so it lives in
// the SITREP tab (Status merged into SITREP) and still backs its own route.

interface BusinessImpact {
  affectedServices?: string[];
  impactDimensions?: string[];
  operationalStatus?: string;
  customerImpactLevel?: string;
  financialImpactLevel?: string;
  notes?: string;
}

interface Handover {
  id: string;
  fromUserName: string | null;
  toLabel: string | null;
  summary: string;
  openItems: string | null;
  status: string;
  acceptedByName: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

const IMPACT_DIMENSIONS = ["Operational", "Financial", "Reputational", "Regulatory / Legal", "Customer / Safety", "Data Loss"];
const OPERATIONAL_STATUS = ["Fully operational", "Degraded", "Partial outage", "Full outage"];
const CUSTOMER_LEVELS = ["None", "< 100", "100 – 10k", "10k – 1M", "> 1M"];
const FINANCIAL_LEVELS = ["None / unknown", "< $10k", "$10k – $100k", "$100k – $1M", "> $1M"];
const COMMON_SERVICES = ["Website", "Customer Portal", "Checkout / Payments", "Email", "Internal Apps", "API", "Mobile App", "Data Warehouse", "Active Directory", "VPN"];

export function StatusPanels({ incidentId }: { incidentId: string }) {
  const id = incidentId;
  const { readOnly } = useIncidentShell();
  const [dimensions, setDimensions] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [customService, setCustomService] = useState("");
  const [operationalStatus, setOperationalStatus] = useState("");
  const [customerLevel, setCustomerLevel] = useState("");
  const [financialLevel, setFinancialLevel] = useState("");
  const [impactNotes, setImpactNotes] = useState("");
  const [savingImpact, setSavingImpact] = useState(false);

  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [summary, setSummary] = useState("");
  const [openItems, setOpenItems] = useState("");
  const [toUserId, setToUserId] = useState<string | null>(null);
  const [toUserName, setToUserName] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  // Baseline for the impact form — reset on load and after each save.
  const impactBaselineRef = useRef<BusinessImpact | null>(null);

  const load = useCallback(async () => {
    const [incRes, hoRes] = await Promise.all([fetch(`/api/incidents/${id}`), fetch(`/api/incidents/${id}/handover`)]);
    if (incRes.ok) {
      const inc = await incRes.json();
      const bi: BusinessImpact = inc.businessImpactJson ?? {};
      setDimensions(bi.impactDimensions ?? []);
      setServices(bi.affectedServices ?? []);
      setOperationalStatus(bi.operationalStatus ?? "");
      setCustomerLevel(bi.customerImpactLevel ?? "");
      setFinancialLevel(bi.financialImpactLevel ?? "");
      setImpactNotes(bi.notes ?? "");
      impactBaselineRef.current = {
        impactDimensions: bi.impactDimensions ?? [],
        affectedServices: bi.affectedServices ?? [],
        operationalStatus: bi.operationalStatus ?? "",
        customerImpactLevel: bi.customerImpactLevel ?? "",
        financialImpactLevel: bi.financialImpactLevel ?? "",
        notes: bi.notes ?? "",
      };
    }
    if (hoRes.ok) setHandovers((await hoRes.json()).handovers ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Unsaved-work guard: dirty when the impact form diverges from its
  // saved baseline OR an unsent handover draft exists.
  const impactDirty = useFormDirty(
    {
      impactDimensions: dimensions,
      affectedServices: services,
      operationalStatus,
      customerImpactLevel: customerLevel,
      financialImpactLevel: financialLevel,
      notes: impactNotes,
    },
    loading ? null : impactBaselineRef.current,
  );
  const isDirty = impactDirty || summary.trim().length > 0 || openItems.trim().length > 0;
  useUnsavedChangesGuard(isDirty, {
    message: "You have unsaved impact or handover changes.",
  });

  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const saveImpact = async () => {
    setSavingImpact(true);
    try {
      const res = await fetch(`/api/incidents/${id}/business-impact`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ impactDimensions: dimensions, affectedServices: services, operationalStatus, customerImpactLevel: customerLevel, financialImpactLevel: financialLevel, notes: impactNotes.trim() }),
      });
      if (res.ok) {
        // Re-anchor the baseline so the unsaved-work guard goes inert.
        impactBaselineRef.current = {
          impactDimensions: dimensions,
          affectedServices: services,
          operationalStatus,
          customerImpactLevel: customerLevel,
          financialImpactLevel: financialLevel,
          notes: impactNotes.trim(),
        };
        setImpactNotes(impactNotes.trim());
        toast.success("Business impact saved");
      } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't save. Try again."));
    } finally {
      setSavingImpact(false);
    }
  };

  const submit = async () => {
    if (!summary.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/incidents/${id}/handover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: summary.trim(), openItems: openItems.trim() || undefined, toUserId: toUserId ?? undefined }),
      });
      if (res.ok) {
        setSummary("");
        setOpenItems("");
        setToUserId(null);
        setToUserName(null);
        await load();
        toast.success(toUserId ? "Handover sent. Incoming responder paged." : "Handover recorded");
      } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't record handover. Try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const accept = async (handoverId: string) => {
    const res = await fetch(`/api/incidents/${id}/handover/${handoverId}/accept`, { method: "POST" });
    if (res.ok) {
      await load();
      toast.success("Handover accepted");
    } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't accept. Try again."));
  };

  if (loading) {
    return <div className="h-40 animate-pulse rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-muted)]/30" />;
  }

  const chip = (on: boolean) =>
    cn("rounded-[var(--radius-sm)] border px-2 py-1 text-[11.5px] transition-colors", on ? "border-[color:var(--mist-indigo)]/50 bg-[color:var(--mist-indigo-soft)] text-[color:var(--mist-indigo)]" : "border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-muted)]");
  const field = "h-9 w-full rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2.5 text-[13px]";

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="min-w-0 rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-[color:var(--mist-danger)]" />
          <h2 className="text-sm font-semibold">Business impact</h2>
        </div>
        {/* Read-only viewers see the saved impact with every control disabled. */}
        <fieldset disabled={readOnly} className="min-w-0 space-y-3">
          <div>
            <label className="mb-1.5 block text-[11px] font-medium">Impact dimensions</label>
            <div className="flex flex-wrap gap-1.5">
              {IMPACT_DIMENSIONS.map((d) => (
                <button key={d} type="button" onClick={() => toggle(dimensions, setDimensions, d)} className={chip(dimensions.includes(d))}>{d}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium">Operational status</label>
              <select value={operationalStatus} onChange={(e) => setOperationalStatus(e.target.value)} className={field}>
                <option value="">Select</option>
                {OPERATIONAL_STATUS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium">Customers affected</label>
              <select value={customerLevel} onChange={(e) => setCustomerLevel(e.target.value)} className={field}>
                <option value="">Select</option>
                {CUSTOMER_LEVELS.map((o) => <option key={o} value={o}>{o.replace(/ – /g, " to ")}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium">Financial impact</label>
              <select value={financialLevel} onChange={(e) => setFinancialLevel(e.target.value)} className={field}>
                <option value="">Select</option>
                {FINANCIAL_LEVELS.map((o) => <option key={o} value={o}>{o.replace(/ – /g, " to ")}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-medium">Affected services</label>
            <div className="flex flex-wrap gap-1.5">
              {Array.from(new Set([...COMMON_SERVICES, ...services])).map((sv) => (
                <button key={sv} type="button" onClick={() => toggle(services, setServices, sv)} className={chip(services.includes(sv))}>{sv}</button>
              ))}
            </div>
            {!readOnly && <div className="mt-1.5 flex gap-1.5">
              <input value={customService} onChange={(e) => setCustomService(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && customService.trim()) { setServices([...services, customService.trim()]); setCustomService(""); } }} placeholder="Add a service" className="h-7 flex-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 text-[12px]" />
            </div>}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium">Notes</label>
            <textarea value={impactNotes} onChange={(e) => setImpactNotes(e.target.value)} rows={2} className="w-full rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2.5 py-2 text-[13px]" />
          </div>
          {!readOnly && (
            <button type="button" onClick={saveImpact} disabled={savingImpact} className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[color:var(--mist-indigo)] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-60">
              {savingImpact ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save impact
            </button>
          )}
        </fieldset>
      </section>

      <section className="min-w-0 rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
        <div className="mb-3 flex items-center gap-2">
          <ClipboardSignature className="h-4 w-4 text-[color:var(--mist-indigo)]" />
          <h2 className="text-sm font-semibold">Shift handover</h2>
        </div>
        {!readOnly && <div className="mb-3 space-y-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] p-2.5">
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="Current state and what changed" className="w-full rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2.5 py-2 text-[13px]" />
          <textarea value={openItems} onChange={(e) => setOpenItems(e.target.value)} rows={2} placeholder="Open items" className="w-full rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2.5 py-2 text-[13px]" />
          <CloudSeam feature="handover-drafting" />
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPicking(true)} className={`flex min-w-0 flex-1 items-center gap-1.5 ${field}`}>
              <UserPlus className="h-3.5 w-3.5 shrink-0 text-[color:var(--mist-indigo)]" />
              <span className="truncate">{toUserName ?? "Hand over to (they get paged)"}</span>
            </button>
            <button type="button" onClick={submit} disabled={submitting || !summary.trim()} className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] bg-[color:var(--mist-indigo)] px-3 text-[13px] font-semibold text-white disabled:opacity-50">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
            </button>
          </div>
        </div>}
        {handovers.length === 0 ? (
          <p className="py-4 text-center text-xs text-[color:var(--color-muted-foreground)]">No handovers.</p>
        ) : (
          <ul className="space-y-2">
            {handovers.map((h) => (
              <li key={h.id} className="rounded-[var(--radius-md)] border border-[color:var(--color-border)] p-2.5">
                <div className="mb-1 flex items-center justify-between gap-2 text-[10.5px] text-[color:var(--color-muted-foreground)]">
                  <span>{h.fromUserName ?? "Unknown"}{h.toLabel ? ` → ${h.toLabel}` : ""}</span>
                  <span>{new Date(h.createdAt).toLocaleString()}</span>
                </div>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{h.summary}</p>
                {h.openItems && <p className="mt-1 whitespace-pre-wrap text-[11.5px] text-[color:var(--color-muted-foreground)]"><span className="font-medium">Open: </span>{h.openItems}</p>}
                <div className="mt-2">
                  {h.status === "accepted" ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[color:var(--mist-ok)]">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Accepted by {h.acceptedByName ?? "responder"}{h.acceptedAt ? ` · ${new Date(h.acceptedAt).toLocaleString()}` : ""}
                    </span>
                  ) : readOnly ? (
                    <span className="text-[11px] text-[color:var(--color-muted-foreground)]">Awaiting acceptance</span>
                  ) : (
                    <button type="button" onClick={() => accept(h.id)} className="rounded-[var(--radius-sm)] bg-[color:var(--mist-ok)] px-2.5 py-1 text-[11px] font-semibold text-white">Accept handover</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AssignUserModal open={picking} onClose={() => setPicking(false)} title="Hand over to" onSelect={(userId, member) => { setToUserId(userId); setToUserName(member ? (member.name ?? member.email) : null); }} />
    </div>
  );
}
