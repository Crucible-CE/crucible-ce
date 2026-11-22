import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Mist button system.
// - `default` is brand navy (the foundation) — primary CTA.
// - `accent` is the indigo signature — used sparingly for the
//   single "primary action" on a screen when navy already serves
//   another role (eg. "Generate draft" inside a navy-headed card).
// - `outline` becomes a hairline-bordered ghost on paper.
// - `secondary` is a muted paper button for non-primary actions.
// - `destructive` / `link` / `ghost` keep their semantics but
//   pick up Mist tokens.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap outline-none transition-colors duration-[var(--motion-duration-fast)] ease-[var(--motion-ease)] focus-visible:ring-2 focus-visible:ring-[color:var(--color-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)] disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-2 aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-[color:var(--mist-navy)] text-white hover:bg-[color:var(--mist-navy-hi)] active:bg-[color:var(--mist-navy)]",
        accent:
          "bg-[color:var(--mist-indigo)] text-white hover:bg-[color:var(--mist-indigo-hi)] active:bg-[color:var(--mist-indigo-lo)]",
        destructive:
          "bg-[color:var(--mist-danger)] text-white hover:opacity-90",
        outline:
          "bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-[var(--elevation-0)] hover:bg-[color:var(--color-muted)]",
        secondary:
          "bg-[color:var(--color-muted)] text-[color:var(--color-foreground)] hover:bg-[color:var(--mist-paper-2)]",
        ghost:
          "text-[color:var(--color-foreground)] hover:bg-[color:var(--color-muted)]",
        link:
          "text-[color:var(--mist-indigo)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
