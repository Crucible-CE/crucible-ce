import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, TrendingUp } from "lucide-react";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { seesAllReports } from "@/lib/exercise/aar/register";
import { loadMaturity } from "@/lib/exercise/aar/maturity";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MaturityChart, MaturityLegend } from "@/components/reports/maturity-chart";

export const dynamic = "force-dynamic";

const back = (
  <Link href="/after-action-reports" className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-[color:var(--color-muted)]">
    <ArrowLeft className="h-4 w-4" />
    After-action reports
  </Link>
);

export default async function MaturityPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!seesAllReports(user)) {
    return (
      <>
        <PageHeader title="Capability maturity" action={back} />
        <EmptyState icon={TrendingUp} title="Capability maturity is for the exercise program team." description="Your final reports are on the after-action reports page." />
      </>
    );
  }
  const data = await loadMaturity();
  return (
    <>
      <PageHeader title="Capability maturity" description="Objective ratings per capability across ended exercises, oldest on the left." action={back} />
      {data.rows.length === 0 || !data.start || !data.end ? (
        <EmptyState icon={TrendingUp} title="No rated objectives with a capability yet." description="Ratings appear here after an exercise ends." />
      ) : (
        <Card dense>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">
              {data.rows.length === 1 ? "1 capability" : `${data.rows.length} capabilities`}, {data.exerciseCount === 1 ? "1 exercise" : `${data.exerciseCount} exercises`}
            </h2>
            <MaturityLegend />
          </div>
          <MaturityChart rows={data.rows} start={data.start} end={data.end} />
        </Card>
      )}
    </>
  );
}
