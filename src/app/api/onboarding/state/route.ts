import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import { parseJsonBody } from "@/lib/http/parse-body";
import { CARD_HIDDEN_KEY, WELCOME_DISMISSED_KEY, clearState, setState, skipKey } from "@/lib/onboarding/state";
import { OPTIONAL_ORG_STEPS } from "@/lib/onboarding/steps";

// POST /api/onboarding/state — the only onboarding writes that are not derived
// from real data:
//   dismiss_welcome         per user, the first-login welcome modal
//   hide_card / show_card   per user, the "Onboarding" card on the Ops Room
//   skip / unskip {step}    per org, an OPTIONAL Organization-setup step
//                           (administrators only)
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("dismiss_welcome") }),
  z.object({ action: z.literal("hide_card") }),
  z.object({ action: z.literal("show_card") }),
  z.object({ action: z.enum(["skip", "unskip"]), step: z.string().min(1).max(64) }),
]);

export async function POST(req: Request) {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await parseJsonBody(req, schema, { maxBytes: 1024 });
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  switch (body.action) {
    case "dismiss_welcome":
      await setState("user", user.id, WELCOME_DISMISSED_KEY, new Date().toISOString());
      break;
    case "hide_card":
      await setState("user", user.id, CARD_HIDDEN_KEY, new Date().toISOString());
      break;
    case "show_card":
      await clearState("user", user.id, CARD_HIDDEN_KEY);
      break;
    case "skip":
    case "unskip": {
      if (!OPTIONAL_ORG_STEPS.has(body.step)) {
        return NextResponse.json({ error: "Only optional steps can be skipped" }, { status: 400 });
      }
      if (!hasPermission(user, "admin.access")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (body.action === "skip") await setState("org", user.organizationId, skipKey(body.step), new Date().toISOString());
      else await clearState("org", user.organizationId, skipKey(body.step));
      break;
    }
  }
  return NextResponse.json({ ok: true });
}
