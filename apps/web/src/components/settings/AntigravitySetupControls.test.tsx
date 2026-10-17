import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";
import { visitElements } from "../../test/reactElementTree";

const mocks = vi.hoisted(() => ({
  setup: vi.fn(),
  openExternal: vi.fn(),
  effects: [] as Array<() => void | (() => void)>,
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useState: reactHookHarness.useState,
    useRef: reactHookHarness.useRef,
    useCallback: reactHookHarness.useCallback,
    useEffect: (effect: () => void | (() => void)) => mocks.effects.push(effect),
  };
});
vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});
vi.mock("../../state/server", () => ({ serverEnvironment: { setupProvider: Symbol() } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.setup }));
vi.mock("../../localApi", () => ({
  ensureLocalApi: () => ({ shell: { openExternal: mocks.openExternal } }),
}));

import { AntigravitySetupControls } from "./AntigravitySetupControls";

const url = "https://accounts.google.com/o/oauth2/auth?state=current";
const cleanups: Array<() => void> = [];
function render() {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  hooks.beginRender();
  mocks.effects = [];
  const tree = AntigravitySetupControls({
    environmentId: EnvironmentId.make("local"),
    instanceId: ProviderInstanceId.make("antigravity"),
  });
  for (const effect of mocks.effects) {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  }
  return tree;
}

beforeEach(() => {
  hooks.reset();
  vi.useFakeTimers();
  mocks.openExternal.mockReset().mockResolvedValue(undefined);
  mocks.setup.mockReset().mockResolvedValue({
    _tag: "Success",
    value: { phase: "signing-in", authorizationUrl: url, message: "Complete Google sign-in." },
  });
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.useRealTimers();
});

describe("Antigravity sign-in", () => {
  it("opens the client browser once when the URL arrives and lets the user reopen it", async () => {
    render();
    await mocks.setup.mock.results[0]!.value;
    const tree = render();
    expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(url);
    render();
    expect(mocks.openExternal).toHaveBeenCalledTimes(1);
    const input = visitElements(
      tree,
      (element) => element.props["aria-label"] === "Google sign-in URL",
    );
    expect(input?.props).toMatchObject({ readOnly: true, value: url });
    const button = visitElements(
      tree,
      (element) => element.props.children === "Open Google sign-in",
    );
    (button!.props.onClick as () => void)();
    expect(mocks.openExternal).toHaveBeenCalledTimes(2);
  });

  it("keeps a copyable URL and explains browser launch failures", async () => {
    mocks.openExternal.mockRejectedValue(new Error("Unable to open link."));
    render();
    await mocks.setup.mock.results[0]!.value;
    render();
    await Promise.resolve();
    const tree = render();
    expect(
      visitElements(tree, (element) => element.props.role === "alert")?.props.children,
    ).toContain("Copy the sign-in URL");
    expect(
      visitElements(tree, (element) => element.props["aria-label"] === "Google sign-in URL")?.props
        .value,
    ).toBe(url);
  });
});
