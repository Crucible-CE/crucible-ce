"use client";

// Re-render the (server-rendered) Ops Room when something arrives for the
// member: a page, a mention, an assignment. The notification socket only says
// "something changed"; the server re-derives everything.

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useNotificationSocket } from "@/lib/socket/client";

export function LiveRefresh({ userId }: { userId: string }) {
  const router = useRouter();
  const onNotification = useCallback(() => router.refresh(), [router]);
  useNotificationSocket(userId, onNotification);
  return null;
}
