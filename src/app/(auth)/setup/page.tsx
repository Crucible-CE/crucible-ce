import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ensureSetupCode } from "@/lib/setup/setup-code";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

// First-run setup: create the install's organization and first administrator.
// Once any user exists this page permanently redirects to /login, so a live
// install never exposes an account-creation surface here.
export default async function SetupPage() {
  const users = await db.user.count();
  if (users > 0) redirect("/login");
  // server.ts prints the one-time setup code at boot. A process without that
  // boot hook (plain `next dev`) issues and prints one here on first view; an
  // already-active code is left untouched.
  await ensureSetupCode(async () => users);
  return <SetupForm />;
}
