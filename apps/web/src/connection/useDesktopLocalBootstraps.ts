import { useAtomValue } from "@effect/atom-react";
import type { DesktopEnvironmentBootstrap } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { readDesktopSecondaryBootstraps } from "./desktopLocal";

/**
 * Re-reads when the desktop shell reports a topology change, subscribing before
 * the first read so no change falls between them. Failed reads retain the latest
 * successful snapshot, while a successful empty read clears it. The reader
 * returns the same array while nothing changed, so an unchanged read notifies no one.
 */
export const desktopLocalBootstrapsAtom = Atom.make((get) => {
  const unsubscribe = window.desktopBridge?.onLocalEnvironmentBootstrapsChanged?.(() =>
    get.setSelf(readDesktopSecondaryBootstraps()),
  );
  get.addFinalizer(() => unsubscribe?.());
  return readDesktopSecondaryBootstraps();
}).pipe(Atom.withLabel("desktop-local-bootstraps"));

export function useDesktopLocalBootstraps(): ReadonlyArray<DesktopEnvironmentBootstrap> {
  return useAtomValue(desktopLocalBootstrapsAtom);
}
