import type { ContextReference, ResolvedContextReference } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";

const MAX_REFERENCE_BYTES = 32_000;
const MAX_FOLDER_FILES = 40;
const MAX_FILE_BYTES = 12_000;
const MAX_DIFF_BYTES = 24_000;
const MAX_INLINE_REFERENCE_CHARS = 36_000;
const EXPLICIT_REFERENCE_PATTERN = /@(file|folder|diff):([^\s`]+)/g;
const SENSITIVE_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "secrets",
  "secrets.json",
  "credentials",
  "credentials.json",
]);

export class ContextReferenceResolutionError extends Schema.TaggedErrorClass<ContextReferenceResolutionError>()(
  "ContextReferenceResolutionError",
  {
    target: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const resolutionError = (target: string, detail: string, cause?: unknown) =>
  new ContextReferenceResolutionError({
    target,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });

function isWithin(root: string, candidate: string, path: Path.Path): boolean {
  const relativePath = path.relative(root, candidate);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

function isSensitivePath(value: string): boolean {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => {
      const lower = segment.toLowerCase();
      return (
        SENSITIVE_BASENAMES.has(lower) ||
        lower.startsWith(".env.") ||
        lower.endsWith(".pem") ||
        lower.endsWith(".key") ||
        lower === "id_rsa" ||
        lower === "id_ed25519"
      );
    });
}

function normalizeTarget(target: string): string {
  return target.replaceAll("\\", "/").replace(/^\.\//, "");
}

function portablePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function parseLineRange(target: string): {
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
} {
  const match = /^(.*?):(\d+)(?:-(\d+))?$/.exec(target);
  if (!match) return { path: target };
  const startLine = Number(match[2]);
  const endLine = Number(match[3] ?? match[2]);
  return {
    path: match[1] ?? target,
    startLine: Math.max(1, startLine),
    endLine: Math.max(startLine, endLine),
  };
}

export function parseContextReferences(input: string): ReadonlyArray<ContextReference> {
  const references: Array<ContextReference> = [];
  for (const match of input.matchAll(EXPLICIT_REFERENCE_PATTERN)) {
    const rawKind = match[1];
    const rawTarget = match[2];
    if (rawKind === undefined || rawTarget === undefined) continue;
    const parsed = parseLineRange(normalizeTarget(rawTarget));
    references.push({
      kind: rawKind as ContextReference["kind"],
      target: parsed.path,
      ...(parsed.startLine === undefined ? {} : { startLine: parsed.startLine - 1 }),
      ...(parsed.endLine === undefined ? {} : { endLine: parsed.endLine - 1 }),
    });
  }
  return references;
}

function applyLineRange(
  content: string,
  startLine: number | undefined,
  endLine: number | undefined,
): string {
  if (startLine === undefined) return content;
  const lines = content.split(/\r?\n/);
  return lines.slice(startLine, endLine === undefined ? undefined : endLine + 1).join("\n");
}

function byteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

function truncateContent(
  content: string,
  maxBytes: number,
): { content: string; truncated: boolean } {
  if (byteLength(content) <= maxBytes) return { content, truncated: false };
  let end = Math.min(content.length, maxBytes);
  while (end > 0 && byteLength(content.slice(0, end)) > maxBytes) end -= 1;
  return { content: `${content.slice(0, end)}\n[content truncated]`, truncated: true };
}

const hashContent = Effect.fn("ContextReferences.hashContent")(function* (
  crypto: Crypto.Crypto,
  target: string,
  content: string,
) {
  return Encoding.encodeHex(
    yield* crypto
      .digest("SHA-256", new TextEncoder().encode(content))
      .pipe(
        Effect.mapError((cause) =>
          resolutionError(target, `Failed to hash context reference: ${target}`, cause),
        ),
      ),
  );
});

const resolveContextReference = Effect.fn("ContextReferences.resolveContextReference")(function* (
  workspaceRoot: string,
  reference: ContextReference,
  services: {
    readonly crypto: Crypto.Crypto;
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly vcsProcess: VcsProcess.VcsProcess["Service"];
    readonly workspaceEntries: WorkspaceEntries.WorkspaceEntries["Service"];
    readonly workspaceFileSystem: WorkspaceFileSystem.WorkspaceFileSystem["Service"];
  },
) {
  const { crypto, fileSystem, path, vcsProcess, workspaceEntries, workspaceFileSystem } = services;
  const absolutePath = path.resolve(workspaceRoot, reference.target);
  const relativePath = path.relative(workspaceRoot, absolutePath);
  if (!isWithin(workspaceRoot, absolutePath, path) || isSensitivePath(relativePath)) {
    return yield* resolutionError(
      reference.target,
      `Context reference is outside the workspace or sensitive: ${reference.target}`,
    );
  }

  if (reference.kind === "file") {
    const file = yield* workspaceFileSystem
      .readFile({ cwd: workspaceRoot, relativePath: relativePath || "." })
      .pipe(
        Effect.mapError((cause) =>
          resolutionError(
            reference.target,
            `Unable to read context file: ${reference.target}`,
            cause,
          ),
        ),
      );
    if (file.byteLength > MAX_FILE_BYTES * 8) {
      return yield* resolutionError(
        reference.target,
        `Context file is too large: ${reference.target}`,
      );
    }
    const ranged = applyLineRange(file.contents, reference.startLine, reference.endLine);
    const limited = truncateContent(ranged, MAX_FILE_BYTES);
    return {
      reference,
      resolvedPath: portablePath(file.relativePath),
      content: limited.content,
      contentHash: yield* hashContent(crypto, reference.target, limited.content),
      byteCount: byteLength(limited.content),
      truncated: limited.truncated || file.truncated,
    } satisfies ResolvedContextReference;
  }

  if (reference.kind === "folder") {
    const realFolder = yield* fileSystem
      .realPath(absolutePath)
      .pipe(
        Effect.mapError((cause) =>
          resolutionError(
            reference.target,
            `Unable to resolve context folder: ${reference.target}`,
            cause,
          ),
        ),
      );
    if (
      !isWithin(workspaceRoot, realFolder, path) ||
      isSensitivePath(path.relative(workspaceRoot, realFolder))
    ) {
      return yield* resolutionError(
        reference.target,
        `Context folder resolves outside the workspace or to a sensitive path: ${reference.target}`,
      );
    }
    const listing = yield* workspaceEntries
      .list({ cwd: realFolder })
      .pipe(
        Effect.mapError((cause) =>
          resolutionError(
            reference.target,
            `Unable to list context folder: ${reference.target}`,
            cause,
          ),
        ),
      );
    const names = listing.entries
      .filter((entry) => entry.kind === "file" && !isSensitivePath(entry.path))
      .map((entry) => portablePath(entry.path))
      .sort()
      .slice(0, MAX_FOLDER_FILES + 1);
    const limited = truncateContent(
      names.slice(0, MAX_FOLDER_FILES).join("\n"),
      MAX_REFERENCE_BYTES,
    );
    return {
      reference,
      resolvedPath: portablePath(relativePath || path.basename(absolutePath)),
      content: limited.content,
      contentHash: yield* hashContent(crypto, reference.target, limited.content),
      byteCount: byteLength(limited.content),
      truncated: limited.truncated || listing.truncated || names.length > MAX_FOLDER_FILES,
    } satisfies ResolvedContextReference;
  }

  const target = reference.target === "." ? "." : normalizeTarget(reference.target);
  const result = yield* vcsProcess
    .run({
      operation: "ContextReferences.resolveDiffReference",
      command: "git",
      args: ["diff", "--no-ext-diff", "--no-color", "--", target],
      cwd: workspaceRoot,
      timeoutMs: 30_000,
      maxOutputBytes: MAX_DIFF_BYTES * 2,
    })
    .pipe(
      Effect.mapError((cause) =>
        resolutionError(
          reference.target,
          `Unable to resolve context diff: ${reference.target}`,
          cause,
        ),
      ),
    );
  const limited = truncateContent(result.stdout, MAX_DIFF_BYTES);
  const content = limited.content || "[working tree has no diff]";
  return {
    reference,
    resolvedPath: target,
    content,
    contentHash: yield* hashContent(crypto, reference.target, content),
    byteCount: byteLength(content),
    truncated: limited.truncated || result.stdoutTruncated,
  } satisfies ResolvedContextReference;
});

export const resolveContextReferences = Effect.fn("ContextReferences.resolveContextReferences")(
  function* (cwd: string, input: string) {
    const references = parseContextReferences(input).filter((reference, index, all) => {
      const identity = `${reference.kind}\0${reference.target}\0${reference.startLine ?? ""}\0${reference.endLine ?? ""}`;
      return (
        all.findIndex(
          (candidate) =>
            `${candidate.kind}\0${candidate.target}\0${candidate.startLine ?? ""}\0${candidate.endLine ?? ""}` ===
            identity,
        ) === index
      );
    });
    if (references.length === 0) return [];

    const crypto = yield* Crypto.Crypto;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const vcsProcess = yield* VcsProcess.VcsProcess;
    const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
    const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
    const workspaceRoot = yield* fileSystem
      .realPath(cwd)
      .pipe(
        Effect.mapError((cause) =>
          resolutionError(cwd, `Unable to resolve workspace root: ${cwd}`, cause),
        ),
      );
    const services = {
      crypto,
      fileSystem,
      path,
      vcsProcess,
      workspaceEntries,
      workspaceFileSystem,
    };
    const resolved: Array<ResolvedContextReference> = [];
    let totalBytes = 0;
    for (const reference of references) {
      const item = yield* resolveContextReference(workspaceRoot, reference, services);
      if (totalBytes + item.byteCount > MAX_REFERENCE_BYTES) {
        const remaining = Math.max(0, MAX_REFERENCE_BYTES - totalBytes);
        if (remaining === 0) break;
        const limited = truncateContent(item.content, remaining);
        resolved.push({
          ...item,
          content: limited.content,
          contentHash: yield* hashContent(crypto, reference.target, limited.content),
          byteCount: byteLength(limited.content),
          truncated: true,
        });
        break;
      }
      resolved.push(item);
      totalBytes += item.byteCount;
    }
    return resolved;
  },
);

export function appendResolvedContextReferences(
  input: string,
  references: ReadonlyArray<ResolvedContextReference>,
): string {
  if (references.length === 0) return input;
  const body = references
    .map((reference) => {
      const location = reference.resolvedPath ?? reference.reference.target;
      const escapedLocation = location
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;");
      return `<reference kind="${reference.reference.kind}" path="${escapedLocation}" bytes="${reference.byteCount}" truncated="${reference.truncated}">\n${reference.content}\n</reference>`;
    })
    .join("\n\n");
  return `${input}\n\n<sealcode_context_references>\n${body}\n</sealcode_context_references>`.slice(
    0,
    MAX_INLINE_REFERENCE_CHARS,
  );
}

export const __testing = {
  applyLineRange,
  isSensitivePath,
  truncateContent,
};
