import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeZlib from "node:zlib";

import {
  ANTIGRAVITY_UNPACKED_PREFIX,
  antigravityUnpackedDirectory,
  readAntigravityUnpacked,
  unpackAntigravityRuntime,
} from "./antigravityUnpacked.ts";

interface FixtureEntry {
  readonly name: string;
  readonly typecode: string;
  readonly data: string;
  readonly compress?: boolean;
}

/** A PyInstaller onefile layout: bootloader, package data, TOC, cookie, then a signature. */
function pyinstallerExecutable(entries: ReadonlyArray<FixtureEntry>): Uint8Array {
  const blobs: Buffer[] = [];
  const toc: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.from(entry.data);
    const stored = entry.compress ? NodeZlib.deflateSync(data) : data;
    const name = Buffer.alloc(Math.ceil((Buffer.byteLength(entry.name) + 1) / 16) * 16);
    name.write(entry.name);
    const header = Buffer.alloc(18);
    header.writeUInt32BE(18 + name.length, 0);
    header.writeUInt32BE(offset, 4);
    header.writeUInt32BE(stored.length, 8);
    header.writeUInt32BE(data.length, 12);
    header.writeUInt8(entry.compress ? 1 : 0, 16);
    header.write(entry.typecode, 17);
    toc.push(header, name);
    blobs.push(stored);
    offset += stored.length;
  }
  const data = Buffer.concat(blobs);
  const tocBytes = Buffer.concat(toc);
  const cookie = Buffer.alloc(88);
  Buffer.from([0x4d, 0x45, 0x49, 0x0c, 0x0b, 0x0a, 0x0b, 0x0e]).copy(cookie);
  cookie.writeUInt32BE(data.length + tocBytes.length + cookie.length, 8);
  cookie.writeUInt32BE(data.length, 12);
  cookie.writeUInt32BE(tocBytes.length, 16);
  cookie.writeInt32BE(314, 20);
  cookie.write("python314.dll", 24);
  return Buffer.concat([Buffer.alloc(64, 0x4d), data, tocBytes, cookie, Buffer.alloc(300, 0x53)]);
}

const release = Effect.fn("release")(function* (entries: ReadonlyArray<FixtureEntry>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "agy-release-" });
  const executablePath = path.join(root, "agy_acp_server.exe");
  yield* fs.writeFile(executablePath, pyinstallerExecutable(entries));
  return { executablePath, directory: antigravityUnpackedDirectory(path, root, "a".repeat(64)) };
});

const runtimeEntries: ReadonlyArray<FixtureEntry> = [
  { name: "python314.dll", typecode: "b", data: "python runtime", compress: true },
  { name: "certifi\\cacert.pem", typecode: "x", data: "certificates" },
  { name: "google/genai/__init__.pyd", typecode: "b", data: "extension", compress: true },
  { name: "base_library.zip", typecode: "Z", data: "stdlib" },
  { name: "main", typecode: "s", data: "script stays in the executable" },
  { name: "PYZ.pyz", typecode: "z", data: "modules stay in the executable" },
];

it.layer(NodeServices.layer)("unpackAntigravityRuntime", (it) => {
  it.effect("unpacks the files the bootloader would extract, once", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const input = yield* release(runtimeEntries);

      const directory = yield* unpackAntigravityRuntime(input);

      expect(directory).toBe(input.directory);
      expect(path.basename(directory).startsWith(ANTIGRAVITY_UNPACKED_PREFIX)).toBe(true);
      expect(yield* fs.readFileString(path.join(directory, "python314.dll"))).toBe(
        "python runtime",
      );
      expect(yield* fs.readFileString(path.join(directory, "certifi", "cacert.pem"))).toBe(
        "certificates",
      );
      expect(
        yield* fs.readFileString(path.join(directory, "google", "genai", "__init__.pyd")),
      ).toBe("extension");
      expect(yield* fs.exists(path.join(directory, "main"))).toBe(false);
      expect(yield* fs.exists(path.join(directory, "PYZ.pyz"))).toBe(false);

      // A second launch reuses the copy instead of unpacking again.
      yield* fs.writeFileString(path.join(directory, "certifi", "cacert.pem"), "kept");
      expect(yield* unpackAntigravityRuntime(input)).toBe(directory);
      expect(yield* fs.readFileString(path.join(directory, "certifi", "cacert.pem"))).toBe("kept");
    }).pipe(Effect.scoped),
  );

  it.effect("unpacks again when security software removed the Python runtime", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const input = yield* release(runtimeEntries);
      const directory = yield* unpackAntigravityRuntime(input);

      yield* fs.remove(path.join(directory, "python314.dll"));
      expect(yield* readAntigravityUnpacked(directory)).toBeNull();

      yield* unpackAntigravityRuntime(input);
      expect(yield* fs.readFileString(path.join(directory, "python314.dll"))).toBe(
        "python runtime",
      );
    }).pipe(Effect.scoped),
  );

  it.effect("refuses paths that leave the release and leaves nothing behind", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const input = yield* release([
        ...runtimeEntries,
        { name: "..\\escaped.dll", typecode: "b", data: "outside" },
      ]);

      const exit = yield* Effect.exit(unpackAntigravityRuntime(input));

      expect(Exit.isFailure(exit)).toBe(true);
      expect(yield* fs.exists(input.directory)).toBe(false);
      expect(yield* fs.readDirectory(path.dirname(input.directory))).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect("rejects an executable without a PyInstaller archive", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "agy-release-" });
      const executablePath = path.join(root, "agy_acp_server.exe");
      yield* fs.writeFileString(executablePath, "MZ not an archive");

      const exit = yield* Effect.exit(
        unpackAntigravityRuntime({
          executablePath,
          directory: antigravityUnpackedDirectory(path, root, "b".repeat(64)),
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.scoped),
  );
});

it.effect("keeps the unpacked runtime under MAX_PATH for long user names", () =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    // Deepest member of the official agy_acp_server 1.4.3 windows-x86_64 bundle.
    const deepestMember =
      "google3\\third_party\\py\\google\\genai\\_gaos\\resources\\interactions\\environment\\environmentnetworkegressallowlist\\__init__.py";
    const directory = antigravityUnpackedDirectory(
      path,
      "C:\\Users\\a-twenty-char-person\\.t3\\tools\\antigravity-acp\\win32-x64",
      "f".repeat(64),
    );
    // MAX_PATH is 260 including the terminating NUL.
    expect(path.join(directory, deepestMember).length).toBeLessThan(260);
  }).pipe(Effect.provide(NodePath.layerWin32)),
);
