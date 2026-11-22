"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Siren, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotificationSocketStatus } from "@/lib/socket/client";

// ---------------------------------------------------------------------------
// Environment badge
// ---------------------------------------------------------------------------

type EnvKind = "production" | "preview" | "development";

function detectEnv(): EnvKind {
  // NEXT_PUBLIC_APP_ENV wins if set (used to mark "preview" / "dev"
  // deploys that still run NODE_ENV=production).
  const explicit = process.env.NEXT_PUBLIC_APP_ENV;
  if (explicit === "production" || explicit === "preview" || explicit === "development") {
    return explicit;
  }
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

export function EnvironmentBadge() {
  const env = detectEnv();
  if (env === "production") return null;

  const label = env === "preview" ? "Preview" : "Dev";
  return (
    <span
      className={cn(
        "hidden items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] sm:inline-flex",
        env === "preview"
          ? "border-[color:var(--mist-indigo)]/50 bg-[color:var(--mist-indigo)]/10 text-[color:var(--mist-indigo)]"
          : "border-[color:var(--mist-warn)]/50 bg-[color:var(--mist-warn)]/10 text-[color:var(--mist-warn)]"
      )}
      title={`Environment: ${env}`}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", env === "preview" ? "bg-[color:var(--mist-indigo)]" : "bg-[color:var(--mist-warn)]")} />
      {label}
    </span>
  );
}


// ---------------------------------------------------------------------------
// Active incident pill — "which war room should I be in right now?"
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 30_000;

interface ParticipatingIncident {
  id: string;
  title: string;
  severity: string;
  status: string;
}

// Shown on every page (platform + war-room top bars) whenever the viewer is
// personally involved in an active incident, so the command center is one
// click away no matter where they are. Hidden while already inside that
// incident's war room.
export function ActiveIncidentPill() {
  const pathname = usePathname();
  const [incident, setIncident] = useState<ParticipatingIncident | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/incidents/participating", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { incident?: ParticipatingIncident | null };
        if (!cancelled) setIncident(data.incident ?? null);
      } catch {
        // Non-fatal — pill simply won't appear.
      }
    }

    void poll();
    const t = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  if (!incident) return null;
  const target = `/incidents/${incident.id}`;
  if (pathname === target || pathname.startsWith(target + "/")) return null;

  const hot = incident.severity === "critical" || incident.severity === "high";
  return (
    <Link
      href={target}
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors sm:px-2.5",
        hot
          ? "border-destructive/50 bg-destructive/10 text-destructive hover:border-destructive hover:bg-destructive/20"
          : "border-[color:var(--mist-amber)]/50 bg-[color:var(--mist-amber)]/10 text-[color:var(--mist-amber)] hover:border-[color:var(--mist-amber)] hover:bg-[color:var(--mist-amber)]/20",
      )}
      title={`Active incident (${incident.severity}): ${incident.title}`}
      aria-label={`Active incident (${incident.severity}): ${incident.title}`}
    >
      <span className="relative flex h-2 w-2">
        <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-75", hot ? "bg-destructive" : "bg-[color:var(--mist-amber)]")} />
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", hot ? "bg-destructive" : "bg-[color:var(--mist-amber)]")} />
      </span>
      <Siren className="h-3 w-3" />
      {/* Icon-only below sm so the bar fits a phone. */}
      <span className="hidden font-mono uppercase tracking-[0.14em] sm:inline">Incident</span>
      <span className="hidden max-w-[160px] truncate text-foreground/80 lg:inline">{incident.title}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Socket connection status dot
// ---------------------------------------------------------------------------

export function SocketStatusDot() {
  const status = useNotificationSocketStatus();

  // While idle (before NotificationBell has mounted) keep the indicator quiet.
  if (status === "idle") return null;

  const config = {
    connecting: {
      label: "Connecting…",
      colorClass: "text-[color:var(--mist-warn)]",
      Icon: Wifi,
      pulse: true,
    },
    connected: {
      label: "Realtime online",
      colorClass: "text-[color:var(--mist-ok)]",
      Icon: Wifi,
      pulse: false,
    },
    disconnected: {
      label: "Realtime offline, reconnecting",
      colorClass: "text-destructive",
      Icon: WifiOff,
      pulse: true,
    },
  }[status];

  const { Icon, label, colorClass, pulse } = config;
  return (
    <span
      className={cn("hidden h-9 w-9 items-center justify-center rounded-md border border-border bg-card sm:inline-flex", colorClass)}
      title={label}
      aria-label={label}
    >
      <Icon className={cn("h-4 w-4", pulse && "animate-pulse")} />
    </span>
  );
}
