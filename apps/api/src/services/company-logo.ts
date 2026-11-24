import { crc32, inflateSync } from "node:zlib";
/** Bounded structural validation; image bytes are never executed or converted. */
export function validCompanyLogo(bytes: Buffer, type: string): boolean {
  try {
    if (bytes.length > 65536) return false;
    if (type === "png") {
      if (
        bytes.length < 57 ||
        !bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        return false;
      let pos = 8,
        header = false,
        end = false;
      const compressed: Buffer[] = [];
      while (pos + 12 <= bytes.length) {
        const length = bytes.readUInt32BE(pos);
        if (length > 65536 || pos + 12 + length > bytes.length) return false;
        const kind = bytes.toString("ascii", pos + 4, pos + 8),
          data = bytes.subarray(pos + 8, pos + 8 + length);
        if (
          crc32(bytes.subarray(pos + 4, pos + 8 + length)) !==
          bytes.readUInt32BE(pos + 8 + length)
        )
          return false;
        if (!header) {
          if (kind !== "IHDR" || length !== 13) return false;
          const w = data.readUInt32BE(0),
            h = data.readUInt32BE(4);
          if (
            !w ||
            !h ||
            w > 1024 ||
            h > 1024 ||
            ![1, 2, 4, 8, 16].includes(data[8]) ||
            ![0, 2, 3, 4, 6].includes(data[9]) ||
            data[10] !== 0 ||
            data[11] !== 0 ||
            data[12] > 1
          )
            return false;
          header = true;
        } else if (kind === "IHDR") return false;
        if (kind === "IDAT") compressed.push(data);
        pos += length + 12;
        if (kind === "IEND") {
          if (length !== 0 || pos !== bytes.length) return false;
          end = true;
          break;
        }
      }
      return (
        header &&
        end &&
        compressed.length > 0 &&
        inflateSync(Buffer.concat(compressed), {
          maxOutputLength: 9 * 1024 * 1024,
        }).length > 0
      );
    }
    if (
      type !== "jpeg" ||
      bytes.length < 12 ||
      bytes[0] !== 255 ||
      bytes[1] !== 216 ||
      bytes.at(-2) !== 255 ||
      bytes.at(-1) !== 217
    )
      return false;
    let pos = 2,
      frame = false;
    while (pos < bytes.length - 2) {
      if (bytes[pos++] !== 255) return false;
      while (bytes[pos] === 255) pos++;
      const marker = bytes[pos++];
      if (marker === 218) return frame;
      const length = bytes.readUInt16BE(pos);
      if (length < 2 || pos + length > bytes.length) return false;
      if ([192, 193, 194].includes(marker)) {
        if (length < 8) return false;
        const h = bytes.readUInt16BE(pos + 3),
          w = bytes.readUInt16BE(pos + 5);
        if (!w || !h || w > 1024 || h > 1024) return false;
        frame = true;
      }
      pos += length;
    }
    return false;
  } catch {
    return false;
  }
}
