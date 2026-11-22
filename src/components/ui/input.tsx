import * as React from "react"

import { cn } from "@/lib/utils"

// Mist input. Surface (white) background instead of
// transparent, hairline border, indigo focus ring at 35% opacity
// so the brand moment shows up on keyboard focus.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md px-3 py-1 text-sm outline-none",
        "bg-[color:var(--color-input)] text-[color:var(--color-foreground)]",
        "border border-[color:var(--color-border)]",
        "shadow-[var(--elevation-0)]",
        "transition-colors duration-[var(--motion-duration-fast)] ease-[var(--motion-ease)]",
        "placeholder:text-[color:var(--color-muted-foreground)]",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[color:var(--color-foreground)]",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-[color:var(--mist-indigo)] focus-visible:ring-2 focus-visible:ring-[color:var(--mist-indigo)]/35",
        "aria-invalid:border-[color:var(--mist-danger)] aria-invalid:ring-2 aria-invalid:ring-[color:var(--mist-danger)]/30",
        className
      )}
      {...props}
    />
  )
}

export { Input }
