import { describe, expect, it } from "@effect/vitest";

import { packFiles, unpackFiles } from "./roqerPack.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("roqerPack", () => {
  it("round-trips nested files byte for byte", () => {
    const files = [
      { path: "host/main.mjs", data: bytes("console.log(1)") },
      { path: "agent/skills/roblox-gui/SKILL.md", data: bytes("---\nname: roblox-gui\n---") },
      { path: "plugin/empty.rbxmx", data: new Uint8Array() },
    ];
    const unpacked = unpackFiles(packFiles(files));
    expect(unpacked.map((file) => [file.path, new TextDecoder().decode(file.data)])).toEqual(
      files.map((file) => [file.path, new TextDecoder().decode(file.data)]),
    );
  });

  it("refuses paths that would leave the unpack folder", () => {
    for (const path of ["../evil", "/abs", "a/../b", "a\\b", ""]) {
      expect(() => packFiles([{ path, data: bytes("x") }])).toThrow();
    }
  });

  it("refuses something that is not a pack", () => {
    expect(() => unpackFiles(bytes("not gzip"))).toThrow();
  });
});
