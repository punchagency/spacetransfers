const THUMBNAIL_MAX_PX = 1024;

/**
 * JPEG/WebP quality for the capture.
 *
 * Lossy is free here: the print pipeline composites from the original
 * full-resolution assets and never reads this image, so compression cannot
 * affect output. 0.82 is where artefacts stop being perceptible on artwork at
 * thumbnail scale.
 */
const THUMBNAIL_QUALITY = 0.82;

/**
 * Captures the artboard as a bounded data URL for use as a design thumbnail.
 *
 * Rendered at whatever scale keeps the longest edge within `THUMBNAIL_MAX_PX`,
 * and never enlarged past 2× — upscaling a small artboard adds bytes without
 * adding detail.
 */
export const captureArtboard = async (): Promise<string> => {
  const artboard = document.querySelector('.flex-1.relative.flex.items-center') as HTMLElement;
  if (!artboard) throw new Error('Artboard element not found');

  const rect = artboard.getBoundingClientRect();

  /**
   * Scale comes from the size cap, not from devicePixelRatio.
   *
   * Keying off DPR made the payload depend on the customer's hardware: the same
   * sheet produced a 4× larger thumbnail on a Retina laptop than on a 1×
   * monitor, so the failure reproduced for some users and not others on
   * identical designs. A fixed target makes output size predictable everywhere.
   */
  const longestEdge = Math.max(rect.width, rect.height, 1);
  const dpr = Math.min(THUMBNAIL_MAX_PX / longestEdge, 2);

  const canvas = document.createElement('canvas');
  canvas.width  = Math.max(1, Math.round(rect.width  * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context not available');

  // Scale so all subsequent draw calls use CSS pixel coordinates; the canvas
  // itself is already sized at physical (dpr-scaled) pixel dimensions.
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // White background base
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, rect.width, rect.height);

  // Optional checkerboard grid
  const gridBg = artboard.querySelector('.absolute.inset-0.z-0') as HTMLElement;
  if (gridBg) {
    const pattern = ctx.createPattern(createPatternCanvas(), 'repeat');
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, rect.width, rect.height);
    }
  }

  // Draw each artboard image at CSS-coordinate size; the ctx.scale(dpr) above
  // automatically maps these to the higher physical-pixel canvas dimensions.
  const images = artboard.querySelectorAll('img[alt^="copy-"], img[alt="dropped"]');
  for (const img of Array.from(images)) {
    const htmlImg = img as HTMLImageElement;
    const imgRect = htmlImg.getBoundingClientRect();
    const x = imgRect.left - rect.left;
    const y = imgRect.top  - rect.top;
    ctx.drawImage(htmlImg, x, y, imgRect.width, imgRect.height);
  }

  /**
   * WebP where available, JPEG otherwise.
   *
   * WebP is roughly 30% smaller at equivalent quality. Browsers that cannot
   * encode it return a PNG data URL from `toDataURL` regardless of the type
   * argument, so the result is checked rather than feature-detected.
   */
  const webp = canvas.toDataURL('image/webp', THUMBNAIL_QUALITY);
  return webp.startsWith('data:image/webp')
    ? webp
    : canvas.toDataURL('image/jpeg', THUMBNAIL_QUALITY);
};

const createPatternCanvas = (): HTMLCanvasElement => {
  const patternCanvas = document.createElement('canvas');
  patternCanvas.width  = 40;
  patternCanvas.height = 40;
  const pCtx = patternCanvas.getContext('2d');
  if (pCtx) {
    pCtx.fillStyle = '#E9F2F1';
    pCtx.fillRect(0,  0,  10, 10);
    pCtx.fillRect(10, 10, 10, 10);
    pCtx.fillRect(20, 0,  10, 10);
    pCtx.fillRect(30, 10, 10, 10);
    pCtx.fillRect(0,  20, 10, 10);
    pCtx.fillRect(10, 30, 10, 10);
    pCtx.fillRect(20, 20, 10, 10);
    pCtx.fillRect(30, 30, 10, 10);
  }
  return patternCanvas;
};
