import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";
import { CONTACT_SELECT, phoneField } from "@/lib/escalation/contact-fields";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  title: z.string().max(100).nullable().optional(),
  email: z.string().max(LIMITS.EMAIL).email().nullable().optional().or(z.literal("")),
  phone: phoneField,
  alternatePhone: phoneField,
  tier: z.number().int().min(1).max(3).optional(),
  severityLevel: z.enum(["any", "high", "critical"]).optional(),
  role: z.enum(["technical", "executive", "legal", "pr", "vendor", "regulator", "other"]).optional(),
  notes: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  // Administrator confirmed the details out of band: stamps emailVerifiedAt
  // ("email"), phoneVerifiedAt ("phone") or both (true / "both") = now
  // (server-side; clients never send a date). Administrators only: a verified
  // phone may be paged by SMS/voice.
  markVerified: z.union([z.boolean(), z.enum(["email", "phone", "both"])]).optional(),
  // Optional link to an org member (null unlinks).
  userId: z.string().max(LIMITS.ID).nullable().optional(),
  // L7 toll-fraud override — administrators only (checked below).
  allowUnverifiedPhone: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const existing = await db.escalationContact.findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: { id: true, email: true, phone: true, alternatePhone: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = await parseJsonBody(req, updateSchema);
  if (!parsed.ok) return parsed.response;

  const isAdmin = session.user.role === "administrator";
  const { markVerified, ...fields } = parsed.data;
  // L7: the unverified-phone override and a manual "verified" stamp both open
  // SMS/voice to the number, so both are administrator-only (toll fraud).
  if ((fields.allowUnverifiedPhone !== undefined || markVerified) && !isAdmin) {
    return NextResponse.json(
      { error: "Only an administrator can verify a contact or allow SMS or voice to an unverified number.", code: "admin_only" },
      { status: 403 },
    );
  }
  if (fields.userId) {
    const member = await db.user.findFirst({
      where: { id: fields.userId, organizationId: session.user.organizationId, isActive: true },
      select: { id: true },
    });
    if (!member) return NextResponse.json({ error: "Linked member isn't in your organization." }, { status: 400 });
  }

  // A changed number is a NEW, unverified number: drop the phone verification
  // (and, unless an administrator is making the change, the override) so an
  // edit can't redirect pages to a number nobody confirmed. A changed email
  // drops only the email verification.
  const phoneChanged =
    (fields.phone !== undefined && fields.phone !== existing.phone) ||
    (fields.alternatePhone !== undefined && fields.alternatePhone !== existing.alternatePhone);
  const emailChanged = fields.email !== undefined && (fields.email || null) !== (existing.email ?? null);
  const now = new Date();
  const markEmail = markVerified === true || markVerified === "both" || markVerified === "email";
  const markPhone = markVerified === true || markVerified === "both" || markVerified === "phone";
  const updated = await db.escalationContact.update({
    where: { id },
    data: {
      ...fields,
      ...(emailChanged ? { emailVerifiedAt: null, verificationTokenHash: null, verificationSentAt: null } : {}),
      ...(phoneChanged ? { phoneVerifiedAt: null, phoneVerificationTokenHash: null, phoneVerificationSentAt: null } : {}),
      ...(phoneChanged && !isAdmin ? { allowUnverifiedPhone: false } : {}),
      ...(markEmail ? { emailVerifiedAt: now } : {}),
      ...(markPhone ? { phoneVerifiedAt: now } : {}),
    },
    select: CONTACT_SELECT,
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const existing = await db.escalationContact.findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.escalationContact.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
