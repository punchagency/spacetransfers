export const captureArtboard = async (): Promise<string> => {
  const artboard = document.querySelector('.flex-1.relative.flex.items-center') as HTMLElement;

  if (!artboard) {
    throw new Error('Artboard element not found');
  }

  const scale = 0.25;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const rect = artboard.getBoundingClientRect();
  canvas.width = rect.width * scale;
  canvas.height = rect.height * scale;

  if (!ctx) {
    throw new Error('Canvas context not available');
  }

  // Draw background
  const gridBg = artboard.querySelector('.absolute.inset-0.z-0') as HTMLElement;
  if (gridBg) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const pattern = ctx.createPattern(await createPatternCanvas(), 'repeat');
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  // Draw images
  const images = artboard.querySelectorAll('img[alt^="copy-"], img[alt="dropped"]');
  for (const img of Array.from(images)) {
    const htmlImg = img as HTMLImageElement;
    const imgRect = htmlImg.getBoundingClientRect();
    const x = (imgRect.left - rect.left) * scale;
    const y = (imgRect.top - rect.top) * scale;
    const w = imgRect.width * scale;
    const h = imgRect.height * scale;
    ctx.drawImage(htmlImg, x, y, w, h);
  }

  return canvas.toDataURL('image/jpeg', 0.85);
};

const createPatternCanvas = async (): Promise<HTMLCanvasElement> => {
  const patternCanvas = document.createElement('canvas');
  patternCanvas.width = 40;
  patternCanvas.height = 40;
  const pCtx = patternCanvas.getContext('2d');
  if (pCtx) {
    pCtx.fillStyle = '#E9F2F1';
    pCtx.fillRect(0, 0, 10, 10);
    pCtx.fillRect(10, 10, 10, 10);
    pCtx.fillRect(20, 0, 10, 10);
    pCtx.fillRect(30, 10, 10, 10);
    pCtx.fillRect(0, 20, 10, 10);
    pCtx.fillRect(10, 30, 10, 10);
    pCtx.fillRect(20, 20, 10, 10);
    pCtx.fillRect(30, 30, 10, 10);
  }
  return patternCanvas;
};
