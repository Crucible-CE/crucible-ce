import { cn } from "@/lib/utils";

// Standing evidentiary notice — the platform-wide bottom bar. Previously this
// rendered inline after the page content inside the platform shell only, so it
// floated at content height on short pages and was absent from war-room
// layouts entirely. It is now FIXED to the viewport bottom on every surface:
// same position, same copy, everywhere. Layouts that mount it must reserve
// space with `pb-[var(--disclaimer-h)]` on their scroll container.
//
// Height is published as --disclaimer-h so content padding can't drift from
// the bar's real size.
export const DISCLAIMER_HEIGHT_PX = 30;

export function EvidentiaryFooter({ withRail = false }: { withRail?: boolean }) {
  return (
    <footer
      role="contentinfo"
      style={{ height: DISCLAIMER_HEIGHT_PX }}
      className={cn(
        "fixed bottom-0 right-0 z-40 flex items-center justify-center border-t border-[color:var(--color-border)] px-4 text-center text-[10.5px] leading-tight text-[color:var(--color-muted-foreground)]",
        "bg-background/85 backdrop-blur-md",
        // On rail layouts the bar starts at the rail edge (lg+) so it never
        // underlaps the side navigation; war rooms span the full width.
        withRail ? "left-0 lg:left-[var(--rail-w)]" : "left-0",
      )}
    >
      <span className="truncate">
        All activity and messages are recorded and kept in a tamper-evident log for evidentiary, legal and compliance use.
      </span>
    </footer>
  );
}
