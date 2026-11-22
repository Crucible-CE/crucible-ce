import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { CONTACT_SELECT, phoneField, shapeContactForViewer } from "@/lib/escalation/contact-fields";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  title: z.string().max(100).optional(),
  email: z.string().max(LIMITS.EMAIL).email().optional().or(z.literal("")),
  phone: phoneField,
  alternatePhone: phoneField,
  tier: z.number().int().min(1).max(3).default(1),
  severityLevel: z.enum(["any", "high", "critical"]).default("any"),
  role: z.enum(["technical", "executive", "legal", "pr", "vendor", "regulator", "other"]),
  notes: z.string().max(500).optional(),
  sortOrder: z.number().int().min(-1_000_000).max(1_000_000).default(0),
  // Optional link to an org member (they then get app push for pages).
  userId: z.string().max(LIMITS.ID).nullable().optional(),
  // L7 toll-fraud override — administrators only (checked below).
  allowUnverifiedPhone: z.boolean().optional(),
});

export async function GET(_req: Request) {
  const session = await auth();
  if (!session?.user?.organizationId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.view"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const contacts = await db.escalationContact.findMany({
    where: { organizationId: session.user.organizationId, isActive: true },
    orderBy: [{ tier: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    select: CONTACT_SELECT,
  });

  // Readers see the matrix structure; phones / emails are contributor+.
  return NextResponse.json(contacts.map((c) => shapeContactForViewer(c, session.user)));
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // CSV import posts one row at a time, so the cap is generous.
  const rl = await checkRateLimit({ namespace: "escalation-contact:create", identifier: session.user.id, windowMs: 60 * 60_000, max: 500 });
  if (!rl.allowed) return NextResponse.json({ error: `Too many new contacts. Try again in ${rl.retryAfter}s.` }, { status: 429 });

  const parsed = await parseJsonBody(req, createSchema);
  if (!parsed.ok) return parsed.response;

  // L7: SMS/voice to an unverified number risks toll fraud; only an
  // administrator may waive verification for a contact.
  if (parsed.data.allowUnverifiedPhone !== undefined && session.user.role !== "administrator") {
    return NextResponse.json(
      { error: "Only an administrator can allow SMS or voice to an unverified number.", code: "admin_only" },
      { status: 403 },
    );
  }
  if (parsed.data.userId) {
    const member = await db.user.findFirst({
      where: { id: parsed.data.userId, organizationId: session.user.organizationId, isActive: true },
      select: { id: true },
    });
    if (!member) return NextResponse.json({ error: "Linked member isn't in your organization." }, { status: 400 });
  }

  const contact = await db.escalationContact.create({
    data: { ...parsed.data, organizationId: session.user.organizationId },
    select: CONTACT_SELECT,
  });

  return NextResponse.json(contact, { status: 201 });
}
