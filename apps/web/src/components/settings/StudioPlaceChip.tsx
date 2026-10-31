import { StatusDot } from "../ui/status-dot";

export function StudioPlaceChip({
  name,
  role,
  running = false,
}: {
  readonly name: string;
  readonly role?: string | undefined;
  readonly running?: boolean;
}) {
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-foreground/[0.06] px-2 py-1 text-xs text-foreground"
      data-slot="studio-place-chip"
    >
      <StatusDot tone={running ? "info" : "success"} />
      <span className="min-w-0 truncate font-medium">{name}</span>
      {role ? <span className="shrink-0 text-muted-foreground">{role}</span> : null}
    </span>
  );
}
