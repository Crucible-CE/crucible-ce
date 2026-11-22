import { redirect } from "next/navigation";
import { PlatformShell } from "@/components/nav/platform-shell";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { CloudNotesProvider } from "@/components/cloud/cloud-notes-provider";
import { auth } from "@/lib/auth";
import { MFA_FUNNEL_PATH } from "@/lib/auth/mfa/policy";
import { cloudNotesStateFor } from "@/lib/cloud/notes-server";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Require-MFA funnel, checked fresh: auth() re-validates the session against
  // the DB, so a policy an admin just turned on applies on the next page load
  // even while this browser's cookie still carries the old claim (middleware).
  const session = await auth();
  if (session?.user?.mfaEnrollRequired) redirect(MFA_FUNNEL_PATH);
  // Cloud notes: facilitators and administrators only, unless the org hid them.
  const cloudNotes = await cloudNotesStateFor(session?.user);

  return (
    <PlatformShell>
      <CloudNotesProvider state={cloudNotes}>
        <ConfirmDialogProvider>
        {children}
        </ConfirmDialogProvider>
      </CloudNotesProvider>
    </PlatformShell>
  );
}
