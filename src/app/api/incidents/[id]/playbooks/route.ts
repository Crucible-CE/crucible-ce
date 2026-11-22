import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseJsonBody } from "@/lib/http/parse-body";
import { playbookErrorResponse, playbookGate } from "@/lib/incident/playbooks/http";
import { attachPlaybook, listRuns } from "@/lib/incident/playbooks/service";
import { rankPlaybookDocuments } from "@/lib/incident/playbooks/suggest";
import { ensureExerciseLibrary } from "@/lib/exercise/library";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function sectionHeadings(sections: unknown): string[] {
  if (!Array.isArray(sections)) return [];
  return sections.map((s) => (s && typeof s === "object" && typeof (s as { heading?: unknown }).heading === "string" ? (s as { heading: string }).heading : "")).filter(Boolean);
}

// GET /api/incidents/[id]/playbooks: the runs on this incident, the
// organization's playbook documents, and rule-based suggestions among them.
export async function GET(_req: Request, context: RouteContext) {
  const { id } = await context.params;
  const g = await playbookGate(id, "read");
  if (!g.ok) return g.response;
  const { gate } = g;
  // The shipped library playbooks are seeded on first use, as on Documents.
  await ensureExerciseLibrary();

  const [runs, docs] = await Promise.all([
    listRuns(id),
    db.sourceDocument.findMany({
      where: { organizationId: gate.organizationId, kind: "playbook" },
      orderBy: [{ scope: "desc" }, { title: "asc" }],
      take: 300,
      select: { id: true, title: true, text: true, scope: true, collection: true, sections: true },
    }),
  ]);
  const attached = new Set(runs.map((r) => r.documentId));
  const tags = Array.isArray(gate.incident.mitreJson) ? gate.incident.mitreJson.filter((t): t is string => typeof t === "string") : [];
  const suggestions = rankPlaybookDocuments(
    { title: gate.incident.title, description: gate.incident.description, category: gate.incident.category, tags },
    docs.filter((d) => !attached.has(d.id)).map((d) => ({ id: d.id, title: d.title, text: d.text, scope: d.scope, collection: d.collection, headings: sectionHeadings(d.sections) })),
  ).slice(0, 5);

  return NextResponse.json(
    {
      canEdit: gate.canEdit,
      runs,
      suggestions,
      documents: docs.map((d) => ({ id: d.id, title: d.title, scope: d.scope, collection: d.collection, attached: attached.has(d.id) })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

const postSchema = z.object({ documentId: z.string().min(1).max(64) });

// POST /api/incidents/[id]/playbooks: attach a playbook document as a checklist.
export async function POST(req: Request, context: RouteContext) {
  const { id } = await context.params;
  const g = await playbookGate(id, "write");
  if (!g.ok) return g.response;
  const parsed = await parseJsonBody(req, postSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const runId = await attachPlaybook({ incidentId: id, organizationId: g.gate.organizationId, documentId: parsed.data.documentId, actor: g.gate.actor });
    return NextResponse.json({ runId }, { status: 201 });
  } catch (e) {
    return playbookErrorResponse(e);
  }
}
