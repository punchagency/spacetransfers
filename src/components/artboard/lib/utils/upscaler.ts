import { postAssetRef } from "../../../../lib/utils/payloadImages";

export interface UpscaleResult {
  upscaledUrl: string;
  widthPx: number;
  heightPx: number;
  scale: number;
}

/**
 * Sends the image to the server for AI-powered upscaling (Real-ESRGAN via
 * Replicate when configured, otherwise sharp Lanczos3). Returns the new
 * Cloudinary URL and pixel dimensions. The caller is responsible for
 * preserving all artboard geometry (widthIn, heightIn, posX, posY, rotation).
 */
export const upscaleImageAI = async (
  url: string,
  scale: number,
): Promise<UpscaleResult> => {
  // Sends a reference, not the image — an upscale is usually requested on an
  // already-edited (data: URL) image, which is exactly the case that 413s.
  const result = await postAssetRef("/customer/assets/upscale", { url, scale });
  if (!result?.upscaledUrl) {
    throw new Error("Upscaling failed — server returned no URL");
  }
  return {
    upscaledUrl: result.upscaledUrl as string,
    widthPx: result.widthPx as number,
    heightPx: result.heightPx as number,
    scale: result.scale as number,
  };
};
