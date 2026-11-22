import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FileText, Gauge, Network } from "lucide-react";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

// Only modes that can be authored today are listed.
const MODES = [
  {
    href: "/templates/new/crisissim",
    title: "Crisis Sim",
    icon: Gauge,
    text: "Timed executive decisions. Each team votes on one question per inject and hidden scoring moves the scenario.",
  },
  {
    href: "/exercises/new/playbook",
    title: "Playbook Exercise",
    icon: FileText,
    text: "Discussion modules written from a playbook or plan, with the document beside you.",
  },
  {
    href: "/studio/new?mode=strategic",
    title: "Strategic TTX",
    icon: Network,
    text: "Multi-team discussion with team variants. Build it in the Studio as a linear or branched scenario.",
  },
];

export default async function NewTemplatePage() {
  const user = await getSessionUser();
  if (!user || !hasPermission(user, "templates.manage")) redirect("/");
  return (
    <>
      <PageHeader title="New template" description="Pick the kind of exercise." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {MODES.map((m) => (
          <Link key={m.href} href={m.href} className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-ring)]">
            <Card className="h-full gap-3 transition-shadow group-hover:shadow-[var(--elevation-2,var(--elevation-1))]">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[color:var(--mist-indigo-soft)] text-[color:var(--mist-indigo)]">
                <m.icon className="h-5 w-5" />
              </span>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">{m.title}</h2>
                <ArrowRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <p className="text-[13px] text-[color:var(--color-muted-foreground)]">{m.text}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
