import { type ChatAttachment, ProviderDriverKind, type ModelSelection } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";

export const IMAGE_VIEWER_HINT =
  "Selecione um modelo visualizador para dar capacidades de visão à este modelo.";

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
    readonly modelSelection: ModelSelection;
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

export const withImageDescription = (text: string, description: string): string =>
  `<image-viewer-description>\n${description.trim()}\n</image-viewer-description>\n\n<user-request>\n${text}\n</user-request>`;

/** Slash commands are parsed by the provider, so a preamble would turn them into prose. */
const isSlashCommand = (text: string, attachments: ReadonlyArray<ChatAttachment>) =>
  attachments.length === 0 && text.trimStart().startsWith("/");

const CODEX_DRIVER = ProviderDriverKind.make("codex");

export const layer = Layer.effect(
  SealTurnInputV2,
  Effect.gen(function* () {
    const settings = yield* ServerSettings.ServerSettingsService;
    const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
    const textGeneration = yield* TextGeneration.TextGeneration;

    // Unknown capability is not "no vision": drivers that never report it must keep sending images natively.
    const lacksVision = (selection: ModelSelection) =>
      Effect.gen(function* () {
        const instance = yield* registry.getInstance(selection.instanceId);
        if (instance === undefined) return false;
        const snapshot = yield* instance.snapshot.getSnapshot.pipe(Effect.option);
        if (snapshot._tag === "None") return false;
        return (
          snapshot.value.models.find((model) => model.slug === selection.model)?.capabilities
            ?.vision === false
        );
      });

    const describe = Effect.fn("SealTurnInput.describe")(function* (input: {
      readonly viewer: ModelSelection;
      readonly cwd: string;
      readonly text: string;
      readonly attachments: ReadonlyArray<ChatAttachment>;
    }) {
      const viewerInstance = yield* registry.getInstance(input.viewer.instanceId);
      if (viewerInstance?.driverKind !== CODEX_DRIVER) {
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
        if (
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
        return {
          text,
          attachments,
          frame: (framed) => frameWithSealsInstructions(current.sealsInstructions, framed),
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
