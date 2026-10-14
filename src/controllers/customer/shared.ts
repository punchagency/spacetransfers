import { fetchStoredArtwork } from "../../services/storage.service.js";
import fs from "fs";
import path from "path";
import { assertBufferWithinBounds, decodeDataUrl, MAX_IMAGE_BYTES } from "../../utils/imageBounds.js";

export interface CustomError extends Error {
  statusCode?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export async function fetchImageBuffer(url: string): Promise<Buffer> {
  if (url.startsWith("data:")) {
    return decodeDataUrl(url);
  }
  if (url.includes("/uploads/")) {
    const marker = "/uploads/";
    const idx = url.lastIndexOf(marker);
    // basename() strips any traversal segments, so a crafted URL cannot escape
    // the uploads directory.
    const safeFilename = path.basename(url.substring(idx + marker.length));
    const localPath = path.join(process.cwd(), "uploads", safeFilename);
    if (fs.existsSync(localPath)) {
      // Checked before reading rather than after: a file over the ceiling
      // should not be pulled into memory just to be rejected.
      const { size } = await fs.promises.stat(localPath);
      if (size > MAX_IMAGE_BYTES) {
        throw Object.assign(
          new Error("That image is too large to process. Please re-export it at a smaller size."),
          { statusCode: 400, code: "IMAGE_TOO_LARGE" },
        );
      }
      return assertBufferWithinBounds(await fs.promises.readFile(localPath), "image");
    }
  }
  /*
   * Anything else must be a web address. A `blob:` URL (an image that only
   * exists in the customer's browser, because its upload failed) or a bare id
   * reached `fetch`, which threw a TypeError that surfaced as an unexplained 500.
   */
  if (!/^https?:\/\//i.test(url)) {
    throw Object.assign(
      new Error("This image hasn't finished uploading, so it can't be processed yet. Please try again once it has."),
      { statusCode: 400, code: "IMAGE_NOT_UPLOADED" },
    );
  }
  const r = await fetchStoredArtwork(url, 90_000, "Loading the image");
  if (!r.ok) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });

  // Trust the advertised length when present, so an oversized remote asset is
  // refused before its body is buffered.
  const declared = Number(r.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    throw Object.assign(
      new Error("That image is too large to process. Please re-export it at a smaller size."),
      { statusCode: 400, code: "IMAGE_TOO_LARGE" },
    );
  }

  return assertBufferWithinBounds(Buffer.from(await r.arrayBuffer()), "image");
}

export const roundToTwo = (value: number) => {
  return Math.round((value + Number.EPSILON) * 100) / 100;
};
