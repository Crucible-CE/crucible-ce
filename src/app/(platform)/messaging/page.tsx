import { redirect } from "next/navigation";
import { RadioTower } from "lucide-react";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { MessagingClient } from "@/components/broadcast/messaging-client";

export const dynamic = "force-dynamic";

export default async function MessagingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user, "incidents.edit")) {
    return (
      <>
        <PageHeader title="Messaging" />
        <EmptyState icon={RadioTower} title="Contributors and administrators send broadcasts." />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Messaging" description="Send one message to many people over app, email, SMS, voice and webhooks." />
      <MessagingClient />
    </>
  );
}
