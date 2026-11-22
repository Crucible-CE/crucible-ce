// skip-to-content link. Visually hidden until focused (the first focusable
// node on the page), then pinned as a visible chip so keyboard/AT users can
// jump past the nav to the main landmark.
export function SkipLink({ targetId = "main-content" }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-[var(--radius-sm)] focus:bg-[color:var(--color-primary)] focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-[color:var(--color-primary-foreground)] focus:shadow-lg"
    >
      Skip to content
    </a>
  );
}
