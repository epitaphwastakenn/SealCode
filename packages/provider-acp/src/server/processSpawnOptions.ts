/**
 * A detached Windows child has no console, so every console tool it starts opens a visible window
 * whose closing kills the agent. Attached with `windowsHide`, the tree shares one hidden console;
 * Windows ends the tree by PID either way, so only POSIX needs the detached process group.
 */
export function ownedProcessSpawnOptions(
  ownDetachedProcessGroup: boolean | undefined,
  platform: NodeJS.Platform | undefined,
): { readonly detached?: boolean; readonly windowsHide?: true } {
  if (ownDetachedProcessGroup === undefined) return {};
  return {
    detached: platform === "win32" ? false : ownDetachedProcessGroup,
    windowsHide: true,
  };
}
