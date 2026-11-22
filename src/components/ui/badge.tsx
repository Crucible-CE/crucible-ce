import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Mist badge. "accent" is the indigo soft chip used for
// "Active", "v2", "Live" markers — the brand moment in a list.
// "outline" is the hairline neutral pill for status that isn't
// an event ("Draft", "Archived"). Semantic variants (success /
// warning / destructive) use soft tints — never solid red/green
// because solid semantic colors in a list look like alerts.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors duration-[var(--motion-duration-fast)] [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default:
          "bg-[color:var(--mist-navy-soft)] text-[color:var(--mist-navy)]",
        accent:
          "bg-[color:var(--mist-indigo-soft)] text-[color:var(--mist-indigo)]",
        secondary:
          "bg-[color:var(--color-muted)] text-[color:var(--color-foreground)]",
        success:
          "bg-[color:color-mix(in_srgb,var(--mist-ok),transparent_88%)] text-[color:var(--mist-ok)]",
        warning:
          "bg-[color:color-mix(in_srgb,var(--mist-warn),transparent_88%)] text-[color:var(--mist-warn)]",
        destructive:
          "bg-[color:color-mix(in_srgb,var(--mist-danger),transparent_88%)] text-[color:var(--mist-danger)]",
        outline:
          "border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)]",
        ghost:
          "text-[color:var(--color-muted-foreground)]",
        link:
          "text-[color:var(--mist-indigo)] underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
