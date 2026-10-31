import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import { EnvironmentId, ThreadId, TurnItemId, type SnapShotSource } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { ExpandedImageDialog } from "./ExpandedImageDialog";
import { buildTurnImagesPreview } from "./turnImagesPreview";

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

vi.mock(import("~/state/assets"), async (original) => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const minted = AsyncResult.success({
    relativeUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    expiresAt: Number.MAX_SAFE_INTEGER,
  });
  const createUrl = Atom.family((_key: string) => Atom.make(() => minted).pipe(Atom.keepAlive));
  const createUrls = Atom.family((key: string) =>
    Atom.make(() => (JSON.parse(key)[1] as ReadonlyArray<unknown>).map(() => minted)).pipe(
      Atom.keepAlive,
    ),
  );
  const actual = await original();
  return {
    ...actual,
    assetEnvironment: {
      ...actual.assetEnvironment,
      createUrl: (target: { readonly input: unknown }) => createUrl(JSON.stringify(target.input)),
      createUrls: (target: { readonly environmentId: unknown; readonly resources: unknown }) =>
        createUrls(JSON.stringify([target.environmentId, target.resources])),
    },
  };
});
vi.mock(import("~/state/session"), async (original) => {
  const { Option } = await import("effect");
  const { PrimaryConnectionTarget } = await import("@t3tools/client-runtime/connection");
  const target = new PrimaryConnectionTarget({
    environmentId: EnvironmentId.make("environment-1"),
    label: "Local",
    httpBaseUrl: "http://localhost:1",
    wsBaseUrl: "ws://localhost:1",
  });
  const prepared: PreparedConnection = {
    environmentId: target.environmentId,
    label: target.label,
    httpBaseUrl: target.httpBaseUrl,
    socketUrl: target.wsBaseUrl,
    httpAuthorization: null,
    target,
  };
  return {
    ...(await original()),
    usePreparedConnection: () => Option.some(prepared),
  };
});
vi.mock(import("~/state/filesystem"), async (original) => ({
  ...(await original()),
  useFilesystemReadAccess: () => ({ canReadFiles: true, isPending: false, error: null }),
}));

const snapShotSource: SnapShotSource = {
  kind: "snap-shot",
  capturedAt: "2026-01-01T00:00:00.000Z",
  appName: "Finder",
  windowTitle: "Downloads",
};

const environmentId = EnvironmentId.make("environment-1");
const shots = ["a", "b", "c"].map((itemId) => ({
  _tag: "tool-output-image" as const,
  threadId: ThreadId.make("thread-1"),
  itemId: TurnItemId.make(itemId),
  index: 0,
}));

describe("ExpandedImageDialog", () => {
  it("Escape closes a popup opened inside the dialog before the dialog", async () => {
    const onClose = vi.fn();
    await using screen = await render(
      <ExpandedImageDialog
        preview={{ images: [{ src: PIXEL, name: "shot.png", source: snapShotSource }], index: 0 }}
        onClose={onClose}
      />,
      // The dialog renders no links and reads no route.
      { router: false },
    );

    await userEvent.click(screen.getByRole("button", { name: "No accessibility data" }));
    await expect.element(screen.getByText("Accessibility data")).toBeVisible();

    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByText("Accessibility data")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Focus returns to the popup's trigger and opens its tooltip; leave it for a plain control.
    (screen.getByRole("button", { name: "Close image preview" }).element() as HTMLElement).focus();
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("shows asset-only shots and flips through them by filmstrip, keys and swipe", async () => {
    await using _screen = await render(
      <ExpandedImageDialog
        preview={buildTurnImagesPreview(environmentId, shots, 0)}
        onClose={vi.fn()}
      />,
      { router: false },
    );
    const caption = (position: number) => page.getByText(`Screenshot (${position}/3)`);

    await expect.element(page.getByRole("img", { name: "Screenshot" })).toBeVisible();
    await expect.element(caption(1)).toBeVisible();

    await userEvent.click(page.getByRole("button", { name: "Show Screenshot 3 of 3" }));
    await expect.element(caption(3)).toBeVisible();

    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(caption(2)).toBeVisible();
    await userEvent.keyboard("{Home}");
    await expect.element(caption(1)).toBeVisible();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(caption(3)).toBeVisible();
    await userEvent.keyboard("{End}");
    await expect.element(caption(3)).toBeVisible();

    const image = page.getByRole("img", { name: "Screenshot" }).element();
    const touch = (type: string, clientX: number, clientY: number) =>
      image.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 7,
          pointerType: "touch",
          clientX,
          clientY,
        }),
      );
    touch("pointerdown", 300, 200);
    touch("pointerup", 200, 210);
    await expect.element(caption(1)).toBeVisible();
    touch("pointerdown", 200, 200);
    touch("pointerup", 300, 205);
    await expect.element(caption(3)).toBeVisible();
    touch("pointerdown", 200, 200);
    touch("pointerup", 215, 205);
    touch("pointerdown", 200, 200);
    touch("pointerup", 205, 330);
    await expect.element(caption(3)).toBeVisible();
  });
});
