import type { ReactNode } from "react";

import { HarpMark } from "~/components/HarpMark";

const backdropClassNames = {
  pairing:
    "absolute inset-x-0 top-0 h-44 bg-[radial-gradient(44rem_16rem_at_top,color-mix(in_srgb,var(--success)_12%,transparent),transparent)]",
  error:
    "absolute inset-x-0 top-0 h-44 bg-[radial-gradient(44rem_16rem_at_top,color-mix(in_srgb,var(--destructive)_14%,transparent),transparent)]",
  brand:
    "absolute inset-x-0 top-0 h-72 bg-[radial-gradient(48rem_20rem_at_top,color-mix(in_srgb,var(--brand-accent)_14%,transparent),transparent)]",
};

export function StandalonePage({
  tone,
  masthead,
  children,
}: {
  readonly tone: keyof typeof backdropClassNames;
  readonly masthead?: ReactNode;
  readonly children: ReactNode;
}) {
  const resolvedMasthead =
    masthead ??
    (tone === "brand" || tone === "pairing" ? (
      <div className="px-6 pt-6 sm:px-8 sm:pt-8">
        <HarpMark />
      </div>
    ) : null);

  return (
    // The page owns scrolling because root cannot scroll; safe centering keeps oversized cards top-aligned.
    <div className="relative h-full overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className={backdropClassNames[tone]} />
      </div>

      <div className="relative flex h-full items-center-safe justify-center overflow-y-auto scrollbar-gutter-both px-4 py-10 sm:px-6">
        <section
          className={`dialog-glass relative w-full max-w-xl rounded-2xl border ${tone === "brand" ? "overflow-hidden" : ""}`}
        >
          {resolvedMasthead}
          <div className="p-6 sm:p-8">{children}</div>
        </section>
      </div>
    </div>
  );
}

export function StandalonePageHeader({
  eyebrow,
  title,
  description,
}: {
  readonly eyebrow: ReactNode;
  readonly title: ReactNode;
  readonly description: ReactNode;
}) {
  return (
    <>
      <p className="text-xs font-medium text-muted-foreground">{eyebrow}</p>
      <h1 className="mt-2 text-2xl font-normal tracking-tight sm:text-3xl">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
    </>
  );
}
