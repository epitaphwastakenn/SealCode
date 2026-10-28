const listeners = new Set<() => void>();

/**
 * Called once the document's colors, fonts or radius have been rewritten. Code that has to
 * recompute from the new styles subscribes here instead of watching `<html>` attributes, which
 * fire several times for a single change (palette, `dark`, transition guards, reveal state).
 */
export function bumpThemeEpoch(): void {
  for (const listener of listeners) listener();
}

export function subscribeThemeEpoch(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
