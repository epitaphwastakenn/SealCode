// @effect-diagnostics nodeBuiltinImport:off globalErrorInEffectCatch:off globalErrorInEffectFailure:off globalTimers:off globalDateInEffect:off globalFetchInEffect:off preferSchemaOverJson:off - Open Cloud's Assets API takes a multipart upload of a local file.
import * as NodeFs from "node:fs/promises";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

/**
 * Publishes a local file as a Roblox asset with the user's Open Cloud key (Assets API, write),
 * then waits for the operation to finish so the caller gets an asset id it can insert.
 */

const API = "https://apis.roblox.com/assets/v1";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".fbx": "model/fbx",
  ".rbxm": "model/x-rbxm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".bmp": "image/bmp",
  ".tga": "image/tga",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
};

export const ASSET_TYPE_FOR_EXTENSION: Readonly<Record<string, "Model" | "Decal" | "Audio">> = {
  ".glb": "Model",
  ".gltf": "Model",
  ".fbx": "Model",
  ".rbxm": "Model",
  ".png": "Decal",
  ".jpg": "Decal",
  ".jpeg": "Decal",
  ".bmp": "Decal",
  ".tga": "Decal",
  ".mp3": "Audio",
  ".ogg": "Audio",
  ".wav": "Audio",
  ".flac": "Audio",
};

export interface UploadInput {
  readonly apiKey: string;
  readonly filePath: string;
  readonly assetType: "Model" | "Decal" | "Audio";
  readonly displayName: string;
  readonly description: string;
  readonly creator: { readonly userId: string } | { readonly groupId: string };
  readonly timeoutMs: number;
}

const readError = async (response: Response) => {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { message?: string; errors?: Array<{ message?: string }> };
    return body.message ?? body.errors?.[0]?.message ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
};

export const uploadAsset = (input: UploadInput) =>
  Effect.tryPromise({
    try: async () => {
      const extension = NodePath.extname(input.filePath).toLowerCase();
      const contentType = CONTENT_TYPES[extension];
      if (contentType === undefined) {
        throw new Error(
          `Open Cloud does not take ${extension || "this"} files. Use .glb or .fbx for models, .png or .jpg for images, .mp3 or .ogg for audio.`,
        );
      }
      const bytes = await NodeFs.readFile(input.filePath);
      const request = {
        assetType: input.assetType,
        displayName: input.displayName.slice(0, 50),
        description: input.description.slice(0, 1000),
        creationContext: {
          creator:
            "userId" in input.creator
              ? { userId: input.creator.userId }
              : { groupId: input.creator.groupId },
        },
      };
      const form = new FormData();
      form.append("request", JSON.stringify(request));
      form.append(
        "fileContent",
        new Blob([bytes], { type: contentType }),
        NodePath.basename(input.filePath),
      );
      const created = await fetch(`${API}/assets`, {
        method: "POST",
        headers: { "x-api-key": input.apiKey },
        body: form,
      });
      if (!created.ok) {
        throw new Error(
          created.status === 401 || created.status === 403
            ? `Roblox refused the Open Cloud key (HTTP ${String(created.status)}): it needs the Assets API with write access for this creator. ${await readError(created)}`
            : `Upload failed (HTTP ${String(created.status)}): ${await readError(created)}`,
        );
      }
      const operation = (await created.json()) as { path?: string; operationId?: string };
      const operationId = operation.operationId ?? operation.path?.split("/").at(-1);
      if (!operationId) throw new Error("Roblox accepted the upload but returned no operation id.");
      const deadline = Date.now() + input.timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const polled = await fetch(`${API}/operations/${operationId}`, {
          headers: { "x-api-key": input.apiKey },
        });
        if (!polled.ok) continue;
        const state = (await polled.json()) as {
          done?: boolean;
          response?: { assetId?: string; moderationResult?: { moderationState?: string } };
          error?: { message?: string };
        };
        if (state.error)
          throw new Error(`Roblox rejected the asset: ${String(state.error.message)}`);
        if (state.done && state.response?.assetId) {
          return {
            assetId: Number(state.response.assetId),
            operationId,
            moderation: state.response.moderationResult?.moderationState ?? "unknown",
          };
        }
      }
      return { assetId: undefined, operationId, moderation: "pending" };
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
