import * as NodeZlib from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** Encodes straight RGBA pixels (row-major, 4 bytes each) as an RGB PNG. */
export const encodePng = (rgba: Uint8Array, width: number, height: number): Buffer => {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const target = row + 1 + x * 3;
      raw[target] = rgba[source]!;
      raw[target + 1] = rgba[source + 1]!;
      raw[target + 2] = rgba[source + 2]!;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", NodeZlib.deflateSync(raw, { level: 6 })),
    chunk("IEND", new Uint8Array()),
  ]);
};

/** Box-averages RGBA pixels down by an integer factor. */
export const downscaleRgba = (
  rgba: Uint8Array,
  width: number,
  height: number,
  factor: number,
): { readonly data: Uint8Array; readonly width: number; readonly height: number } => {
  const outWidth = Math.max(1, Math.floor(width / factor));
  const outHeight = Math.max(1, Math.floor(height / factor));
  const out = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const sums = [0, 0, 0, 0];
      let count = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        const sy = y * factor + dy;
        if (sy >= height) break;
        for (let dx = 0; dx < factor; dx += 1) {
          const sx = x * factor + dx;
          if (sx >= width) break;
          const index = (sy * width + sx) * 4;
          for (let channel = 0; channel < 4; channel += 1) sums[channel]! += rgba[index + channel]!;
          count += 1;
        }
      }
      const target = (y * outWidth + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        out[target + channel] = Math.round(sums[channel]! / Math.max(count, 1));
      }
    }
  }
  return { data: out, width: outWidth, height: outHeight };
};
