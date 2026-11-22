"use client";

// ---------------------------------------------------------------------------
// Escalation Chart — React Flow visual of the escalation path.
//
// Each tier becomes a horizontal row of nodes, with edges connecting
// tier N to tier N+1 to show "if no answer at tier 1, fall to tier 2".
// Nodes are read-only in v1; clicking opens the existing edit dialog
// via the onEdit callback. Layout is deterministic — no auto-layout
// engine, just tier-row positioning.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Phone, Mail, Pencil, ShieldCheck, ShieldAlert } from "lucide-react";

// Shape matches the page-level EscalationContact exactly so callbacks
// passed across the boundary (eg. onEdit) type-check without variance
// issues. Extra optional fields are tolerated but the required ones
// must align with the page.
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
  updatedAt?: string;
  emailVerifiedAt?: string | null;
  phoneVerifiedAt?: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  technical: "Technical",
  executive: "Executive",
  legal: "Legal",
  pr: "PR / Comms",
  vendor: "Vendor",
  regulator: "Regulator",
  other: "Other",
};

const STALE_DAYS = 90;
/** Stale when the email or the phone on file is unverified or verified > STALE_DAYS ago. */
function isStale(c: { email?: string | null; phone?: string | null; emailVerifiedAt?: string | null; phoneVerifiedAt?: string | null }): boolean {
  const old = (iso?: string | null) => !iso || Date.now() - new Date(iso).getTime() > STALE_DAYS * 86_400_000;
  return (Boolean(c.email) && old(c.emailVerifiedAt)) || (Boolean(c.phone) && old(c.phoneVerifiedAt));
}

interface ContactNodeData extends Record<string, unknown> {
  contact: EscalationContact;
  onEdit?: (c: EscalationContact) => void;
}

const TIER_COLORS: Record<number, { dot: string; rail: string }> = {
  1: { dot: "var(--mist-danger)", rail: "var(--mist-danger)" },
  2: { dot: "var(--mist-warn)", rail: "var(--mist-warn)" },
  3: { dot: "var(--mist-indigo)", rail: "var(--mist-indigo)" },
};

function ContactNode({ data }: NodeProps) {
  const { contact, onEdit } = data as ContactNodeData;
  const tone = TIER_COLORS[contact.tier] ?? TIER_COLORS[3];
  const stale = isStale(contact);
  return (
    <div
      className="group relative w-[270px] rounded-xl bg-[color:var(--color-card)] p-3 shadow-[var(--elevation-1)]"
      style={{ borderLeft: `3px solid ${tone.rail}` }}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-[color:var(--mist-indigo)]" />
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-[color:var(--mist-indigo)]" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone.dot }} />
            <span className="truncate text-[13px] font-semibold leading-tight">{contact.name}</span>
          </div>
          {contact.title && (
            <div className="mt-0.5 truncate text-[11.5px] text-[color:var(--color-muted-foreground)]">{contact.title}</div>
          )}
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={() => onEdit(contact)}
            className="nodrag rounded-md p-1 text-[color:var(--color-muted-foreground)] opacity-0 transition-opacity hover:bg-[color:var(--color-muted)] hover:text-[color:var(--color-foreground)] group-hover:opacity-100"
            aria-label="Edit contact"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em]" style={{ background: `color-mix(in srgb, ${tone.rail}, transparent 90%)`, color: tone.rail }}>
          Tier {contact.tier}
        </span>
        <span className="rounded-full bg-[color:var(--color-muted)] px-2 py-0.5 text-[10px] font-medium capitalize text-[color:var(--color-muted-foreground)]">
          {ROLE_LABELS[contact.role] ?? contact.role}
        </span>
        <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${stale ? "bg-[color:var(--mist-warn)]/15 text-[color:var(--mist-warn)]" : "bg-[color:var(--mist-ok)]/15 text-[color:var(--mist-ok)]"}`}>
          {stale ? <ShieldAlert className="h-2.5 w-2.5" /> : <ShieldCheck className="h-2.5 w-2.5" />}
          {stale ? "Verify" : "Verified"}
        </span>
      </div>

      <div className="mt-2 space-y-1 text-[11.5px]">
        {contact.phone && (
          <a href={`tel:${contact.phone}`} className="nodrag flex items-center gap-1.5 text-[color:var(--color-muted-foreground)] hover:text-[color:var(--mist-indigo)]">
            <Phone className="h-3 w-3" />
            <span className="tabular-nums">{contact.phone}</span>
          </a>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}`} className="nodrag flex items-center gap-1.5 text-[color:var(--color-muted-foreground)] hover:text-[color:var(--mist-indigo)]">
            <Mail className="h-3 w-3" />
            <span className="truncate">{contact.email}</span>
          </a>
        )}
      </div>
    </div>
  );
}

const nodeTypes = { contact: ContactNode };

interface Props {
  contacts: EscalationContact[];
  onEdit?: (c: EscalationContact) => void;
}

export default function EscalationChart({ contacts, onEdit }: Props) {
  const { nodes, edges } = useMemo(() => buildLayout(contacts, onEdit), [contacts, onEdit]);

  return (
    <div className="h-[640px] rounded-xl bg-[color:var(--color-card)] shadow-[var(--elevation-1)]">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.4}
          maxZoom={1.4}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} color="var(--mist-hairline)" />
          <Controls showInteractive={false} className="!rounded-md !border-0 !bg-[color:var(--color-card)] !shadow-[var(--elevation-1)]" />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

function buildLayout(contacts: EscalationContact[], onEdit?: (c: EscalationContact) => void): {
  nodes: Node[];
  edges: Edge[];
} {
  const active = contacts.filter((c) => c.isActive);
  const byTier: Record<number, EscalationContact[]> = { 1: [], 2: [], 3: [] };
  for (const c of active) {
    const t = c.tier === 1 || c.tier === 2 || c.tier === 3 ? c.tier : 3;
    byTier[t].push(c);
  }

  const NODE_W = 280;
  const NODE_GAP_X = 24;
  const TIER_GAP_Y = 200;

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (const tier of [1, 2, 3] as const) {
    const list = byTier[tier];
    if (list.length === 0) continue;
    const rowWidth = list.length * NODE_W + (list.length - 1) * NODE_GAP_X;
    const startX = -rowWidth / 2;
    list.forEach((c, idx) => {
      nodes.push({
        id: c.id,
        type: "contact",
        position: { x: startX + idx * (NODE_W + NODE_GAP_X), y: (tier - 1) * TIER_GAP_Y },
        data: { contact: c, onEdit },
        draggable: true,
      });
    });
  }

  // Edges: each tier-N node connects to all tier-(N+1) nodes to show
  // the fan-out fallback path. Subtle styling so the visual doesn't
  // get noisy when there are 6+ contacts per tier.
  for (const fromTier of [1, 2] as const) {
    const toTier = (fromTier + 1) as 2 | 3;
    for (const from of byTier[fromTier]) {
      for (const to of byTier[toTier]) {
        edges.push({
          id: `${from.id}->${to.id}`,
          source: from.id,
          target: to.id,
          animated: false,
          style: { stroke: "var(--mist-hairline)", strokeWidth: 1.5 },
        });
      }
    }
  }

  return { nodes, edges };
}
