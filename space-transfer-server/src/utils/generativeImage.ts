import sharp from "sharp";

/**
 * Conforms a generative edit back onto the source's geometry.
 *
 * Every instruction-editing model renders at its own canvas size — Gemini
 * around 1024px on the long edge, Cloudflare's SD1.5 img2img at 512 — and none
 * of them guarantee the input's aspect ratio. For a screen-only app that is
 * cosmetic. Here it is not: an artboard item's DPI is derived from
 * `pixels / physical inches`, so returning a 1024px edit of a 4000px artwork
 * silently drops a 300-DPI print file to 77 DPI, and the customer finds out
 * when the transfer arrives soft. A changed aspect ratio is worse — the item's
 * print box stays put while the image inside it stretches.
 *
 * So the contract for every generative tier is: whatever comes back is made to
 * match the source's pixel dimensions exactly. That keeps `reframed: false`
 * honest on the client, which in turn means the item's position, size and DPI
 * survive an edit untouched.
 *
 * Upsampling back to the source size does not invent detail the model didn't
 * produce, and this is explicit about that via `upsampled` — the caller
 * surfaces it so the customer knows to run Enhance if they want real detail
 * back, rather than trusting a DPI number that is technically true and
 * practically soft.
 */

/** Aspect ratios within this fraction of each other are treated as equal. */
const ASPECT_TOLERANCE = 0.02;

export interface ConformedImage {
  buffer: Buffer;
  widthPx: number;
  heightPx: number;
  /** True when the model rendered smaller than the source and was scaled up. */
  upsampled: boolean;
  /** True when the model changed the aspect ratio and the result was cropped. */
  cropped: boolean;
}

export interface SourceGeometry {
  width: number;
  height: number;
  /** Source carried an alpha channel, so the result must too. */
  hasAlpha: boolean;
}

export const readSourceGeometry = async (buffer: Buffer): Promise<SourceGeometry> => {
  const meta = await sharp(buffer, { limitInputPixels: false }).metadata();
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    hasAlpha: Boolean(meta.hasAlpha),
  };
};

export const conformToSource = async (
  edited: Buffer,
  source: SourceGeometry,
): Promise<ConformedImage> => {
  const meta = await sharp(edited, { limitInputPixels: false }).metadata();
  const editedWidth = meta.width ?? 0;
  const editedHeight = meta.height ?? 0;

  // Nothing to conform against — hand the bytes back rather than guessing at a
  // target size, which would be worse than leaving them alone.
  if (!source.width || !source.height || !editedWidth || !editedHeight) {
    return {
      buffer: edited,
      widthPx: editedWidth,
      heightPx: editedHeight,
      upsampled: false,
      cropped: false,
    };
  }

  const sourceAspect = source.width / source.height;
  const editedAspect = editedWidth / editedHeight;
  const cropped = Math.abs(editedAspect - sourceAspect) / sourceAspect > ASPECT_TOLERANCE;
  const upsampled = editedWidth < source.width;

  if (!cropped && editedWidth === source.width && editedHeight === source.height) {
    return { buffer: edited, widthPx: editedWidth, heightPx: editedHeight, upsampled: false, cropped: false };
  }

  // `cover` + centre crops away the aspect the model added, instead of
  // stretching the subject to fit. Lanczos3 is the right kernel in both
  // directions here — it is the sharpest of sharp's options on upsample and
  // does not introduce the ringing a plain bilinear scale would on downsample.
  let pipeline = sharp(edited, { limitInputPixels: false }).resize(source.width, source.height, {
    fit: "cover",
    position: "centre",
    kernel: "lanczos3",
  });

  // Alpha must survive: a cutout that comes back as opaque white is not a
  // cutout. PNG when the source had transparency, JPEG otherwise — a 4000px
  // PNG of a photograph is an order of magnitude larger for no visible gain.
  pipeline = source.hasAlpha
    ? pipeline.png({ compressionLevel: 9 })
    : pipeline.jpeg({ quality: 95, chromaSubsampling: "4:4:4" });

  const buffer = await pipeline.toBuffer();
  return { buffer, widthPx: source.width, heightPx: source.height, upsampled, cropped };
};
