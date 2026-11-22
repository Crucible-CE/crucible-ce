export const THEME_STORAGE_KEY = "crucible-ce-theme";

/* Mist switchover: only two resolved themes remain.
   - "forge"  → Mist (light, default; inherits the @theme base in globals.css)
   - "dark"   → Carbon (dark / War Room)
   All previous Halcyon-family and legacy themes were removed. Any stale
   stored preference (e.g. "geist", "slate-pro") is not in this list, so the
   bootstrap + resolveTheme fall back to "forge". */
export const RESOLVED_THEMES = [
  "forge",
  "dark",
] as const;

export type ResolvedTheme = (typeof RESOLVED_THEMES)[number];

export const SUPPORTED_THEMES = [...RESOLVED_THEMES, "system"] as const;

export type ThemeOption = (typeof SUPPORTED_THEMES)[number];

export const DARK_THEME_VALUES = [
  "dark",
] as const;

const DARK_THEME_SET = new Set<ResolvedTheme>(DARK_THEME_VALUES);
const SUPPORTED_THEME_SET = new Set<string>(SUPPORTED_THEMES);
const RESOLVED_THEME_SET = new Set<string>(RESOLVED_THEMES);

export function isThemeOption(value: string | null | undefined): value is ThemeOption {
  return !!value && SUPPORTED_THEME_SET.has(value);
}

export function isResolvedTheme(value: string | null | undefined): value is ResolvedTheme {
  return !!value && RESOLVED_THEME_SET.has(value);
}

export function isDarkTheme(value: ResolvedTheme): boolean {
  return DARK_THEME_SET.has(value);
}

export function resolveTheme(
  theme: ThemeOption,
  prefersDark: boolean
): ResolvedTheme {
  if (theme === "system") {
    return prefersDark ? "dark" : "forge";
  }

  return isResolvedTheme(theme) ? theme : "forge";
}
