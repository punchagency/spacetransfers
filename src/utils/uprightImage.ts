import sharp from "sharp";

/**
 * Turns a photo upright when its EXIF says the pixels are stored sideways.
 *
 * Phones save most photos sideways with an "orientation" tag telling viewers to
 * turn them. Nothing on the server applied it: sizes were read sideways, the
 * trimmed PNG dropped the tag and was sideways, and so was the print. Baked in
 * once here, every later step — size, trim, thumbnails, fade check, the print —
 * sees the photo the way the customer took it. A JPEG stays a JPEG, re-saved at
 * quality 95 with full colour resolution (visually lossless in print); anything
 * else becomes lossless PNG. Upright images, the vast majority, are untouched.
 */
export const uprightImage = async (buffer: Buffer): Promise<Buffer> => {
  const meta = await sharp(buffer, { limitInputPixels: false }).metadata();
  if (!meta.orientation || meta.orientation === 1) return buffer;
  const turned = sharp(buffer, { limitInputPixels: false })
    .rotate()
    // Keeps the colour profile and the print resolution; the tag is now upright.
    .withMetadata({ orientation: 1, ...(meta.density ? { density: meta.density } : {}) });
  return meta.format === "jpeg"
    ? turned.jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer()
    : turned.png().toBuffer();
};
