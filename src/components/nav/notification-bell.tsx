"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bell, Info } from "lucide-react";
import { type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useNotificationSocket } from "@/lib/socket/client";
import type { NotificationPayload } from "@/lib/socket/events";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotificationBellProps {
  userId: string;
  triggerClassName?: string;
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  /** Top-level link column on the Notification table. Set when the
   * notification has a single canonical destination (eg. /incidents/{id}). */
  link: string | null;
  metadata: Record<string, unknown> | null;
  read: boolean;
  createdAt: string | Date;
}

interface NotificationsResponse {
  notifications: NotificationItem[];
  total: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<string, LucideIcon> = {
  system: AlertTriangle,
};

function getTypeIcon(type: string): LucideIcon {
  return TYPE_ICONS[type] ?? Info;
}

function timeAgo(date: string | Date): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(date).toLocaleDateString();
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "...";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NotificationBell({ userId, triggerClassName }: NotificationBellProps) {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const hasFetchedRef = useRef(false);

  const badgeCount = unreadCount;

  // Fetch unread count on mount
  useEffect(() => {
    async function fetchUnreadCount() {
      try {
        const res = await fetch(
          "/api/notifications?unreadOnly=true&limit=1"
        );
        if (!res.ok) return;
        const data: NotificationsResponse = await res.json();
        setUnreadCount(data.total);
      } catch {
        // Non-fatal — badge just won't show a count
      }
    }

    fetchUnreadCount();
  }, []);

  // Real-time notification subscription
  const handleNewNotification = useCallback(
    (notification: NotificationPayload) => {
      setUnreadCount((prev) => prev + 1);
      setNotifications((prev) => [
        {
          id: notification.id,
          type: notification.type,
          title: notification.title,
          body: notification.body,
          link: notification.link ?? null,
          metadata: notification.metadata,
          read: notification.read,
          createdAt: notification.createdAt,
        },
        ...prev,
      ]);
    },
    []
  );

  useNotificationSocket(userId, handleNewNotification);

  // Fetch recent notifications when popover opens
  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/notifications?limit=10");
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const data: NotificationsResponse = await res.json();
      setNotifications(data.notifications);
      // Also refresh unread count
      const unreadRes = await fetch(
        "/api/notifications?unreadOnly=true&limit=1"
      );
      if (unreadRes.ok) {
        const unreadData: NotificationsResponse = await unreadRes.json();
        setUnreadCount(unreadData.total);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleOpenChange(open: boolean) {
    setIsOpen(open);
    if (open && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchNotifications();
    } else if (open) {
      fetchNotifications();
    }
  }

  // Mark a single notification as read and navigate
  async function handleNotificationClick(notification: NotificationItem) {
    if (!notification.read) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));

      try {
        await fetch(`/api/notifications/${notification.id}`, {
          method: "PATCH",
        });
      } catch {
        // Non-fatal
      }
    }

    // Navigate if the notification has a deep-link. Prefer the top-level
    // `link` column (the authoritative store); fall back to a legacy
    // `metadata.link` for older rows that predated the column.
    const link =
      notification.link ??
      (notification.metadata && typeof notification.metadata.link === "string"
        ? notification.metadata.link
        : null);

    if (link) {
      setIsOpen(false);
      router.push(link);
    }
  }

  // Mark all as read
  async function handleMarkAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);

    try {
      await fetch("/api/notifications/mark-all-read", { method: "POST" });
    } catch {
      // Non-fatal
    }
  }

  const Icon = Bell;

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(
            "relative text-muted-foreground hover:text-foreground",
            triggerClassName
          )}
          aria-label="Notifications"
        >
          <Icon className="h-4 w-4" />
          {badgeCount > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-white"
            >
              {badgeCount > 99 ? "99+" : badgeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-96 p-0"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Notifications</h3>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="text-xs text-primary hover:text-primary/80"
            >
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-[70vh] overflow-y-auto">
          {/* Notifications section */}
          <section>
            {loading && notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                Loading...
              </div>
            ) : loadError && notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                Couldn&apos;t load notifications.{" "}
                <button
                  onClick={() => fetchNotifications()}
                  className="font-medium text-[color:var(--mist-indigo)] hover:underline"
                >
                  Try again
                </button>
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                No notifications.
              </div>
            ) : (
              notifications.map((notification) => {
                const TypeIcon = getTypeIcon(notification.type);
                return (
                  <button
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={cn(
                      "flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent/40",
                      !notification.read && "bg-accent/20"
                    )}
                  >
                    {/* Rounded square, indigo for unread / muted for read. */}
                    <div
                      className={cn(
                        "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                        notification.read
                          ? "bg-muted text-muted-foreground"
                          : "bg-[color:var(--mist-indigo-soft)] text-[color:var(--mist-indigo)]",
                      )}
                    >
                      <TypeIcon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className={cn(
                            "text-xs font-semibold leading-tight",
                            notification.read
                              ? "text-foreground/80"
                              : "text-foreground"
                          )}
                        >
                          {notification.title}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {timeAgo(notification.createdAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                        {truncate(notification.body, 100)}
                      </p>
                    </div>
                    {!notification.read && (
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[color:var(--mist-indigo)]" />
                    )}
                  </button>
                );
              })
            )}
          </section>
        </div>

        {/* Footer */}
        {notifications.length > 0 && (
          <div className="border-t border-border px-4 py-2">
            <button
              onClick={() => {
                setIsOpen(false);
                router.push("/inbox");
              }}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              View all
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
