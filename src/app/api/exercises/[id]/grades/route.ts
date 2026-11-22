// POST /api/exercises/{id}/grades   {responseId, score 0-4, rating, rationale} evaluator grade (control)
// Same handler as /document/grades: Playbook Exercise entries and Crisis Sim written deliverables.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export { POST } from "../document/grades/route";
