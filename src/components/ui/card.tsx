import * as React from "react"

import { cn } from "@/lib/utils"

// Mist card. No border. Multi-layer ambient shadow via
// --elevation-1 provides separation from the paper background.
// Generous default padding (24px) so cards breathe; dense lists
// can opt-in to `--dense` via the `dense` prop.
function Card({
  className,
  dense = false,
  ...props
}: React.ComponentProps<"div"> & { dense?: boolean }) {
  return (
    <div
      data-slot="card"
      data-dense={dense || undefined}
      className={cn(
        "flex flex-col gap-5 rounded-xl bg-[color:var(--color-card)] text-[color:var(--color-card-foreground)]",
        "shadow-[var(--elevation-1)]",
        dense ? "p-4 gap-3" : "p-6",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "headline text-[1.0625rem] leading-tight font-semibold tracking-[-0.005em]",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-[13px] leading-relaxed text-[color:var(--color-muted-foreground)]", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center [.hairline-t]:pt-4", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
