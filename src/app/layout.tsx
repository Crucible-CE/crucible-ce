import type { Metadata } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import { SessionProvider } from "@/components/providers/session-provider";
import { DARK_THEME_VALUES, SUPPORTED_THEMES, THEME_STORAGE_KEY } from "@/lib/theme-options";
import { Toaster } from "sonner";
import "./globals.css";

// Fonts are self-hosted (src/app/fonts, SIL OFL 1.1, see NOTICE): `next build`
// and the running app make no network calls to a font CDN. Each file is a
// variable font covering every weight the UI uses.

// Mist switchover — Geist is the single UI typeface (body + display).
const geist = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist",
  display: "swap",
  weight: "100 900",
});

// Display voice — a technical grotesk for headlines / wordmark / the
// numbers that carry weight. Engineered, not playful. Body stays Geist.
const spaceGrotesk = localFont({
  src: "./fonts/SpaceGrotesk-latin-wght.woff2",
  variable: "--font-display-face",
  display: "swap",
  weight: "300 700",
});

const jetbrainsMono = localFont({
  src: "./fonts/JetBrainsMono-latin-wght.woff2",
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: "100 800",
});

export const metadata: Metadata = {
  title: "Crucible CE",
  description: "Self-hosted incident response for security teams.",
  robots: { index: false, follow: false, nocache: true },
};

// Mist switchover — default theme is Forge "Mist" (light, the @theme base).
// Carbon dark is data-theme="dark". Stale stored prefs fall back to "forge".
const themeBootstrapScript = `(function(){var key='${THEME_STORAGE_KEY}';var supported=${JSON.stringify(
  SUPPORTED_THEMES
)};var darkThemes=${JSON.stringify(
  DARK_THEME_VALUES
)};var fallback='forge';var root=document.documentElement;var stored=localStorage.getItem(key)||fallback;if(supported.indexOf(stored)===-1){stored=fallback;}var resolved=stored;if(stored==='system'){resolved=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'forge';}root.setAttribute('data-theme',resolved);if(darkThemes.indexOf(resolved)!==-1){root.classList.add('dark');}else{root.classList.remove('dark');}})();`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={`${geist.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
      data-theme="forge"
    >
      <head>
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: themeBootstrapScript,
          }}
        />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <SessionProvider>
          {children}
          <Toaster
            position="bottom-right"
            closeButton
            toastOptions={{
              classNames: {
                toast:
                  "rounded-[var(--radius-md)] border border-[color:var(--color-border)] shadow-[var(--elevation-2)] bg-[color:var(--color-card)] text-[color:var(--color-foreground)]",
                title: "text-[13px] font-semibold tracking-tight",
                description:
                  "text-[12.5px] leading-relaxed text-[color:var(--color-muted-foreground)]",
                actionButton:
                  "bg-[color:var(--color-primary)] text-[color:var(--color-primary-foreground)] rounded-[var(--radius-sm)] px-2 py-1 text-[11.5px] font-medium",
                cancelButton:
                  "text-[color:var(--color-muted-foreground)] text-[11.5px]",
                success: "[&_[data-icon]]:text-[color:var(--color-success)]",
                error: "[&_[data-icon]]:text-[color:var(--color-destructive)]",
                warning: "[&_[data-icon]]:text-[color:var(--color-warning)]",
                info: "[&_[data-icon]]:text-[color:var(--color-accent)]",
              },
            }}
          />
        </SessionProvider>
      </body>
    </html>
  );
}
