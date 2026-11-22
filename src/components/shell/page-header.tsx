// Page title row, styled like Crucible CE: headline, one muted line, and an
// optional action on the right.
export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <h1 className="headline">{title}</h1>
        {description && <p className="max-w-2xl text-[13px] leading-relaxed text-[color:var(--color-muted-foreground)]">{description}</p>}
      </div>
      {action}
    </div>
  );
}
