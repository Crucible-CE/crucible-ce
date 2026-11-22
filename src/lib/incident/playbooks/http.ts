// Route guards for the incident Playbooks tab. Reading needs incidents.view
// and access to the incident (lock rules included). Changing a run needs
// incidents.edit and a writable incident (a locked incident: the incident
// commander and administrators only).

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import { findAccessibleIncident } from "@/lib/incident/access";
import { assertIncidentWritable, isIncidentReadOnlyFor } from "@/lib/incident/lock";
import { PlaybookRunError, type RunActor } from "./service";

export interface PlaybookGate {
  organizationId: string;
  actor: RunActor;
  incident: { id: string; title: string; description: string; category: string | null; mitreJson: unknown; restricted: boolean };
  canEdit: boolean;
}

type GateResult = { ok: true; gate: PlaybookGate } | { ok: false; response: NextResponse };

export async function playbookGate(incidentId: string, mode: "read" | "write"): Promise<GateResult> {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const perm = mode === "write" ? "incidents.edit" : "incidents.view";
  if (!hasPermission(session.user, perm)) return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const incident = await findAccessibleIncident(session.user, incidentId, { id: true, title: true, description: true, category: true, mitreJson: true, restricted: true });
  if (!incident) return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (mode === "write") {
    const locked = await assertIncidentWritable(session.user, incident);
    if (locked) return { ok: false, response: locked };
  }
  const canEdit = hasPermission(session.user, "incidents.edit") && (mode === "write" || !(await isIncidentReadOnlyFor(session.user, incident)));
  return {
    ok: true,
    gate: {
      organizationId: session.user.organizationId,
      actor: { id: session.user.id, name: session.user.name ?? session.user.email ?? null },
      incident,
      canEdit,
    },
  };
}

/** Map a service error to its response; rethrow anything else. */
export function playbookErrorResponse(e: unknown): NextResponse {
  if (e instanceof PlaybookRunError) return NextResponse.json({ error: e.message }, { status: e.status });
  throw e;
}
