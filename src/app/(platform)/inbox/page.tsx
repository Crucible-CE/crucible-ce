"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  AlertTriangle,
  Info,
  Loader2,
  MailOpen,
} from "lucide-react";
import { type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  /** Top-level link column. Authoritative; metadata.link is a legacy
   * fallback for rows that predated the column. */
  link: string | null;
  metadata: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: NotificationItem[];
  total: number;
}

const TYPE_ICONS: Record<string, LucideIcon> = {
  system: AlertTriangle,
};

function getIcon(type: string): LucideIcon {
  return TYPE_ICONS[type] ?? Info;
}

function timeAgo(date: string): string {
  const diffMs = Date.now() - new Date(date).getTime();
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

const PAGE_SIZE = 30;

export default function InboxPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async (reset = false) => {
    const currentOffset = reset ? 0 : offset;
    if (reset) setLoading(true);
    else setLoadingMore(true);

    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(currentOffset),
        ...(unreadOnly ? { unreadOnly: "true" } : {}),
      });
      const res = await fetch(`/api/notifications?${params.toString()}`);
      if (!res.ok) return;
      const data: NotificationsResponse = await res.json();

      if (reset) {
        setNotifications(data.notifications);
        setOffset(PAGE_SIZE);
      } else {
        setNotifications((prev) => [...prev, ...data.notifications]);
        setOffset((prev) => prev + PAGE_SIZE);
      }
      setTotal(data.total);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [offset, unreadOnly]);

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadOnly]);

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      const res = await fetch("/api/notifications/mark-all-read", { method: "POST" });
      if (!res.ok) throw new Error();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      toast.success("All notifications marked as read");
    } catch {
      toast.error("Couldn't mark all as read. Try again.");
    } finally {
      setMarkingAll(false);
    }
  };

  // Mirrors the bell dropdown's clickable behaviour. Each notification
  // can carry a `metadata.link` (e.g. /incidents/<id>) —
  // we mark it read AND route to that target. Without this the inbox
  // was read-only despite the toasts being clickable; same data shape,
  // different surface.
  const handleNotificationClick = (n: NotificationItem) => {
    if (!n.read) {
      // Optimistic update — markRead handles the API call + revert on
      // failure below. Keeps the click feel instant.
      void markRead(n.id);
    }
    // Prefer the authoritative top-level link column; fall back to
    // metadata.link for legacy rows that predated the column.
    const link =
      n.link ??
      (n.metadata && typeof n.metadata.link === "string" ? n.metadata.link : null);
    if (link) router.push(link);
  };

  const markRead = async (id: string) => {
    try {
      await fetch(`/api/notifications/${id}`, { method: "PATCH" });
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    } catch {
      // non-critical
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="headline">Inbox</h1>
          <p className="text-[13px] leading-relaxed text-[color:var(--color-muted-foreground)] max-w-2xl">
            {total} notification{total !== 1 ? "s" : ""}
            {unreadCount > 0 && ` · ${unreadCount} unread`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setUnreadOnly((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              unreadOnly
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Unread only
          </button>
          {unreadCount > 0 && (
            <Button size="sm" variant="outline" onClick={markAllRead} disabled={markingAll} className="text-xs h-8">
              {markingAll ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <MailOpen className="mr-1.5 h-3 w-3" />}
              Mark all read
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Bell className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            {unreadOnly ? "No unread notifications." : "No notifications."}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {notifications.map((n) => {
            const Icon = getIcon(n.type);
            const hasLink =
              !!(n.metadata && typeof n.metadata.link === "string");
            const isClickable = hasLink || !n.read;
            return (
              <div
                key={n.id}
                role={isClickable ? "button" : undefined}
                tabIndex={isClickable ? 0 : undefined}
                onClick={() => isClickable && handleNotificationClick(n)}
                onKeyDown={(e) => {
                  if (isClickable && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    handleNotificationClick(n);
                  }
                }}
                className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${
                  isClickable ? "cursor-pointer" : "cursor-default"
                } ${
                  n.read
                    ? "border-border bg-card/30 hover:bg-card/50"
                    : "border-primary/20 bg-primary/5 hover:bg-primary/10"
                }`}
              >
                <div className={`mt-0.5 shrink-0 rounded-full p-1.5 ${n.read ? "bg-muted/40" : "bg-primary/15"}`}>
                  <Icon className={`h-3.5 w-3.5 ${n.read ? "text-muted-foreground" : "text-primary"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <p className={`text-sm font-medium leading-snug ${n.read ? "text-foreground/70" : "text-foreground"}`}>
                      {n.title}
                    </p>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                  </div>
                  {n.body && (
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{n.body}</p>
                  )}
                  {!n.read && (
                    <span className="mt-1 inline-block rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">
                      New
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {notifications.length < total && (
            <div className="pt-4 text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => load(false)}
                disabled={loadingMore}
                className="text-xs"
              >
                {loadingMore ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Load more ({total - notifications.length} left)
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
