import { ChevronDownIcon } from "lucide-react";

import { cn } from "~/lib/utils";

function DisclosureChevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <ChevronDownIcon
      aria-hidden="true"
      className={cn(
        "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-out motion-reduce:transition-none",
        !open && "-rotate-90",
        className,
      )}
      data-slot="disclosure-chevron"
    />
  );
}

export { DisclosureChevron };
