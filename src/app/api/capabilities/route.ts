// Capabilities for the instance's capability framework. Reads the Capability
// table and falls back to the built-in list when the table has none.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/exercise/auth/session";
import { listCapabilities } from "@/lib/exercise/content/capabilities";
import { getExerciseSettings } from "@/lib/exercise/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const a = await requireUser();
  if (!a.ok) return a.response;
  const instance = await getExerciseSettings();
  const framework = instance?.capabilityFramework ?? "nist-csf";
  const rows = await db.capability.findMany({
    where: { framework, isActive: true },
    orderBy: [{ seq: "asc" }, { key: "asc" }],
    select: { key: true, name: true, description: true },
  });
  const capabilities = rows.length
    ? rows.map((r) => ({ key: r.key, name: r.name, description: r.description ?? "" }))
    : listCapabilities(framework).map((c) => ({ key: c.key, name: c.name, description: c.description }));
  return NextResponse.json({ framework, capabilities });
}
