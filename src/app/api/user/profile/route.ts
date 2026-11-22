import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseJsonBody } from "@/lib/http/parse-body";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  // Empty string clears it.
  jobTitle: z.string().trim().max(100).optional(),
  image: z
    .string()
    .url()
    .startsWith("https://", { message: "Image URL must use HTTPS." })
    .max(500)
    .optional(),
});

const SELECT = { id: true, name: true, jobTitle: true, image: true } as const;

// GET /api/user/profile — the caller's own profile fields.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: SELECT });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(user, { headers: { "Cache-Control": "no-store" } });
}

// PATCH /api/user/profile
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody(req, updateSchema);
  if (!parsed.ok) return parsed.response;
  const { jobTitle, ...rest } = parsed.data;

  const updated = await db.user.update({
    where: { id: session.user.id },
    data: { ...rest, ...(jobTitle !== undefined ? { jobTitle: jobTitle || null } : {}) },
    select: SELECT,
  });

  return NextResponse.json(updated);
}
