import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, vi } from "vite-plus/test";

import {
  type ChatAttachment,
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
} from "@t3tools/contracts";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import { RobloxStudioConfig } from "../roblox/RobloxStudioConfig.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as SealTurnInput from "./SealTurnInput.ts";

const image = {
  type: "image",
  id: "image-1",
  name: "screen.png",
  mimeType: "image/png",
  sizeBytes: 12,
} as unknown as ChatAttachment;
const file = {
  type: "file",
  id: "file-1",
  name: "notes.txt",
  mimeType: "text/plain",
  sizeBytes: 4,
} as unknown as ChatAttachment;

const mainSelection = {
  instanceId: ProviderInstanceId.make("headless"),
  model: "text-only",
} as ModelSelection;
const viewerSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4-mini",
} as ModelSelection;

const claudeViewerSelection = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-haiku",
} as ModelSelection;

const harness = (input: {
  readonly sealsInstructions?: string;
  readonly imageViewerEnabled?: boolean;
  readonly mainVision: boolean | undefined;
  readonly viewer?: ModelSelection;
  readonly viewerDriver?: string;
  readonly viewerVision?: boolean;
  readonly describe?: ReturnType<typeof vi.fn>;
}) => {
  const describeImages =
    input.describe ?? vi.fn(() => Effect.succeed({ description: "  a red button  " }));
  const viewer = input.viewer ?? viewerSelection;
  const instance = (driver: string, slug: string, vision?: boolean) =>
    ({
      driverKind: ProviderDriverKind.make(driver),
      snapshot: {
        getSnapshot: Effect.succeed({
          models: [
            {
              slug,
              capabilities: vision === undefined ? { optionDescriptors: [] } : { vision },
            },
          ],
        }),
      },
    }) as never;
  const layer = SealTurnInput.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ServerSettings.ServerSettingsService)({
          getSettings: Effect.succeed({
            sealsInstructions: input.sealsInstructions ?? "",
            imageViewerEnabled: input.imageViewerEnabled ?? true,
            imageViewerModelSelection: viewer,
          } as never),
        }),
        Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
          getInstance: (id) =>
            Effect.succeed(
              id === mainSelection.instanceId
                ? instance("headless", mainSelection.model, input.mainVision)
                : id === viewer.instanceId && input.viewerDriver !== "none"
                  ? instance(
                      input.viewerDriver ??
                        (viewer === claudeViewerSelection ? "claudeAgent" : "codex"),
                      viewer.model,
                      input.viewerVision,
                    )
                  : undefined,
            ),
        }),
        Layer.mock(TextGeneration.TextGeneration)({ describeImages: describeImages as never }),
      ),
    ),
  );
  const prepare = (text: string, attachments: ReadonlyArray<ChatAttachment>) =>
    SealTurnInput.SealTurnInputV2.pipe(
      Effect.flatMap((service) =>
        service.prepare({ cwd: "/work", modelSelection: mainSelection, text, attachments }),
      ),
      Effect.provide(layer),
    );
  return { prepare, describeImages };
};

describe("SealTurnInput", () => {
  it.effect("opens every turn with the Seals.md rules", () =>
    Effect.gen(function* () {
      const { prepare } = harness({
        sealsInstructions: "Always answer in Portuguese.",
        mainVision: true,
      });
      const prepared = yield* prepare("fix the bug", []);
      expect(prepared.text).toBe("fix the bug");
      expect(prepared.frame(prepared.text)).toBe(
        "<sealcode_harness_instructions>\nAlways answer in Portuguese.\n</sealcode_harness_instructions>\n\nfix the bug",
      );
    }),
  );

  it.effect("adds nothing when no rules are set and leaves slash commands alone", () =>
    Effect.gen(function* () {
      const none = yield* harness({ mainVision: true }).prepare("hello", []);
      expect(none.frame("hello")).toBe("hello");
      const command = yield* harness({ sealsInstructions: "rules", mainVision: true }).prepare(
        "/compact",
        [],
      );
      expect(command.frame("/compact")).toBe("/compact");
    }),
  );

  it.effect("describes images for a model without vision and drops them from the turn", () =>
    Effect.gen(function* () {
      const { prepare, describeImages } = harness({ mainVision: false });
      const prepared = yield* prepare("what is wrong here?", [image, file]);
      expect(describeImages).toHaveBeenCalledWith({
        cwd: "/work",
        message: "what is wrong here?",
        attachments: [image, file],
        modelSelection: viewerSelection,
      });
      expect(prepared.text).toBe(
        "<image-viewer-description>\na red button\n</image-viewer-description>\n\n<user-request>\nwhat is wrong here?\n</user-request>",
      );
      expect(prepared.attachments).toEqual([file]);
    }),
  );

  it.effect("sends images natively when the model has vision or does not report it", () =>
    Effect.gen(function* () {
      for (const mainVision of [true, undefined]) {
        const { prepare, describeImages } = harness({ mainVision });
        const prepared = yield* prepare("look", [image]);
        expect(describeImages).not.toHaveBeenCalled();
        expect(prepared.attachments).toEqual([image]);
      }
    }),
  );

  it.effect("sends images to the main model untouched while the image viewer is off", () =>
    Effect.gen(function* () {
      const { prepare, describeImages } = harness({ mainVision: false, imageViewerEnabled: false });
      const prepared = yield* prepare("what is wrong here?", [image, file]);
      expect(describeImages).not.toHaveBeenCalled();
      expect(prepared.text).toBe("what is wrong here?");
      expect(prepared.attachments).toEqual([image, file]);
    }),
  );

  it.effect("lets a Claude model describe the images", () =>
    Effect.gen(function* () {
      const { prepare, describeImages } = harness({
        mainVision: false,
        viewer: claudeViewerSelection,
      });
      const prepared = yield* prepare("what is wrong here?", [image]);
      expect(describeImages).toHaveBeenCalledWith({
        cwd: "/work",
        message: "what is wrong here?",
        attachments: [image],
        modelSelection: claudeViewerSelection,
      });
      expect(prepared.attachments).toEqual([]);
    }),
  );

  it.effect("accepts any viewer that reports vision", () =>
    Effect.gen(function* () {
      const { prepare, describeImages } = harness({
        mainVision: false,
        viewerDriver: "opencode",
        viewerVision: true,
      });
      yield* prepare("look", [image]);
      expect(describeImages).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("rejects a viewer that cannot see and points to the viewer picker", () =>
    Effect.gen(function* () {
      for (const options of [
        { viewerDriver: "none" },
        { viewerDriver: "opencode" },
        { viewerDriver: "claudeAgent", viewerVision: false },
        { viewerDriver: "codex", viewerVision: false },
      ]) {
        const { prepare, describeImages } = harness({ mainVision: false, ...options });
        const error = yield* Effect.flip(prepare("look", [image]));
        expect(error.detail).toBe(
          `The selected model cannot interpret images. ${SealTurnInput.IMAGE_VIEWER_HINT}`,
        );
        expect(describeImages).not.toHaveBeenCalled();
      }
    }),
  );

  it.effect("surfaces a viewer failure with the same hint", () =>
    Effect.gen(function* () {
      const { prepare } = harness({
        mainVision: false,
        describe: vi.fn(() =>
          Effect.fail(
            new (class extends Error {
              readonly _tag = "TextGenerationError";
              readonly detail = "Codex CLI request timed out.";
            })(),
          ),
        ),
      });
      const error = yield* Effect.flip(prepare("look", [image]));
      expect(error.detail).toBe(`Codex CLI request timed out. ${SealTurnInput.IMAGE_VIEWER_HINT}`);
    }),
  );

  it.effect("gives a provider conversation the Studio instructions once, when it starts", () =>
    Effect.gen(function* () {
      const layer = SealTurnInput.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ServerSettings.ServerSettingsService)({
              getSettings: Effect.succeed({
                sealsInstructions: "Seals rule.",
                imageViewerEnabled: false,
              } as never),
            }),
            Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
              // @effect-diagnostics-next-line effectSucceedWithVoid:off - A missing instance is a value, not a void step.
              getInstance: () => Effect.succeed(undefined),
            }),
            Layer.mock(TextGeneration.TextGeneration)({}),
            Layer.succeed(RobloxStudioConfig, {
              ...RobloxStudioConfig.defaultValue(),
              instructions: (_settings, input) =>
                Effect.succeed(
                  input.workspaceRoot === "/game" ? "Use the Studio tools." : undefined,
                ),
            }),
          ),
        ),
      );
      yield* Effect.gen(function* () {
        const service = yield* SealTurnInput.SealTurnInputV2;
        const turn = (
          providerThreadId: string,
          freshConversation: boolean,
          workspaceRoot = "/game",
        ) =>
          service
            .prepare({
              cwd: workspaceRoot,
              workspaceRoot,
              providerThreadId,
              freshConversation,
              modelSelection: mainSelection,
              text: "build a tower",
              attachments: [],
            })
            .pipe(Effect.map((prepared) => prepared.frame(prepared.text)));

        expect(yield* turn("conversation-1", true)).toBe(
          "<sealcode_harness_instructions>\nSeals rule.\n\n<studio_instructions>\nUse the Studio tools.\n</studio_instructions>\n</sealcode_harness_instructions>\n\nbuild a tower",
        );
        expect(yield* turn("conversation-1", false)).not.toContain("studio_instructions");
        // A conversation SealCode has not given them to in this process gets them once.
        expect(yield* turn("conversation-2", false)).toContain("<studio_instructions>");
        expect(yield* turn("conversation-2", false)).not.toContain("studio_instructions");
        expect(yield* turn("conversation-3", true, "/elsewhere")).not.toContain(
          "studio_instructions",
        );
      }).pipe(Effect.provide(layer));
    }),
  );
});
