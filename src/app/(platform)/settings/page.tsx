"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  User,
  Bell,
  Palette,
  Loader2,
  Check,
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
} from "lucide-react";
import { SecuritySettings } from "@/components/security/security-settings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { signOutAndRedirect } from "@/lib/auth/sign-out-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  THEME_STORAGE_KEY,
  isDarkTheme,
  isThemeOption,
  resolveTheme,
  type ThemeOption,
} from "@/lib/theme-options";

// ── Types ────────────────────────────────────────────────────────────────────

interface UserPreferences {
  theme: string;
}

type ThemeCategory = "Core";

interface ThemePreview {
  background: string;
  border: string;
  lineStrong: string;
  lineSoft: string;
  accent: string;
}

interface ThemeDefinition {
  value: ThemeOption;
  label: string;
  description: string;
  category: ThemeCategory;
  preview: ThemePreview;
}

const THEME_GROUPS: ThemeCategory[] = ["Core"];

const THEME_DEFINITIONS: ThemeDefinition[] = [
  {
    value: "forge",
    label: "Mist",
    description: "Light",
    category: "Core",
    preview: {
      background: "#F6F8FB",
      border: "#E2E8F0",
      lineStrong: "#0F172A",
      lineSoft: "#475569",
      accent: "#EA580C",
    },
  },
  {
    value: "dark",
    label: "Carbon",
    description: "Dark",
    category: "Core",
    preview: {
      background: "#0A0C10",
      border: "#212833",
      lineStrong: "#E6EAF1",
      lineSoft: "#9AA4B2",
      accent: "#F97316",
    },
  },
  {
    value: "system",
    label: "System",
    description: "Matches your OS",
    category: "Core",
    preview: {
      background: "linear-gradient(135deg, #0A0C10 0%, #F6F8FB 100%)",
      border: "#8B97AB",
      lineStrong: "#E6EAF1",
      lineSoft: "#475569",
      accent: "#EA580C",
    },
  },
];

const SETTINGS_TABS = ["profile", "security", "notifications", "appearance"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function applyTheme(theme: ThemeOption) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = resolveTheme(theme, prefersDark);
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.classList.toggle("dark", isDarkTheme(resolved));

  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

// ── Theme card ───────────────────────────────────────────────────────────────

interface ThemeCardProps {
  themeDef: ThemeDefinition;
  active: boolean;
  onClick: () => void;
}

function ThemeCard({ themeDef, active, onClick }: ThemeCardProps) {
  const previewStyle: CSSProperties = {
    background: themeDef.preview.background,
    borderColor: themeDef.preview.border,
  };

  const lineStrongStyle: CSSProperties = {
    background: themeDef.preview.lineStrong,
  };

  const lineSoftStyle: CSSProperties = {
    background: themeDef.preview.lineSoft,
  };

  const accentStyle: CSSProperties = {
    background: themeDef.preview.accent,
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex flex-col gap-3 rounded-lg border p-4 text-left transition-all",
        "hover:border-primary/60 hover:bg-accent/40",
        active
          ? "border-primary bg-accent/30 ring-1 ring-primary/40"
          : "border-border bg-card"
      )}
    >
      {active && (
        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
          <Check className="h-3 w-3 text-primary-foreground" />
        </span>
      )}
      <div className="pointer-events-none select-none rounded-md border p-2 space-y-1.5" style={previewStyle}>
        <div className="h-2 w-16 rounded" style={lineStrongStyle} />
        <div className="h-1.5 w-24 rounded" style={lineSoftStyle} />
        <div className="h-1.5 w-20 rounded" style={lineSoftStyle} />
        <div className="h-1.5 w-10 rounded" style={accentStyle} />
      </div>
      <div>
        <p className="text-sm font-medium">{themeDef.label}</p>
        <p className="text-xs text-muted-foreground">{themeDef.description}</p>
      </div>
    </button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { data: session, update } = useSession();
  // Tab, deep-linkable as /settings?tab=security (onboarding, readiness).
  const [tab, setTab] = useState("profile");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && SETTINGS_TABS.includes(t)) setTab(t);
  }, []);

  const [name, setName] = useState(session?.user?.name ?? "");
  const [jobTitle, setJobTitle] = useState("");
  const [saving, setSaving] = useState(false);

  // Email change state
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [pendingNewEmail, setPendingNewEmail] = useState("");
  const [emailChangePassword, setEmailChangePassword] = useState("");
  const [emailChangeSaving, setEmailChangeSaving] = useState(false);
  const [showEmailChangePassword, setShowEmailChangePassword] = useState(false);

  // Appearance state — read from localStorage on mount so it matches the
  // theme the blocking script already applied
  const [theme, setTheme] = useState<ThemeOption>("forge");

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // ── Load profile fields not carried in the session (job title) ─────────────
  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { name?: string | null; jobTitle?: string | null } | null) => {
        if (cancelled || !d) return;
        setJobTitle(d.jobTitle ?? "");
        if (d.name) setName((cur) => cur || d.name!);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Load preferences ────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadPrefs() {
      try {
        const res = await fetch("/api/user/preferences");
        if (res.ok) {
          const data: UserPreferences = await res.json();
          const preferredTheme = isThemeOption(data.theme) ? data.theme : "forge";
          setTheme(preferredTheme);
          applyTheme(preferredTheme);
        }
      } catch {
        // non-fatal — defaults remain
      }
    }
    loadPrefs();
  }, []);

  // Sync theme from localStorage on first render (reflects blocking script)
  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeOption(stored)) {
      setTheme(stored);
      applyTheme(stored);
    } else {
      setTheme("forge");
      applyTheme("forge");
    }
  }, []);

  // Keep "system" synchronized if OS preference changes while page is open.
  useEffect(() => {
    if (theme !== "system") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", onChange);
      return () => mediaQuery.removeEventListener("change", onChange);
    }

    mediaQuery.addListener(onChange);
    return () => mediaQuery.removeListener(onChange);
  }, [theme]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), jobTitle: jobTitle.trim() }),
      });
      if (res.ok) {
        await update({ name: name.trim() });
        toast.success("Profile saved");
      } else {
        toast.error("Couldn't save. Try again.");
      }
    } catch {
      toast.error("Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleThemeChange(selected: ThemeOption) {
    setTheme(selected);
    applyTheme(selected);

    try {
      await fetch("/api/user/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: selected }),
      });
    } catch {
      // non-fatal — localStorage change already took effect
    }
  }

  async function handleRequestEmailChange() {
    const candidate = pendingNewEmail.trim().toLowerCase();
    if (!candidate || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
      toast.error("Enter a valid email address.");
      return;
    }
    if (candidate === (session?.user?.email ?? "").toLowerCase()) {
      toast.error("That's already your email.");
      return;
    }
    if (!emailChangePassword) {
      toast.error("Enter your current password.");
      return;
    }

    setEmailChangeSaving(true);
    try {
      const res = await fetch("/api/user/email-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newEmail: candidate,
          currentPassword: emailChangePassword,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        toast.success("Verification email sent. Signing you out…");
        setEmailDialogOpen(false);
        setPendingNewEmail("");
        setEmailChangePassword("");
        // Their session is now invalid (tokenVersion bumped + unverified).
        // Sign out cleanly so the new email can verify from a fresh context.
        setTimeout(() => void signOutAndRedirect(), 1500);
      } else {
        toast.error(data.error ?? "Couldn't change your email. Try again.");
      }
    } catch {
      toast.error("Couldn't change your email. Try again.");
    } finally {
      setEmailChangeSaving(false);
    }
  }

  async function handleChangePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error("Fill in all password fields.");
      return;
    }

    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("New passwords don't match.");
      return;
    }

    setPasswordSaving(true);
    try {
      const res = await fetch("/api/user/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success("Password changed. Signing you out…");
        // tokenVersion was incremented server-side, so the current JWT is
        // stale.  Force a clean sign-out to prevent redirect loops caused
        // by the edge middleware seeing the old JWT while the server-side
        // auth rejects it.
        setTimeout(() => void signOutAndRedirect(), 1200);
        return;
      } else {
        toast.error(data.error || "Couldn't change your password. Try again.");
      }
    } catch {
      toast.error("Couldn't change your password. Try again.");
    } finally {
      setPasswordSaving(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="headline">Settings</h1>
        <p className="text-[13px] leading-relaxed text-[color:var(--color-muted-foreground)] max-w-2xl">
          Profile, security, notifications, appearance.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 gap-1 group-data-[orientation=horizontal]/tabs:h-auto sm:inline-flex sm:w-fit sm:gap-0">
          <TabsTrigger value="profile" className="h-8">
            <User className="mr-2 h-4 w-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="security" className="h-8">
            <ShieldCheck className="mr-2 h-4 w-4" />
            Security
          </TabsTrigger>
          <TabsTrigger value="notifications" className="h-8">
            <Bell className="mr-2 h-4 w-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="appearance" className="h-8">
            <Palette className="mr-2 h-4 w-4" />
            Appearance
          </TabsTrigger>
        </TabsList>

        {/* ── Profile ────────────────────────────────────────────────────────── */}
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="jobTitle">Job title</Label>
                <Input
                  id="jobTitle"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="Security Operations Lead"
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={session?.user?.email ?? ""}
                    disabled
                    className="flex-1 opacity-70"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setPendingNewEmail("");
                      setEmailChangePassword("");
                      setShowEmailChangePassword(false);
                      setEmailDialogOpen(true);
                    }}
                  >
                    Change
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Changing it signs you out until you verify the new address.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Input
                  value={session?.user?.role ?? ""}
                  disabled
                  className="opacity-60"
                />
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={handleSave} disabled={saving || !name.trim()}>
                  {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Save changes
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void signOutAndRedirect()}
                >
                  Sign out
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ── Change Password ──────────────────────────────────────────────── */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5" />
                Change password
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Current password</Label>
                <div className="relative">
                  <Input
                    id="currentPassword"
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    aria-label={showCurrentPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  >
                    {showCurrentPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">New password</Label>
                <div className="relative">
                  <Input
                    id="newPassword"
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    aria-label={showNewPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowNewPassword(!showNewPassword)}
                  >
                    {showNewPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>
              <Button
                onClick={handleChangePassword}
                disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword}
              >
                {passwordSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Change password
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Security (two-factor sign-in) ──────────────────────────────────── */}
        <TabsContent value="security">
          <SecuritySettings />
        </TabsContent>

        {/* ── Notifications ──────────────────────────────────────────────────── */}
        <TabsContent value="notifications">
          <a
            href="/settings/notifications"
            className="mb-4 flex items-center justify-between rounded-lg border border-[color:var(--mist-indigo)]/40 bg-[color:var(--mist-indigo)]/5 p-4 transition hover:bg-[color:var(--mist-indigo)]/10"
          >
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-[color:var(--mist-indigo)]" />
              <div>
                <p className="text-sm font-semibold">Notifications</p>
                <p className="text-xs text-muted-foreground">Channels, quiet hours and your mobile number.</p>
              </div>
            </div>
            <span className="text-sm font-medium text-[color:var(--mist-indigo)]">Open →</span>
          </a>
        </TabsContent>

        {/* ── Appearance ─────────────────────────────────────────────────────── */}
        <TabsContent value="appearance">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Saved to your account.
              </p>
              <div className="space-y-5">
                {THEME_GROUPS.map((group) => {
                  const themes = THEME_DEFINITIONS.filter(
                    (themeDef) => themeDef.category === group
                  );

                  return (
                    <div key={group} className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {group}
                      </p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {themes.map((themeDef) => (
                          <ThemeCard
                            key={themeDef.value}
                            themeDef={themeDef}
                            active={theme === themeDef.value}
                            onClick={() => handleThemeChange(themeDef.value)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Email change confirmation dialog ──────────────────────────────── */}
      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change email address</DialogTitle>
            <DialogDescription>
              We&apos;ll send a verification link to the new address.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="newEmail">New email address</Label>
              <Input
                id="newEmail"
                type="email"
                value={pendingNewEmail}
                onChange={(e) => setPendingNewEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emailChangePassword">Current password</Label>
              <div className="relative">
                <Input
                  id="emailChangePassword"
                  type={showEmailChangePassword ? "text" : "password"}
                  value={emailChangePassword}
                  onChange={(e) => setEmailChangePassword(e.target.value)}
                  autoComplete="current-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  aria-label={showEmailChangePassword ? "Hide password" : "Show password"}
                  onClick={() =>
                    setShowEmailChangePassword(!showEmailChangePassword)
                  }
                >
                  {showEmailChangePassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
            </div>
            <p className="text-xs text-[color:var(--mist-warn)]">
              You&apos;ll be signed out until you verify the new email. One
              change per 24 hours.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEmailDialogOpen(false)}
              disabled={emailChangeSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRequestEmailChange}
              disabled={
                emailChangeSaving ||
                !pendingNewEmail.trim() ||
                !emailChangePassword
              }
            >
              {emailChangeSaving && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Change email & sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
