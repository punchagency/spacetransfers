import sharp from "sharp";

/**
 * A 64-bit difference hash: the same picture resized, re-saved or lightly
 * recompressed hashes within a few bits of itself, so an image an admin blocked
 * is caught however it comes back. Transparent artwork is laid on mid grey, so
 * black and white shapes both register.
 */
export const imageHash = async (buffer: Buffer): Promise<string> => {
  const { data } = await sharp(buffer, { limitInputPixels: false })
    .flatten({ background: "#808080" })
    .greyscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (data[y * 9 + x] > data[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
};

export const hashDistance = (a: string, b: string): number => {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
};
