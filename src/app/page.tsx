import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// CE has no marketing site: the root routes straight into the app. A fresh
// install (zero users) lands on the first-run setup wizard instead.
export default async function RootPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");
  const users = await db.user.count();
  redirect(users === 0 ? "/setup" : "/login");
}
