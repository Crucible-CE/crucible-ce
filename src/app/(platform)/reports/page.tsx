import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { ReportsClient } from "@/components/reports/reports-client";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!hasPermission(user, "reports.view")) {
    return (
      <>
        <PageHeader title="Program report" />
        <EmptyState icon={ClipboardCheck} title="Readers do not see the program report." />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Program report" description="Exercise history, cadence against your policy, and open work items." />
      <ReportsClient />
    </>
  );
}
