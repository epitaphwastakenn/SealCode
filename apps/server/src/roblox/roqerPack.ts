import * as NodeZlib from "node:zlib";

/**
 * Roqer's bundle travels inside the server build as one gzipped file and is unpacked into the
 * state directory on first use: the Windows sidecar lives in an asar archive with a file budget,
 * and the bridge, plugin installer and Blender all need real files on disk.
 */
const MAGIC = Buffer.from("SEALCODE-ROQER-PACK-1\n", "utf8");

export interface PackedFile {
  readonly path: string;
  readonly data: Uint8Array;
}

const isSafeRelativePath = (value: string): boolean => {
  if (value.length === 0 || value.length > 512 || value.startsWith("/") || value.includes("\\")) {
    return false;
  }
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
};

export const packFiles = (files: ReadonlyArray<PackedFile>): Buffer => {
  for (const file of files) {
    if (!isSafeRelativePath(file.path)) throw new Error(`Unsafe pack path: ${file.path}`);
  }
  const header = Buffer.from(
    JSON.stringify(files.map((file) => ({ path: file.path, size: file.data.byteLength }))),
    "utf8",
  );
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.byteLength);
  return NodeZlib.gzipSync(
    Buffer.concat([MAGIC, length, header, ...files.map((file) => Buffer.from(file.data))]),
    { level: 9 },
  );
};

export const unpackFiles = (packed: Uint8Array): ReadonlyArray<PackedFile> => {
  const raw = NodeZlib.gunzipSync(packed);
  if (raw.byteLength < MAGIC.byteLength + 4 || !raw.subarray(0, MAGIC.byteLength).equals(MAGIC)) {
    throw new Error("Not a Roqer pack.");
  }
  const headerLength = raw.readUInt32BE(MAGIC.byteLength);
  const headerStart = MAGIC.byteLength + 4;
  const entries: unknown = JSON.parse(
    raw.subarray(headerStart, headerStart + headerLength).toString("utf8"),
  );
  if (!Array.isArray(entries)) throw new Error("The Roqer pack header is invalid.");
  let offset = headerStart + headerLength;
  const files: PackedFile[] = [];
  for (const entry of entries) {
    const path = (entry as { readonly path?: unknown }).path;
    const size = (entry as { readonly size?: unknown }).size;
    if (typeof path !== "string" || !isSafeRelativePath(path) || typeof size !== "number") {
      throw new Error("The Roqer pack header is invalid.");
    }
    if (size < 0 || offset + size > raw.byteLength) throw new Error("The Roqer pack is truncated.");
    files.push({ path, data: raw.subarray(offset, offset + size) });
    offset += size;
  }
  if (offset !== raw.byteLength) throw new Error("The Roqer pack has trailing data.");
  return files;
};
