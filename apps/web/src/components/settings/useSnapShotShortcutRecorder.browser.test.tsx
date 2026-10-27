import { act, render } from "../../../test/render";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import { userEvent } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";

const suppress = vi.hoisted(() => vi.fn<(enabled: boolean) => Promise<void>>());
vi.mock(import("../../lib/desktopSnapShot"), async (original) => ({
  ...(await original()),
  getDesktopSnapShotBridge: () => ({ setSnapShotShortcutSuppressed: suppress }) as never,
}));

import { useSnapShotShortcutRecorder } from "./useSnapShotShortcutRecorder";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const recorded = vi.fn();
const error = vi.fn();

function Recorder() {
  const recorder = useSnapShotShortcutRecorder({
    shortcut: DEFAULT_CLIENT_SETTINGS.snapShotShortcut,
    onRecord: recorded,
    onError: error,
  });
  return recorder.input;
}

function setup() {
  suppress.mockReset().mockResolvedValue(undefined);
  recorded.mockReset();
  error.mockReset();
}
async function renderRecorder() {
  const screen = await render(<Recorder />);
  const button = () =>
    screen.container.querySelector<HTMLButtonElement>("[data-keybinding-capture]")!;
  // aria-pressed mirrors the hook's recording state, which flips once suppression resolves.
  const expectRecording = (recording: boolean) =>
    expect.element(screen.getByRole("button")).toHaveAttribute("aria-pressed", String(recording));
  return {
    ...screen,
    button,
    expectRecording,
    async start() {
      await userEvent.click(button());
      await expectRecording(true);
    },
  };
}

it("ignores late suppression acknowledgements after cancellation", async () => {
  setup();
  const pending = deferred<void>();
  suppress.mockImplementation((enabled) => (enabled ? pending.promise : Promise.resolve()));
  await using screen = await renderRecorder();
  const { button } = screen;
  await userEvent.click(button());
  await act(async () => button().blur());
  await act(async () => pending.resolve());
  await screen.expectRecording(false);
  expect(suppress).toHaveBeenLastCalledWith(false);
  expect(recorded).not.toHaveBeenCalled();
});
