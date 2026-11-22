import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { SUPPORTED_THEMES } from "@/lib/theme-options";
import { parseJsonBody } from "@/lib/http/parse-body";

const DEFAULT_THEME = "forge";

const preferencesSchema = z.object({
  theme: z.enum(SUPPORTED_THEMES).optional(),
});

// GET /api/user/preferences
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The light theme ("forge") is the default. The column default in the
  // schema is a stale "dark", so new rows set it explicitly; otherwise the
  // first visit to Settings would flip a new user to the dark theme.
  const preferences = await db.userPreferences.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, theme: DEFAULT_THEME },
    update: {},
  });

  return NextResponse.json(preferences);
}

// PATCH /api/user/preferences
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody(req, preferencesSchema);
  if (!parsed.ok) return parsed.response;

  const preferences = await db.userPreferences.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, theme: DEFAULT_THEME, ...parsed.data },
    update: parsed.data,
  });

  return NextResponse.json(preferences);
}
