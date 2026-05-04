import sharp from "sharp";

export type AlphaCropOptions = {
  alphaThreshold: number;
  maxProbe: number;
};

export const computeAlphaCropRegion = async (
  filePath: string,
  { alphaThreshold, maxProbe }: AlphaCropOptions,
): Promise<{ left: number; top: number; width: number; height: number } | null> => {
  const meta = await sharp(filePath, { limitInputPixels: false }).metadata();
  const originalWidth = meta.width || 0;
  const originalHeight = meta.height || 0;
  if (!originalWidth || !originalHeight) return null;

  const probe = await sharp(filePath, { limitInputPixels: false })
    .ensureAlpha()
    .resize({
      width: Math.min(originalWidth, maxProbe),
      height: Math.min(originalHeight, maxProbe),
      fit: "inside",
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const probeWidth = probe.info.width;
  const probeHeight = probe.info.height;
  const buf = probe.data;

  let minX = probeWidth;
  let minY = probeHeight;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < probeHeight; y++) {
    for (let x = 0; x < probeWidth; x++) {
      const a = buf[(y * probeWidth + x) * 4 + 3];
      if (a > alphaThreshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0 || maxY < 0) return null;

  const scaleX = originalWidth / probeWidth;
  const scaleY = originalHeight / probeHeight;
  const left = Math.max(0, Math.floor(minX * scaleX));
  const top = Math.max(0, Math.floor(minY * scaleY));
  const right = Math.min(originalWidth, Math.ceil((maxX + 1) * scaleX));
  const bottom = Math.min(originalHeight, Math.ceil((maxY + 1) * scaleY));

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
};

export const verifyTightAlphaCrop = async (
  filePath: string,
  alphaThreshold: number,
): Promise<boolean> => {
  const img = await sharp(filePath, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = img.info.width;
  const h = img.info.height;
  const buf = img.data;

  const hasOnRow = (y: number) => {
    for (let x = 0; x < w; x++) {
      const a = buf[(y * w + x) * 4 + 3];
      if (a > alphaThreshold) return true;
    }
    return false;
  };

  const hasOnCol = (x: number) => {
    for (let y = 0; y < h; y++) {
      const a = buf[(y * w + x) * 4 + 3];
      if (a > alphaThreshold) return true;
    }
    return false;
  };

  return hasOnRow(0) && hasOnRow(h - 1) && hasOnCol(0) && hasOnCol(w - 1);
};

export const alphaTrimToFile = async (
  inputPath: string,
  outputPath: string,
  options: AlphaCropOptions,
) => {
  const region = await computeAlphaCropRegion(inputPath, options);
  if (!region) {
    await sharp(inputPath, { limitInputPixels: false }).ensureAlpha().png().toFile(outputPath);
    return;
  }
  await sharp(inputPath, { limitInputPixels: false }).ensureAlpha().extract(region).png().toFile(outputPath);

  const ok = await verifyTightAlphaCrop(outputPath, options.alphaThreshold);
  if (!ok) {
    const secondRegion = await computeAlphaCropRegion(outputPath, {
      ...options,
      maxProbe: Math.max(options.maxProbe, 1600),
    });
    if (secondRegion) {
      const tmp = `${outputPath}.tmp.png`;
      await sharp(outputPath, { limitInputPixels: false }).ensureAlpha().extract(secondRegion).png().toFile(tmp);
      await sharp(tmp, { limitInputPixels: false }).png().toFile(outputPath);
    }
  }
};

