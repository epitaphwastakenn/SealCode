import {
  type ChatAttachment,
  type ModelSelection,
  type OrchestrationV2StudioControls,
} from "@t3tools/contracts";
import { modelHasVision } from "@t3tools/shared/model";
import { isStudioPlaceExcluded } from "@t3tools/shared/studioControls";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as RobloxStudioConfig from "../roblox/RobloxStudioConfig.ts";
import * as ServerSettings from "../serverSettings.ts";
import { studioControlsContext, studioSelectionContext } from "../studioBridge/instructions.ts";
import * as StudioBridge from "../studioBridge/StudioBridge.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";

export const IMAGE_VIEWER_HINT = "Choose an image viewer model to give this model vision.";

export class SealTurnInputError extends Schema.TaggedError<SealTurnInputError>()(
  "SealTurnInputError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface SealTurnInput {
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  /** Wraps the final provider text; handoff context is built later and must still follow it. */
  readonly frame: (text: string) => string;
}

export interface SealTurnInputShape {
  readonly prepare: (input: {
    readonly cwd: string;
    /** The project's root, which decides whether the thread is a Roblox project. */
    readonly workspaceRoot?: string | undefined;
    /** The provider conversation this turn joins, and whether it has no turns yet. */
    readonly providerThreadId?: string | undefined;
    readonly freshConversation?: boolean | undefined;
    readonly modelSelection: ModelSelection;
    readonly studioControls?: OrchestrationV2StudioControls | undefined;
    readonly text: string;
    readonly attachments: ReadonlyArray<ChatAttachment>;
  }) => Effect.Effect<SealTurnInput, SealTurnInputError>;
}

export class SealTurnInputV2 extends Context.Service<SealTurnInputV2, SealTurnInputShape>()(
  "t3/orchestration-v2/SealTurnInput/SealTurnInputV2",
) {}

export const frameWithSealsInstructions = (instructions: string, text: string): string => {
  const rules = instructions.trim();
  return rules === ""
    ? text
    : `<sealcode_harness_instructions>\n${rules}\n</sealcode_harness_instructions>\n\n${text}`;
};

export const withStudioInstructions = (instructions: string): string =>
  `<studio_instructions>\n${instructions.trim()}\n</studio_instructions>`;

export const withImageDescription = (text: string, description: string): string =>
  `<image-viewer-description>\n${description.trim()}\n</image-viewer-description>\n\n<user-request>\n${text}\n</user-request>`;

/** Slash commands are parsed by the provider, so a preamble would turn them into prose. */
const isSlashCommand = (text: string, attachments: ReadonlyArray<ChatAttachment>) =>
  attachments.length === 0 && text.trimStart().startsWith("/");

export const layer = Layer.effect(
  SealTurnInputV2,
  Effect.gen(function* () {
    const settings = yield* ServerSettings.ServerSettingsService;
    const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
    const textGeneration = yield* TextGeneration.TextGeneration;
    const roblox = yield* RobloxStudioConfig.RobloxStudioConfig;
    const studioBridge = yield* Effect.serviceOption(StudioBridge.StudioBridge);
    // The Studio instructions are long, so a provider conversation gets them once rather than on
    // every turn: when it starts, and once more after a server restart or a settings change.
    const studioDelivered = new Map<string, string>();

    const lookupModel = (selection: ModelSelection) =>
      Effect.gen(function* () {
        const instance = yield* registry.getInstance(selection.instanceId);
        if (instance === undefined) return undefined;
        const snapshot = yield* instance.snapshot.getSnapshot.pipe(Effect.option);
        return {
          driverKind: instance.driverKind,
          capabilities:
            snapshot._tag === "None"
              ? undefined
              : snapshot.value.models.find((model) => model.slug === selection.model)?.capabilities,
        };
      });

    // Unknown capability is not "no vision": drivers that never report it must keep sending images natively.
    const lacksVision = (selection: ModelSelection) =>
      lookupModel(selection).pipe(Effect.map((model) => model?.capabilities?.vision === false));

    const describe = Effect.fn("SealTurnInput.describe")(function* (input: {
      readonly viewer: ModelSelection;
      readonly cwd: string;
      readonly text: string;
      readonly attachments: ReadonlyArray<ChatAttachment>;
    }) {
      const viewer = yield* lookupModel(input.viewer);
      if (viewer === undefined || !modelHasVision(viewer)) {
        return yield* new SealTurnInputError({
          detail: `The selected model cannot interpret images. ${IMAGE_VIEWER_HINT}`,
        });
      }
      if (textGeneration.describeImages === undefined) {
        return yield* new SealTurnInputError({
          detail: `Image description is unavailable. ${IMAGE_VIEWER_HINT}`,
        });
      }
      const described = yield* textGeneration
        .describeImages({
          cwd: input.cwd,
          message: input.text,
          attachments: input.attachments,
          modelSelection: input.viewer,
        })
        .pipe(
          Effect.mapError(
            (error) => new SealTurnInputError({ detail: `${error.detail} ${IMAGE_VIEWER_HINT}` }),
          ),
        );
      return described.description;
    });

    const prepare: SealTurnInputShape["prepare"] = Effect.fn("SealTurnInput.prepare")(
      function* (input) {
        if (isSlashCommand(input.text, input.attachments)) {
          return { text: input.text, attachments: input.attachments, frame: (text) => text };
        }
        const current = yield* settings.getSettings.pipe(
          Effect.mapError((cause) => new SealTurnInputError({ detail: cause.message })),
        );
        let text = input.text;
        let attachments = input.attachments;
        // Off by default: images then reach the main model untouched, with no error of ours.
        if (
          current.imageViewerEnabled &&
          attachments.some((attachment) => attachment.type === "image") &&
          (yield* lacksVision(input.modelSelection))
        ) {
          const description = yield* describe({
            viewer: current.imageViewerModelSelection,
            cwd: input.cwd,
            text: input.text,
            attachments,
          });
          text = withImageDescription(input.text, description);
          attachments = attachments.filter((attachment) => attachment.type !== "image");
        }
        const studio = yield* roblox.instructions(current, {
          workspaceRoot: input.workspaceRoot,
          cwd: input.cwd,
        });
        const conversation = input.providerThreadId;
        const sendStudio =
          studio !== undefined &&
          (input.freshConversation === true ||
            conversation === undefined ||
            studioDelivered.get(conversation) !== studio);
        if (studio !== undefined && conversation !== undefined) {
          studioDelivered.set(conversation, studio);
          if (studioDelivered.size > 512) {
            studioDelivered.delete(studioDelivered.keys().next().value ?? conversation);
          }
        }
        // Unlike the instructions, the Studio selection changes between turns, so it rides on each.
        const studioApplies =
          studioBridge._tag === "Some" &&
          current.robloxStudio.mode === "sealcode" &&
          (yield* roblox.appliesTo(current, input.workspaceRoot ?? input.cwd));
        const studioContext =
          studioBridge._tag === "Some" && studioApplies && current.robloxStudio.studioContext
            ? studioSelectionContext(
                (yield* studioBridge.value.selections).filter(
                  (selection) => !isStudioPlaceExcluded(input.studioControls, selection.instanceId),
                ),
              )
            : undefined;
        const studioLimits = studioApplies
          ? studioControlsContext(input.studioControls)
          : undefined;
        const harness = [
          current.sealsInstructions.trim(),
          sendStudio && studio !== undefined ? withStudioInstructions(studio) : "",
          studioContext ?? "",
          studioLimits ?? "",
        ]
          .filter((part) => part.length > 0)
          .join("\n\n");
        return {
          text,
          attachments,
          frame: (framed) => frameWithSealsInstructions(harness, framed),
        };
      },
    );

    return SealTurnInputV2.of({ prepare });
  }),
);

/** For harnesses that exercise turn start without Seals settings or a viewer model. */
export const layerPassthrough = Layer.succeed(
  SealTurnInputV2,
  SealTurnInputV2.of({
    prepare: (input) =>
      Effect.succeed({ text: input.text, attachments: input.attachments, frame: (text) => text }),
  }),
);
