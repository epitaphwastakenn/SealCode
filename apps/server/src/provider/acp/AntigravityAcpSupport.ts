import {
  ANTIGRAVITY_DEFAULT_MODEL,
  type AntigravityAuthMethod,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ProviderOptionSelection,
  type ProviderSendTurnInput,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/compat";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import {
  makeAntigravityStderrHandler,
  makeAntigravityStdoutTransform,
} from "../antigravityAuthSupport.ts";
import * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import {
  antigravityEffortSelection,
  antigravitySessionModels,
  groupAntigravityModels,
  resolveAntigravityModelId,
} from "../antigravityModelVariants.ts";
import {
  makeAntigravityHarnessNoticeFilter,
  normalizeAntigravitySessionUpdate,
} from "./AntigravityProtocol.ts";

export interface AntigravityAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  | "authMethodId"
  | "authenticateEagerly"
  | "cancelBehavior"
  | "clientCapabilities"
  | "onStderr"
  | "resumeMethod"
  | "transformSessionUpdate"
  | "transformStdout"
> {
  readonly agentDeviceEnvironment?: Readonly<Record<string, string>>;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly onAuthorizationUrl?: (url: string) => Effect.Effect<void, EffectAcpErrors.AcpError>;
  readonly clientFileSystem?: boolean;
  readonly authMethod?: AntigravityAuthMethod;
}

export const makeAntigravityAcpRuntime = Effect.fn("makeAntigravityAcpRuntime")(function* (
  input: AntigravityAcpRuntimeInput,
): Effect.fn.Return<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> {
  const harnessNotices = makeAntigravityHarnessNoticeFilter();
  const context = yield* Layer.build(
    AcpSessionRuntime.layer({
      ...input,
      authMethodId: input.authMethod ?? "oauth-personal",
      authenticateEagerly: true,
      resumeMethod: "resume",
      cancelBehavior: "wait-for-prompt",
      // Owning the process tree is what lets Stop tear it down at once (see the
      // adapter flavor): Antigravity's own cancel waits for the current step.
      ownDetachedProcessGroup: true,
      processGroupPlatform: input.processGroupPlatform ?? (yield* HostProcess.Platform),
      clientCapabilities: {
        fs: {
          readTextFile: input.clientFileSystem === true,
          writeTextFile: input.clientFileSystem === true,
        },
        terminal: false,
      },
      transformStdout: makeAntigravityStdoutTransform(
        input.onAuthorizationUrl ? { onAuthorizationUrl: input.onAuthorizationUrl } : {},
      ),
      onStderr: makeAntigravityStderrHandler(
        input.onAuthorizationUrl ? { onAuthorizationUrl: input.onAuthorizationUrl } : {},
      ),
      transformSessionUpdate: (notification) =>
        harnessNotices.transform(normalizeAntigravitySessionUpdate(notification)),
    }).pipe(
      Layer.provide(
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
      ),
    ),
  );
  const runtime = yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
    Effect.provide(context),
  );
  return {
    ...runtime,
    prompt: (payload, options) =>
      Effect.sync(harnessNotices.reset).pipe(Effect.andThen(runtime.prompt(payload, options))),
  };
});

export function antigravityPermissionMode(runtimeMode: RuntimeMode): string {
  switch (runtimeMode) {
    case "full-access":
      return "yolo";
    case "auto-accept-edits":
      return "auto_edit";
    case "auto":
    case "approval-required":
      return "default";
  }
}

/**
 * Resolves the picker's (model, reasoning level) to a model id the session
 * accepts and selects it. Never replaces a saved selection with the default
 * returned by a cold resume.
 */
export const applyAntigravityAcpModelSelection = Effect.fn("applyAntigravityAcpModelSelection")(
  function* <E>(input: {
    readonly runtime: Pick<
      AcpSessionRuntime.AcpSessionRuntime["Service"],
      "getConfigOptions" | "setModel"
    > &
      Partial<
        Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setConfigOption" | "setSessionModel">
      >;
    readonly model: string | null | undefined;
    readonly options?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
    /** The setup response's legacy model list; it can offer models the config select omits. */
    readonly legacyModels?: EffectAcpSchema.SessionModelState | null | undefined;
    readonly defaultModel?: string | undefined;
    readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
  }): Effect.fn.Return<string | undefined, E> {
    const configOptions = yield* input.runtime.getConfigOptions;
    const session = antigravitySessionModels({ configOptions, models: input.legacyModels });
    const families = groupAntigravityModels(session.entries);
    const current = session.currentValue;
    const effort = antigravityEffortSelection(input.options);
    const resolve = (model: string) =>
      resolveAntigravityModelId({
        families,
        model,
        effort,
        currentValue: current,
        defaultModel: input.defaultModel,
      });
    const unavailable = (model: string) =>
      input.mapError(
        EffectAcpErrors.AcpRequestError.invalidParams(
          `Antigravity model '${model}' is unavailable for this Google account. Select an available model.`,
        ),
      );
    const select = Effect.fn("applyAntigravityAcpModelSelection.select")(function* (
      modelId: string,
    ) {
      const configSelection = session.configSelections.get(modelId);
      const level = configSelection?.level;
      const setConfigOption = input.runtime.setConfigOption;
      if (configSelection !== undefined && (level === undefined || setConfigOption !== undefined)) {
        yield* input.runtime.setModel(configSelection.model).pipe(Effect.mapError(input.mapError));
        if (level !== undefined && setConfigOption !== undefined) {
          yield* setConfigOption(level.configId, level.value).pipe(Effect.mapError(input.mapError));
        }
      } else if (input.runtime.setSessionModel !== undefined) {
        yield* input.runtime.setSessionModel(modelId).pipe(Effect.mapError(input.mapError));
      } else {
        return yield* Effect.fail(unavailable(modelId));
      }
      return modelId;
    });

    const explicitModel =
      input.model && input.model !== ANTIGRAVITY_DEFAULT_MODEL ? input.model : undefined;
    if (explicitModel !== undefined) {
      const resolved = resolve(explicitModel);
      return resolved === undefined
        ? yield* Effect.fail(unavailable(explicitModel))
        : yield* select(resolved);
    }
    const defaultModel =
      input.defaultModel !== undefined && resolve(input.defaultModel) !== undefined
        ? input.defaultModel
        : current;
    const resolved = defaultModel === undefined ? undefined : resolve(defaultModel);
    return resolved === undefined || resolved === current ? current : yield* select(resolved);
  },
);

const IMAGE_MIME_TYPES = new Set(["image/bmp", "image/jpeg", "image/png", "image/webp"]);
const AUDIO_MIME_TYPES = new Set([
  "audio/aac",
  "audio/flac",
  "audio/mp3",
  "audio/mpeg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
]);
const ANTIGRAVITY_MAX_AUDIO_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/javascript",
  "application/typescript",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/x-sh",
]);
const TEXT_FILE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".mdx",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".csv",
  ".tsv",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".html",
  ".css",
  ".scss",
  ".less",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".cs",
  ".rb",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".sql",
  ".graphql",
  ".svelte",
  ".vue",
  ".log",
  ".diff",
  ".patch",
  ".ini",
  ".conf",
]);
const ANTIGRAVITY_MAX_TEXT_ATTACHMENT_BYTES = 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = PROVIDER_SEND_TURN_MAX_FILE_BYTES;

export const buildAntigravityPrompt = Effect.fn("buildAntigravityPrompt")(function* (input: {
  readonly input: ProviderSendTurnInput["input"];
  readonly attachments: ProviderSendTurnInput["attachments"];
  readonly attachmentsDir: string;
  readonly promptCapabilities: EffectAcpSchema.AgentCapabilities["promptCapabilities"];
}): Effect.fn.Return<
  ReadonlyArray<EffectAcpSchema.ContentBlock>,
  EffectAcpErrors.AcpError,
  FileSystem.FileSystem | Path.Path
> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const blocks: Array<EffectAcpSchema.ContentBlock> = [];
  const text = input.input?.trim();
  if (text) blocks.push({ type: "text", text });
  let totalBytes = 0;

  for (const attachment of input.attachments ?? []) {
    const isPastedText =
      attachment.type === "file" &&
      "source" in attachment &&
      attachment.source?._tag === "pasted-text";
    // The text already carries the path; keep folded pastes lazy so agents can search without embedding the whole file.
    const mimeType = attachment.mimeType.toLowerCase().split(";", 1)[0] ?? "";
    const image = attachment.type === "image" && IMAGE_MIME_TYPES.has(mimeType);
    const audio = attachment.type === "file" && AUDIO_MIME_TYPES.has(mimeType);
    const pdf = attachment.type === "file" && mimeType === "application/pdf";
    const textFile =
      attachment.type === "file" &&
      (mimeType.startsWith("text/") ||
        TEXT_MIME_TYPES.has(mimeType) ||
        TEXT_FILE_EXTENSIONS.has(path.extname(attachment.name).toLowerCase()));
    const isPathOnly =
      (attachment.type === "image" && (!image || input.promptCapabilities?.image !== true)) ||
      (attachment.type === "file" &&
        (isPastedText ||
          (audio
            ? input.promptCapabilities?.audio !== true
            : pdf || textFile
              ? input.promptCapabilities?.embeddedContext !== true
              : true)));
    const attachmentPath = resolveAttachmentPath({
      attachmentsDir: input.attachmentsDir,
      attachment,
    });
    if (!attachmentPath) {
      return yield* EffectAcpErrors.AcpRequestError.invalidParams(
        `Invalid attachment '${attachment.name}'.`,
      );
    }
    const info = yield* fileSystem
      .stat(attachmentPath)
      .pipe(
        Effect.mapError(() =>
          EffectAcpErrors.AcpRequestError.invalidParams(
            `Could not read attachment '${attachment.name}'.`,
          ),
        ),
      );
    if (info.type !== "File") {
      return yield* EffectAcpErrors.AcpRequestError.invalidParams(
        `Could not read attachment '${attachment.name}'.`,
      );
    }
    if (isPathOnly) continue;
    const size = Number(info.size);
    const limit = image
      ? PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
      : audio
        ? ANTIGRAVITY_MAX_AUDIO_ATTACHMENT_BYTES
        : pdf
          ? MAX_TOTAL_ATTACHMENT_BYTES
          : ANTIGRAVITY_MAX_TEXT_ATTACHMENT_BYTES;
    if (
      attachment.type === "file" &&
      (size > limit || totalBytes + size > MAX_TOTAL_ATTACHMENT_BYTES)
    ) {
      continue;
    }
    totalBytes += size;
    if (size > limit || totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      return yield* EffectAcpErrors.AcpRequestError.invalidParams(
        `Image '${attachment.name}' is too large. Antigravity accepts images up to 10 MiB and 50 MiB of native attachments per message.`,
      );
    }
    const uri = yield* path.toFileUrl(attachmentPath).pipe(
      Effect.map((url) => url.href),
      Effect.mapError(() =>
        EffectAcpErrors.AcpRequestError.invalidParams(`Invalid attachment '${attachment.name}'.`),
      ),
    );
    if (pdf) {
      blocks.push({ type: "resource_link", uri, name: attachment.name, mimeType });
      continue;
    }
    const bytes = yield* fileSystem.stream(attachmentPath, { bytesToRead: limit + 1 }).pipe(
      Stream.runCollect,
      Effect.map((chunks) => Buffer.concat(chunks)),
      Effect.mapError(() =>
        EffectAcpErrors.AcpRequestError.invalidParams(
          `Could not read attachment '${attachment.name}'.`,
        ),
      ),
    );
    totalBytes += bytes.length - size;
    if (bytes.length > limit || totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      return yield* EffectAcpErrors.AcpRequestError.invalidParams(
        `Attachment '${attachment.name}' changed while being read and is too large.`,
      );
    }
    if (image) {
      blocks.push({ type: "image", data: Buffer.from(bytes).toString("base64"), mimeType });
    } else if (audio) {
      blocks.push({ type: "audio", data: Buffer.from(bytes).toString("base64"), mimeType });
    } else {
      const decoded = yield* Effect.try({
        try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        catch: () =>
          EffectAcpErrors.AcpRequestError.invalidParams(
            `Attachment '${attachment.name}' is not a UTF-8 text file.`,
          ),
      });
      if (decoded.includes("\0")) {
        return yield* EffectAcpErrors.AcpRequestError.invalidParams(
          `Attachment '${attachment.name}' contains binary data.`,
        );
      }
      blocks.push({ type: "resource", resource: { uri, mimeType, text: decoded } });
    }
  }
  if (blocks.length === 0) {
    return yield* EffectAcpErrors.AcpRequestError.invalidParams(
      "A turn requires text or supported attachments.",
    );
  }
  return blocks;
});
