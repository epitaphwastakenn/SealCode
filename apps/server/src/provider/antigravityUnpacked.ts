// @effect-diagnostics nodeBuiltinImport:off - Effect has no positioned reads or inflate.
/**
 * Google ships the Windows agent as a PyInstaller onefile executable. Each launch unpacks about
 * 7,400 files into %TEMP% and loads DLLs from there, which security software and slow disks can
 * stall for minutes. We unpack it once next to the release and start the unmodified (signed)
 * executable as a onefile child of that directory, so launches write nothing to %TEMP%.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as NodeFSP from "node:fs/promises";
import * as NodeUtil from "node:util";
import * as NodeZlib from "node:zlib";

const inflate = NodeUtil.promisify(NodeZlib.inflate);

const COOKIE_MAGIC = Buffer.from([0x4d, 0x45, 0x49, 0x0c, 0x0b, 0x0a, 0x0b, 0x0e]);
const COOKIE_BYTES = 88;
const TOC_ENTRY_HEADER_BYTES = 18;
// The cookie sits right before the Authenticode signature (about 10 KB).
const COOKIE_SEARCH_BYTES = 1024 * 1024;
const EXTRACTED_TYPECODES = new Set(["b", "x", "Z"]);
// Symlinks and multipackage references need bootloader logic we do not reproduce.
const UNSUPPORTED_TYPECODES = new Set(["n", "d"]);

/** The bootloader only accepts an inherited home directory named `_MEI` + 8 hex digits + suffix. */
export const ANTIGRAVITY_UNPACKED_PREFIX = "_MEI00000000.";
const UNPACKED_RECORD = ".sealcode-unpacked.json";

/** Kept short: the deepest unpacked file adds about 120 characters under Windows' 260 limit. */
export function antigravityUnpackedDirectory(
  path: Path.Path,
  managedDirectory: string,
  releaseId: string,
) {
  return path.join(
    managedDirectory,
    "u",
    `${ANTIGRAVITY_UNPACKED_PREFIX}${releaseId.slice(0, 12)}`,
  );
}

const UnpackedRecord = Schema.Struct({ entries: Schema.Number, pythonLibrary: Schema.String });
const decodeUnpackedRecord = Schema.decodeEffect(Schema.fromJsonString(UnpackedRecord));
const encodeUnpackedRecord = Schema.encodeEffect(Schema.fromJsonString(UnpackedRecord));

export class AntigravityUnpackError extends Schema.TaggedError<AntigravityUnpackError>()(
  "AntigravityUnpackError",
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message() {
    return this.detail;
  }
}
const isUnpackError = Schema.is(AntigravityUnpackError);

export interface PyInstallerCookie {
  readonly packageOffset: number;
  readonly tocOffset: number;
  readonly tocBytes: number;
  readonly pythonLibrary: string;
}

export interface PyInstallerEntry {
  readonly name: string;
  readonly offset: number;
  readonly storedBytes: number;
  readonly bytes: number;
  readonly compressed: boolean;
  readonly typecode: string;
}

const cString = (bytes: Buffer) => {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end < 0 ? bytes.length : end).toString("utf8");
};

/** Finds the archive cookie in the last bytes of the executable; `tailOffset` is where they start. */
export function parsePyInstallerCookie(tail: Buffer, tailOffset: number): PyInstallerCookie | null {
  const index = tail.lastIndexOf(COOKIE_MAGIC);
  if (index < 0 || index + COOKIE_BYTES > tail.length) return null;
  const packageBytes = tail.readUInt32BE(index + 8);
  const tocOffset = tail.readUInt32BE(index + 12);
  const tocBytes = tail.readUInt32BE(index + 16);
  const packageOffset = tailOffset + index + COOKIE_BYTES - packageBytes;
  if (packageOffset < 0 || tocOffset + tocBytes > packageBytes) return null;
  return {
    packageOffset,
    tocOffset: packageOffset + tocOffset,
    tocBytes,
    pythonLibrary: cString(tail.subarray(index + 24, index + COOKIE_BYTES)),
  };
}

export function parsePyInstallerToc(toc: Buffer): ReadonlyArray<PyInstallerEntry> | null {
  const entries: PyInstallerEntry[] = [];
  for (let index = 0; index < toc.length;) {
    const entryBytes = index + 4 <= toc.length ? toc.readUInt32BE(index) : 0;
    if (entryBytes < TOC_ENTRY_HEADER_BYTES || index + entryBytes > toc.length) return null;
    entries.push({
      offset: toc.readUInt32BE(index + 4),
      storedBytes: toc.readUInt32BE(index + 8),
      bytes: toc.readUInt32BE(index + 12),
      compressed: toc.readUInt8(index + 16) === 1,
      typecode: String.fromCharCode(toc.readUInt8(index + 17)),
      name: cString(toc.subarray(index + TOC_ENTRY_HEADER_BYTES, index + entryBytes)),
    });
    index += entryBytes;
  }
  return entries;
}

/** Splits a TOC name into relative segments, or returns null for anything that could escape. */
export function safeEntrySegments(name: string): ReadonlyArray<string> | null {
  const segments = name.split(/[\\/]/u);
  return segments.some(
    (segment) =>
      segment === "" || segment === "." || segment === ".." || /[:<>"|?*\0]/u.test(segment),
  )
    ? null
    : segments;
}

/** `directory` when it holds a complete unpacked runtime, otherwise null. */
export const readAntigravityUnpacked = Effect.fn("readAntigravityUnpacked")(function* (
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const record = yield* fs
    .readFileString(path.join(directory, UNPACKED_RECORD))
    .pipe(Effect.flatMap(decodeUnpackedRecord), Effect.option);
  if (record._tag === "None") return null;
  // Security software can quarantine a file later; without the Python DLL nothing starts.
  const present = yield* fs
    .exists(path.join(directory, record.value.pythonLibrary))
    .pipe(Effect.orElseSucceed(() => false));
  return present ? directory : null;
});

const attempt = <A>(detail: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new AntigravityUnpackError({ detail, cause }) });

/**
 * Unpacks the agent once into `directory`, whose name must start with ANTIGRAVITY_UNPACKED_PREFIX.
 * An interrupted run starts over.
 */
export const unpackAntigravityRuntime = Effect.fn("unpackAntigravityRuntime")(
  function* (input: { readonly executablePath: string; readonly directory: string }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const existing = yield* readAntigravityUnpacked(input.directory);
    if (existing !== null) return existing;

    const file = yield* Effect.acquireRelease(
      attempt("Could not open the Antigravity executable.", () =>
        NodeFSP.open(input.executablePath, "r"),
      ),
      (handle) => Effect.promise(() => handle.close()),
    );
    const readAt = (position: number, length: number) =>
      attempt("Could not read the Antigravity executable.", async () => {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await file.read(buffer, 0, length, position);
        return buffer.subarray(0, bytesRead);
      });
    const { size } = yield* attempt("Could not read the Antigravity executable.", () =>
      file.stat(),
    );
    const tailOffset = Math.max(0, size - COOKIE_SEARCH_BYTES);
    const cookie = parsePyInstallerCookie(yield* readAt(tailOffset, size - tailOffset), tailOffset);
    const entries =
      cookie === null
        ? null
        : parsePyInstallerToc(yield* readAt(cookie.tocOffset, cookie.tocBytes));
    if (cookie === null || entries === null || entries.length === 0 || !cookie.pythonLibrary) {
      return yield* new AntigravityUnpackError({
        detail: "The Antigravity executable is not an archive Harp can unpack.",
      });
    }
    if (entries.some((entry) => UNSUPPORTED_TYPECODES.has(entry.typecode))) {
      return yield* new AntigravityUnpackError({
        detail: "The Antigravity executable uses archive entries Harp cannot unpack.",
      });
    }

    yield* fs.makeDirectory(path.dirname(input.directory), { recursive: true });
    const staging = yield* fs.makeTempDirectory({
      directory: path.dirname(input.directory),
      prefix: `${ANTIGRAVITY_UNPACKED_PREFIX}unpacking-`,
    });
    const unpack = Effect.gen(function* () {
      let count = 0;
      for (const entry of entries) {
        if (!EXTRACTED_TYPECODES.has(entry.typecode)) continue;
        const segments = safeEntrySegments(entry.name);
        if (segments === null) {
          return yield* new AntigravityUnpackError({
            detail: `The Antigravity executable contains an unsafe path: ${entry.name}`,
          });
        }
        const stored = yield* readAt(cookie.packageOffset + entry.offset, entry.storedBytes);
        const contents = entry.compressed
          ? yield* attempt(`Could not unpack ${entry.name}.`, () => inflate(stored))
          : stored;
        if (stored.length !== entry.storedBytes || contents.length !== entry.bytes) {
          return yield* new AntigravityUnpackError({
            detail: `The Antigravity executable is damaged (${entry.name} has the wrong size).`,
          });
        }
        const destination = path.join(staging, ...segments);
        yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
        yield* fs.writeFile(destination, contents);
        count += 1;
      }
      const directory = input.directory;
      yield* fs.remove(directory, { recursive: true, force: true });
      yield* fs.rename(staging, directory);
      yield* fs.writeFileString(
        path.join(directory, UNPACKED_RECORD),
        yield* encodeUnpackedRecord({ entries: count, pythonLibrary: cookie.pythonLibrary }),
      );
      return directory;
    });
    return yield* unpack.pipe(
      Effect.onError(() =>
        fs.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore),
      ),
    );
  },
  Effect.scoped,
  Effect.mapError((cause) =>
    isUnpackError(cause)
      ? cause
      : new AntigravityUnpackError({ detail: "Could not unpack the Antigravity runtime.", cause }),
  ),
);
