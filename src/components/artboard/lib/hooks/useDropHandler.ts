import { useRef, useState } from "react";
import { readDPI, loadImageSize, validateImageFile, checkFade, shouldWarn } from "../utils";
import type { FadeVerdict } from "../utils";
import { placeNewItems, arrangeInitialLayout } from "../utils";
import { ArtboardItem } from "../../types";
import { gsap } from "gsap";
import { CANVAS } from "../../../../config/artboard.config";
import toast from "react-hot-toast";
import { showLargeImageWarning } from "../../../common/LargeImageWarning";
import type { CommitHistory } from "./useHistory";

/**
 * Hard ceiling on a single file's upload.
 *
 * Generous because it has to cover a genuinely large print file on a slow
 * connection — it exists to bound a hang, not to police slow uploads.
 */
const UPLOAD_TIMEOUT_MS = 90_000;

/**
 * How many files are processed at once.
 *
 * Four saturates a typical connection without exceeding the browser's own
 * per-host request cap (usually six), and keeps enough headroom that the
 * artboard stays responsive while a large drop is in flight.
 */
/**
 * Files uploaded in parallel.
 *
 * Six rather than four: each file spends nearly all its time waiting on a
 * network round trip, and six is the per-host connection limit browsers apply
 * to HTTP/1.1 — so this saturates the connection without queueing requests the
 * browser will not issue anyway. Higher only helps over HTTP/2 and costs
 * progress-bar smoothness and server headroom on large drops.
 */
const UPLOAD_CONCURRENCY = 6;

export const useDropHandler = (
  items: ArtboardItem[],
  setItems: React.Dispatch<React.SetStateAction<ArtboardItem[]>>,
  counter: number,
  setCounter: React.Dispatch<React.SetStateAction<number>>,
  setSelectedId: React.Dispatch<React.SetStateAction<number | null>>,
  canvasWidth: number,
  zoom: number,
  autoNestStickers: boolean,
  onRequestAutoNest: ((enabled: boolean) => void) | undefined,
  spacing: number,
  marginSize: number,
  commitHistory?: CommitHistory
) => {
  const [isDragging, setIsDragging] = useState(false);
  const [lowDpiCount, setLowDpiCount] = useState(0);
  const [fadeCount, setFadeCount] = useState(0);
  const lowDpiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);

  const activeUploadsRef = useRef<XMLHttpRequest[]>([]);
  const canceledRef = useRef(false);
  const warnedMaxHeightRef = useRef(false);
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  /**
   * Fade check.
   *
   * Replaces the old `semiTransparent / visible > 0.05` rule, which could not
   * tell a genuine fade from the three printable things that look identical to
   * a pixel count — anti-aliased edges, drop shadows and soft glows — and so
   * flagged ordinary cutouts as unprintable.
   *
   * `checkFade` prefers the AI verdict the upload response already carried, so
   * on the normal path this costs no request at all.
   */
  const detectFade = async (url: string, serverVerdict?: unknown): Promise<FadeVerdict> =>
    checkFade(url, serverVerdict);

  const cancelUploads = () => {
    canceledRef.current = true;
    activeUploadsRef.current.forEach((xhr) => {
      try {
        xhr.abort();
      } catch {
      }
    });
    activeUploadsRef.current = [];
    setIsUploading(false);
    setUploadProgress(0);
    setUploadFileName(null);
  };

  const uploadAssetWithProgress = (file: File, onProgress: (pct: number) => void) => {
    // Was hardcoded to http://localhost:4000/api, which meant every upload in
    // any deployed build pointed at a server on the customer's own machine.
    // Read from the environment the same way `apiFetch` does, so there is one
    // definition of where the API lives.
    const API_BASE_URL =
      import.meta.env.VITE_API_URL || "https://space-transfers-475154718031.herokuapp.com/api";
    const token = localStorage.getItem("token");

    return new Promise<any>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      activeUploadsRef.current.push(xhr);

      const release = () => {
        activeUploadsRef.current = activeUploadsRef.current.filter((x) => x !== xhr);
      };

      xhr.open("POST", `${API_BASE_URL}/customer/assets`);
      if (token) {
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      }

      /**
       * Without this an upload could wait forever.
       *
       * `xhr.onerror` only fires on a transport failure — a server that accepts
       * the body and then never answers (which is what a file it cannot decode
       * can produce) fires nothing at all, and the dialog sits at whatever
       * percentage it reached with no error, no timeout and no way out but
       * Cancel. That was the reported bug.
       *
       * The window is generous because it has to cover a genuinely large
       * artwork on a slow connection; it exists to bound a hang, not to police
       * slow uploads. `xhr.timeout` measures the whole request, and is reset by
       * neither upload progress nor a partial response.
       */
      xhr.timeout = UPLOAD_TIMEOUT_MS;
      xhr.ontimeout = () => {
        release();
        reject(
          new Error(
            `“${file.name}” timed out after ${Math.round(UPLOAD_TIMEOUT_MS / 1000)}s. Check your connection and try again.`,
          ),
        );
      };

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          onProgress(Math.max(0, Math.min(100, (evt.loaded / evt.total) * 100)));
        }
      };

      xhr.onload = () => {
        release();
        let json: any = {};
        try {
          json = JSON.parse(xhr.responseText || "{}");
        } catch {
          // A non-JSON body is normal for a proxy error page; fall through and
          // report on the status code, which is the part that is meaningful.
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(json);
        // The server's own message when it sent one — it knows why the file was
        // rejected and this is the only place that reason reaches the customer.
        else reject(new Error(json?.message || `Upload failed (${xhr.status})`));
      };

      xhr.onerror = () => {
        release();
        reject(new Error(`“${file.name}” couldn't be uploaded. Check your connection and try again.`));
      };

      xhr.onabort = () => {
        release();
        reject(new Error("Upload canceled"));
      };

      const formData = new FormData();
      formData.append("file", file);
      xhr.send(formData);
    });
  };

  /**
   * The only way `processDrop` is ever called.
   *
   * `processDrop` is long and touches decoding, the network, canvas work and
   * layout — any of which can throw. It was previously awaited directly from
   * the drop handlers with nothing catching it, so a single rejection (a
   * corrupt file made `loadImageSize` reject) escaped as an unhandled promise
   * rejection and the function simply stopped. `setIsUploading(false)` never
   * ran, so the dialog stayed on screen at whatever percentage it had reached,
   * forever, with no error — the reported bug.
   *
   * This wrapper makes that structurally impossible: the dialog is torn down in
   * a `finally`, so no future edit to `processDrop` can reintroduce a path that
   * leaves it stuck.
   */
  const runDrop = async (args: {
    droppedFiles: File[];
    droppedUrl: string;
    dropX: number;
    dropY: number;
  }) => {
    try {
      await processDrop(args);
    } catch (err: any) {
      if (err?.message === "Upload canceled") return;
      console.error("[UPLOAD] drop failed", err);
      toast.error(
        err?.message || "Those files could not be added. Please re-export them and try again.",
        { duration: 6000 },
      );
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setUploadFileName(null);
    }
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const processDrop = async ({
    droppedFiles,
    droppedUrl,
    dropX,
    dropY,
  }: {
    droppedFiles: File[];
    droppedUrl: string;
    dropX: number;
    dropY: number;
  }) => {
    setIsDragging(false);
    // Reassigned when the drop exceeds the remaining item capacity.
    let dropped = droppedFiles;
    if (dropped.length === 0 && !droppedUrl) return;

    if (items.length >= CANVAS.MAX_ITEMS) {
      toast.error(`Item limit of ${CANVAS.MAX_ITEMS} reached. Remove items to add more.`);
      return;
    }

    const cropImage = async (url: string, dpi: number) => {
      return new Promise<{
        url: string;
        widthIn: number;
        heightIn: number;
        widthPx: number;
        heightPx: number;
      } | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) { resolve(null); return; }

          // Use natural (native) pixel dimensions — img.width on a non-DOM Image
          // equals img.naturalWidth, so we capture the full original resolution.
          canvas.width  = img.width;
          canvas.height = img.height;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0);

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          const w = canvas.width;
          const h = canvas.height;

          // Check if ANY pixel has transparency (not just corners)
          let hasTransparency = false;
          for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 250) { hasTransparency = true; break; }
          }

          let minX = w, minY = h, maxX = -1, maxY = -1;
          let found = false;

          if (hasTransparency) {
            // Alpha-based: tight bounding box of non-transparent pixels
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                if (data[(y * w + x) * 4 + 3] > 10) {
                  found = true;
                  if (x < minX) minX = x;
                  if (x > maxX) maxX = x;
                  if (y < minY) minY = y;
                  if (y > maxY) maxY = y;
                }
              }
            }
          } else {
            // Sample the full border strip (~2% of the shorter side) for background color
            const borderW = Math.max(2, Math.round(Math.min(w, h) * 0.02));
            let sumR = 0, sumG = 0, sumB = 0, count = 0;

            for (let y = 0; y < borderW; y++) {
              for (let x = 0; x < w; x++) {
                let i = (y * w + x) * 4;
                sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2]; count++;
                i = ((h - 1 - y) * w + x) * 4;
                sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2]; count++;
              }
            }
            for (let x = 0; x < borderW; x++) {
              for (let y = borderW; y < h - borderW; y++) {
                let i = (y * w + x) * 4;
                sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2]; count++;
                i = (y * w + (w - 1 - x)) * 4;
                sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2]; count++;
              }
            }

            const bgR = count > 0 ? sumR / count : 255;
            const bgG = count > 0 ? sumG / count : 255;
            const bgB = count > 0 ? sumB / count : 255;
            const colorThreshold = 30;

            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const dr = data[i] - bgR;
                const dg = data[i + 1] - bgG;
                const db = data[i + 2] - bgB;
                if (Math.sqrt(dr * dr + dg * dg + db * db) > colorThreshold) {
                  found = true;
                  if (x < minX) minX = x;
                  if (x > maxX) maxX = x;
                  if (y < minY) minY = y;
                  if (y > maxY) maxY = y;
                }
              }
            }
          }

          if (!found || maxX < minX || maxY < minY) { resolve(null); return; }

          const cropWidth = maxX - minX + 1;
          const cropHeight = maxY - minY + 1;

          const croppedCanvas = document.createElement("canvas");
          const croppedCtx = croppedCanvas.getContext("2d");
          if (!croppedCtx) { resolve(null); return; }

          croppedCanvas.width  = cropWidth;
          croppedCanvas.height = cropHeight;
          croppedCtx.imageSmoothingEnabled = true;
          croppedCtx.imageSmoothingQuality = "high";
          // 1:1 pixel crop at native source resolution — no upscaling or downscaling
          croppedCtx.drawImage(img, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

          resolve({
            url: croppedCanvas.toDataURL("image/png"),
            widthPx: cropWidth,
            heightPx: cropHeight,
            widthIn: cropWidth / dpi,
            heightIn: cropHeight / dpi,
          });
        };
        img.onerror = () => resolve(null);
        img.src = url;
      });
    };

    const start = counter + 1;
    let lowDpiImages = 0;
    let fadeImages = 0;
    // Artwork wider than the printable area. Tallied across the drop so the
    // notice appears once, however many files were added.
    let oversizeImages = 0;

    const createItemFromUrl = async (
      url: string,
      idx: number,
      name?: string,
      dpiOverride?: number,
      originalUrlOverride?: string
    ) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const loaded = await new Promise<{ widthPx: number; heightPx: number }>((resolve, reject) => {
        img.onload = () => resolve({ widthPx: img.naturalWidth, heightPx: img.naturalHeight });
        img.onerror = reject;
        img.src = url;
      });

      const dpi = Math.max(1, Math.round(dpiOverride || 300));
      const widthIn = loaded.widthPx / dpi;
      const heightIn = loaded.heightPx / dpi;

      const baseItem: ArtboardItem = {
        id: start + idx,
        url,
        croppedUrl: url,
        rotation: 0,
        locked: false,
        expanded: false,
        flipped: false,
        autoCrop: true,
        copies: 1,
        widthIn,
        heightIn,
        posX: dropX - widthIn / 2,
        posY: dropY - heightIn / 2,
        linked: true,
        price: 12.34,
        name,
        gravityActive: false,
        isDropping: true,
        dpi,
        nativeWidthPx: loaded.widthPx,
        originalUrl: originalUrlOverride || url,
        originalWidthIn: widthIn,
        originalHeightIn: heightIn,
      };

      const cropped = await cropImage(url, dpi);
      if (cropped) {
        const deltaX = (widthIn - cropped.widthIn) / 2;
        const deltaY = (heightIn - cropped.heightIn) / 2;
        baseItem.url = cropped.url;
        baseItem.croppedUrl = cropped.url;
        baseItem.croppedWidthPx = cropped.widthPx;
        baseItem.croppedHeightPx = cropped.heightPx;
        baseItem.nativeWidthPx = cropped.widthPx;
        baseItem.widthIn = cropped.widthIn;
        baseItem.heightIn = cropped.heightIn;
        baseItem.posX = baseItem.posX + deltaX;
        baseItem.posY = baseItem.posY + deltaY;
      }

      // Oversized artwork is kept at the size it arrived and flagged, not
      // silently shrunk — the notice tells the customer they may want to resize
      // it, which would be untrue if it had already been resized for them.
      if (baseItem.widthIn > (canvasWidth || CANVAS.SHEET_WIDTH_IN) - 2 * marginSize) {
        oversizeImages++;
      }

      // No upload response on this path (the item came from a URL or a saved
      // design), so the checker resolves it against the server itself.
      const verdict = await detectFade(baseItem.url);
      baseItem.fade = verdict;
      baseItem.hasFade = shouldWarn(verdict);
      if (baseItem.hasFade) fadeImages++;

      return baseItem;
    };

    let created: ArtboardItem[] = [];

    if (dropped.length > 0) {
      canceledRef.current = false;
      const uploadUiStart = Date.now();
      setIsUploading(true);
      setUploadProgress(0);
      setUploadFileName(
        dropped.length > 1 ? `${dropped.length} files` : dropped[0]?.name || null,
      );
      // Uploads start immediately. There used to be a 200ms sleep here purely
      // so the progress dialog had time to appear, which delayed every drop by
      // a fifth of a second before a single byte moved. Dialog flicker on fast
      // uploads is handled at the other end instead (see the minimum-visible
      // window below), where it costs nothing.
      if (canceledRef.current) {
        setIsUploading(false);
        setUploadProgress(0);
        setUploadFileName(null);
        return;
      }

      // Capacity is resolved once, up front, instead of being re-checked inside
      // the loop. With files now processed concurrently there is no meaningful
      // "how many have I made so far" to test against mid-flight, and the
      // customer is better told immediately how many files won't fit.
      const capacity = Math.max(0, CANVAS.MAX_ITEMS - items.length);
      if (dropped.length > capacity) {
        const skipped = dropped.length - capacity;
        toast.error(
          `Item limit of ${CANVAS.MAX_ITEMS} reached. ${skipped} file${skipped !== 1 ? "s" : ""} skipped.`,
        );
        dropped = dropped.slice(0, capacity);
      }

      /**
       * Per-file progress, summed for the dialog.
       *
       * Files no longer finish in order, so progress cannot be derived from an
       * index. Each file owns a 0–1 slot and the bar shows their mean, which
       * stays monotonic and truthful however the individual uploads interleave.
       */
      const fileProgress = new Array(dropped.length).fill(0);
      const publishProgress = () => {
        const total = fileProgress.reduce((sum, p) => sum + p, 0);
        setUploadProgress(Math.max(0, Math.min(100, (total / dropped.length) * 100)));
      };

      /**
       * Builds one artboard item, or returns null if the file can't be used.
       *
       * Every failure path inside here reports and returns null rather than
       * throwing. A single unreadable file must not take down the whole drop —
       * previously one rejection escaped `processDrop` entirely, leaving
       * `isUploading` true forever with no message, which is exactly the hang
       * being fixed.
       */
      const buildItem = async (file: File, idx: number): Promise<ArtboardItem | null> => {
        // Content check first: it reads 16 bytes, needs no network, and catches
        // the "text file named .png" case before a byte is uploaded.
        const validation = await validateImageFile(file);
        if (!validation.ok) {
          toast.error(validation.message!, { duration: 6000 });
          return null;
        }

        const [dpiInfo, localInfo] = await Promise.all([
          readDPI(file),
          loadImageSize(file),
        ]);

        let assetResponse: any = null;
        try {
          assetResponse = await uploadAssetWithProgress(file, (pct) => {
            fileProgress[idx] = pct / 100;
            publishProgress();
          });
        } catch (err: any) {
          if (canceledRef.current || err?.message === "Upload canceled") throw err;
          // The server rejected or was unreachable. The local decode already
          // succeeded, so the artwork can still be placed from the object URL —
          // but say so, because it will not survive a reload.
          console.warn(`[UPLOAD] ${file.name} — ${err?.message}`);
          toast.error(err?.message || `“${file.name}” couldn't be uploaded.`, { duration: 6000 });
          assetResponse = null;
        }
        fileProgress[idx] = 1;
        publishProgress();

        const isPdf = file.type === "application/pdf";
        const rawDpi = Math.max(1, Math.round(assetResponse?.dpi || dpiInfo.dpiX || dpiInfo.dpiY || 300));
        // Mirror server normalization: values < 150 (e.g. 72 dpi JFIF defaults) are treated as unknown
        const dpi = rawDpi < 150 ? 300 : rawDpi;
        if (dpi < 300 && !isPdf) lowDpiImages++;

        const serverUrl = assetResponse?.url || localInfo.url;
        const trimmedUrl = assetResponse?.trimmedUrl || null;
        const widthPx = assetResponse?.widthPx || localInfo.widthPx;
        const heightPx = assetResponse?.heightPx || localInfo.heightPx;

        const originalWidthIn = assetResponse?.widthIn || (widthPx / dpi);
        const originalHeightIn = assetResponse?.heightIn || (heightPx / dpi);
        const widthIn =
          (trimmedUrl ? assetResponse?.trimmedWidthIn : null) || originalWidthIn;
        const heightIn =
          (trimmedUrl ? assetResponse?.trimmedHeightIn : null) || originalHeightIn;

        const baseItem: ArtboardItem = {
          id: start + idx,
          url: trimmedUrl || serverUrl,
          rotation: 0,
          locked: false,
          expanded: false,
          flipped: false,
          autoCrop: true,
          copies: 1,
          widthIn,
          heightIn,
          posX: dropX - widthIn / 2,
          posY: dropY - heightIn / 2,
          linked: true,
          price: 12.34,
          name: file.name,
          gravityActive: false,
          isDropping: true,
          dpi,
          assetId: assetResponse?.id,
          // croppedUrl is the authoritative full-resolution export URL — always a server
          // URL (Cloudinary) or a native-resolution canvas data URL. Separate from `url`
          // (the display URL) so the export path never depends on CSS-scaled previews.
          croppedUrl: trimmedUrl || serverUrl,
          nativeWidthPx: (trimmedUrl ? assetResponse?.trimmedWidthPx : null) || widthPx,
          originalUrl: serverUrl,
          originalWidthIn,
          originalHeightIn,
        };

        if (!trimmedUrl && !isPdf) {
          const cropped = await cropImage(serverUrl, dpi);
          if (cropped) {
            const deltaX = (widthIn - cropped.widthIn) / 2;
            const deltaY = (heightIn - cropped.heightIn) / 2;
            baseItem.url = cropped.url;
            // Canvas crop produces full-resolution pixel data (naturalWidth × naturalHeight).
            // Store as croppedUrl so the export uses this tight crop, not the larger original.
            baseItem.croppedUrl = cropped.url;
            // Store pixel dimensions of the canvas-cropped output. The server DPI calculator
            // uses these instead of the DB's widthPx (the original, larger pre-crop value)
            // so it never upscales the canvas data URL during composition.
            baseItem.croppedWidthPx = cropped.widthPx;
            baseItem.croppedHeightPx = cropped.heightPx;
            baseItem.nativeWidthPx = cropped.widthPx;
            baseItem.widthIn = cropped.widthIn;
            baseItem.heightIn = cropped.heightIn;
            baseItem.posX = baseItem.posX + deltaX;
            baseItem.posY = baseItem.posY + deltaY;
          }
        }

        // Counted, not clamped. The upload succeeded and the item is usable;
        // whether to resize it is the customer's call, and the notice below
        // says so once for the whole drop rather than once per file.
        if (baseItem.widthIn > (canvasWidth || CANVAS.SHEET_WIDTH_IN) - 2 * marginSize) {
          oversizeImages++;
        }

        if (!isPdf) {
          /**
           * The upload already ran the AI check on the buffer it held, so its
           * verdict is passed straight through — no second analysis, and no
           * request. Only an image the server never saw falls back to a call.
           *
           * Checked against `baseItem.url` rather than the original, because a
           * canvas auto-crop can remove the very region that faded.
           */
          const verdict = await detectFade(
            baseItem.url,
            baseItem.url === (trimmedUrl || serverUrl) ? assetResponse?.fade : undefined,
          );
          baseItem.fade = verdict;
          // `hasFade` drives the border colour and the warning banner, so it is
          // only set once the verdict clears the confidence threshold — a
          // low-confidence guess must not turn an image orange.
          baseItem.hasFade = shouldWarn(verdict);
          if (baseItem.hasFade) fadeImages++;
        }

        return baseItem;
      };

      /**
       * Runs the files through a fixed-size pool.
       *
       * Each file spends most of its time waiting — on a network round trip, or
       * on the browser decoding an image off the main thread — so processing
       * them strictly one after another left the connection idle for most of a
       * multi-file drop. With a pool, twenty images take roughly as long as the
       * slowest few rather than the sum of all twenty.
       *
       * Bounded rather than unbounded: `Promise.all` over the whole set would
       * open one request per file, which on a large drop buries the server, is
       * throttled by the browser's own per-host connection cap anyway, and
       * makes the progress bar meaningless. Four is comfortably above the point
       * where the connection stays saturated.
       *
       * Results are written by index, so the artboard receives them in the
       * order they were dropped no matter what order they complete in —
       * otherwise identical drops would lay out differently run to run.
       */
      const results: (ArtboardItem | null)[] = new Array(dropped.length).fill(null);
      let cursor = 0;

      const worker = async () => {
        while (cursor < dropped.length) {
          if (canceledRef.current) return;
          const idx = cursor++;
          const file = dropped[idx];
          // Only meaningful for a single file. With a pool running, four names
          // would race each other in the dialog several times a second, which
          // reads as a glitch; the count set before the pool started is both
          // stable and more useful.
          if (dropped.length === 1) setUploadFileName(file.name);
          try {
            results[idx] = await buildItem(file, idx);
          } catch (err: any) {
            // Cancel unwinds every worker; anything else is this file's problem
            // alone and must not stop the rest of the drop.
            if (canceledRef.current || err?.message === "Upload canceled") throw err;
            console.warn(`[UPLOAD] ${file.name} failed`, err);
            toast.error(
              err?.message || `“${file.name}” could not be read — please re-export it and try again.`,
              { duration: 6000 },
            );
            results[idx] = null;
            // Count the failed slot so the bar still reaches 100%.
            fileProgress[idx] = 1;
            publishProgress();
          }
        }
      };

      try {
        await Promise.all(
          Array.from({ length: Math.min(UPLOAD_CONCURRENCY, dropped.length) }, worker),
        );
      } catch (err: any) {
        if (canceledRef.current || err?.message === "Upload canceled") {
          setIsUploading(false);
          setUploadProgress(0);
          setUploadFileName(null);
          return;
        }
        throw err;
      }

      if (canceledRef.current) {
        setIsUploading(false);
        setUploadProgress(0);
        setUploadFileName(null);
        return;
      }

      created = results.filter((item): item is ArtboardItem => item !== null);

      // Every file failed validation or upload. Nothing to place, and the
      // per-file toasts have already explained why — so close the dialog
      // rather than animating an empty success.
      if (created.length === 0) {
        setIsUploading(false);
        setUploadProgress(0);
        setUploadFileName(null);
        return;
      }

      setUploadProgress(100);
      /**
       * Anti-flicker floor, reduced from 700ms.
       *
       * The old floor held the dialog open for at least 700ms after the work
       * finished, so a drop that completed in 80ms still took the better part
       * of a second before artwork appeared. 260ms is long enough that the
       * dialog does not read as a flash, and short enough that a fast upload
       * feels immediate.
       */
      const MIN_DIALOG_VISIBLE_MS = 260;
      const elapsed = Date.now() - uploadUiStart;
      if (elapsed < MIN_DIALOG_VISIBLE_MS) await sleep(MIN_DIALOG_VISIBLE_MS - elapsed);
      setIsUploading(false);
      setUploadFileName(null);
    } else {
      let asset: any = null;
      try {
        asset = JSON.parse(droppedUrl);
      } catch {
      }

      const url = asset?.trimmedUrl || asset?.url || droppedUrl;
      const dpi = asset?.dpi;
      created = [
        await createItemFromUrl(
          url,
          0,
          asset?.originalFilename,
          dpi,
          asset?.url
        ),
      ];
    }

    // Informational, and deliberately last: the upload has completed and the
    // items are on the sheet by this point, so nothing about it is blocking.
    if (oversizeImages > 0) {
      showLargeImageWarning(oversizeImages);
    }

    if (lowDpiImages > 0) {
      if (lowDpiTimerRef.current) clearTimeout(lowDpiTimerRef.current);
      setLowDpiCount(lowDpiImages);
      lowDpiTimerRef.current = setTimeout(() => setLowDpiCount(0), 7000);
    }
    if (fadeImages > 0) {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      setFadeCount(fadeImages);
      fadeTimerRef.current = setTimeout(() => setFadeCount(0), 7000);
    }

    // 1. Place ONLY the new items — they flow into whatever gaps the current
    // layout already has (or extend the sheet downward). Existing artwork is
    // never repositioned by an upload, so adding files can't scramble a
    // layout the user has already arranged.
    setTimeout(() => {
      // Always use the real sheet width (inches), not viewport width,
      // otherwise items can be laid out beyond the top ruler break (23.5").
      const currentCanvasWidth = canvasWidth || CANVAS.SHEET_WIDTH_IN;

      const allItems = [...items, ...created];
      const effectiveMargin = marginSize;

      // First upload of a multi-image batch onto an empty board: shelf-pack
      // the whole batch so every row fills the sheet's full printable width
      // (the gap packer would stack items that don't share a row height,
      // wasting most of the horizontal space). With existing content, new
      // items flow into the current layout's gaps instead.
      const isFirstMultiUpload = items.length === 0 && created.length > 1;
      const finalUpdatesRaw = isFirstMultiUpload
        ? arrangeInitialLayout(created, currentCanvasWidth, spacing, effectiveMargin)
        : placeNewItems(
            allItems,
            new Set(created.map((c) => c.id)),
            currentCanvasWidth,
            spacing,
            effectiveMargin
          );

      // Enforce max sheet height (100 feet = 1200 inches).
      // Copies can wrap vertically, so clamp using a conservative
      // "worst-case" group height so items can never exceed the ruler bottom.
      const MAX_SHEET_HEIGHT_IN = 1200;
      let didClamp = false;
      const finalUpdates = finalUpdatesRaw.map((u: any) => {
        const itemH = typeof u.heightIn === "number" ? u.heightIn : 0;
        const copies = typeof u.copies === "number" && u.copies > 0 ? u.copies : 1;
        const gap = CANVAS.GRID_GAP_IN;
        const groupHeightIn = copies <= 1 ? itemH : copies * itemH + (copies - 1) * gap;
        const maxPosY = Math.max(0, MAX_SHEET_HEIGHT_IN - groupHeightIn);
        const nextPosY = Math.max(0, Math.min(u.posY, maxPosY));
        // Only warn when the item actually overflowed the BOTTOM limit. Raising
        // a negative posY up to the top (nextPosY > u.posY) is a normal top-edge
        // snap, not a sheet-height overflow, and must not trigger the toast.
        if (u.posY > maxPosY + 1e-6) didClamp = true;
        return { ...u, posY: nextPosY };
      });

      if (didClamp && !warnedMaxHeightRef.current) {
        toast.error("Max sheet height of 1200 inches reached.");
        warnedMaxHeightRef.current = true;
      }

      // 2. Preserve NEW items at their drop position initially (avoid instant jump).
      commitHistory?.();
      // Membership via a Set rather than `created.some(...)` inside the map:
      // that was a linear scan per item, so a 1000-file drop cost a million
      // comparisons on the main thread before a single pixel changed.
      const createdIds = new Set(created.map((c) => c.id));
      setItems((prev) => {
        // Keep existing items first so newly dropped singles are arranged after them
        // (below grouped/copies items in the packed layout).
        const withCreated = [...prev, ...created];
        return withCreated.map((it) =>
          createdIds.has(it.id) ? { ...it, gravityActive: false } : it,
        );
      });

      // 3. Animate each new item from where it was dropped to its slot with a
      // quick spring — existing items are untouched by design, so there's no
      // longer any shove/shake choreography to run against them.
      setTimeout(() => {
        const PPI = CANVAS.PIXELS_PER_INCH;

        /**
         * Largest drop that still gets the fly-in animation.
         *
         * The stagger was `index * 0.06`, which is fine for the handful of
         * files this was written for and absurd beyond that: a 1000-file drop
         * put the last item's animation 60 seconds after the first, so artwork
         * trickled onto the board long after it had finished uploading. That
         * is the "items load one by one" symptom — the data was already there.
         *
         * Past this count the animation is skipped entirely rather than
         * compressed. A thousand simultaneous tweens is itself a frame-rate
         * problem, and at that scale the useful feedback is "the sheet filled
         * up", not each piece's flight path.
         */
        const MAX_ANIMATED_ITEMS = 120;
        /** Total time the whole stagger is allowed to span, in seconds. */
        const STAGGER_WINDOW_S = 0.9;

        if (created.length > MAX_ANIMATED_ITEMS) {
          // Land everything at its packed position in one state update.
          setItems((prev) => {
            const byId = new Map(finalUpdates.map((u) => [u.id, u]));
            return prev.map((it) => {
              const update = byId.get(it.id);
              if (!update || !it.isDropping) return it;
              return {
                ...it,
                posX: update.posX,
                posY: update.posY,
                flowCols: update.flowCols,
                flowStartCol: update.flowStartCol,
                flowEndCol: update.flowEndCol,
                nestRotation: (update.nestRotation ?? 0) as 0 | 90,
                isDropping: false,
              };
            });
          });
          return;
        }

        // Indexed once instead of `finalUpdates.find(...)` per item, which was
        // another linear scan inside a loop over every dropped file.
        const updateById = new Map(finalUpdates.map((u) => [u.id, u]));
        const stagger = Math.min(0.06, STAGGER_WINDOW_S / Math.max(1, created.length));

        created.forEach((item, index) => {
          const update = updateById.get(item.id);
          if (!update) return;

          const element = document.querySelector(
            `[data-item-id="${item.id}"]`
          ) as HTMLElement;
          if (!element) return;

          gsap.fromTo(
            element,
            {
              left: `${(dropX - item.widthIn / 2) * PPI}px`,
              top: `${(dropY - item.heightIn / 2) * PPI}px`,
              scale: 1.06,
              opacity: 0,
            },
            {
              left: `${update.posX * PPI}px`,
              top: `${update.posY * PPI}px`,
              scale: 1,
              opacity: 1,
              duration: 0.65,
              delay: index * stagger,
              ease: "back.out(1.2)",
              immediateRender: true,
              onComplete: () => {
                setItems((prev) =>
                  prev.map((it) => {
                    if (it.id !== item.id) return it;
                    // User dragged the item before animation finished — don't override
                    if (!it.isDropping) return it;
                    return {
                      ...it,
                      posX: update.posX,
                      posY: update.posY,
                      flowCols: update.flowCols,
                      flowStartCol: update.flowStartCol,
                      flowEndCol: update.flowEndCol,
                      nestRotation: (update.nestRotation ?? 0) as 0 | 90,
                      isDropping: false,
                    };
                  })
                );
              },
            }
          );
        });
      }, 50);
    }, 50);

    setCounter(start + dropped.length - 1);
    setSelectedId(null);
  };

  const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "application/pdf"];

  const filterFiles = (files: File[]) => {
    const accepted = files.filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type));
    const other = files.filter((f) => !ACCEPTED_IMAGE_TYPES.includes(f.type));
    if (other.length > 0) {
      toast.error(`${other.length} unsupported file${other.length > 1 ? "s" : ""} skipped. Accepted: PNG, JPG, SVG, PDF.`);
    }
    return accepted;
  };

  const onDropEvent = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = filterFiles(Array.from(e.dataTransfer.files || []));
    const jsonData =
      e.dataTransfer.getData("application/json") ||
      e.dataTransfer.getData("text/plain");
    const droppedUrl = droppedFiles.length === 0 ? jsonData : "";
    if (droppedFiles.length === 0 && !droppedUrl) return;
    // Multi-file drops no longer force the Auto-Nest toggle on: enabling it
    // now triggers a deliberate full-sheet optimization (see
    // useArtboardEffects), which must stay an explicit user choice — new
    // files already pack into existing gaps on their own via placeNewItems.

    const rect = e.currentTarget.getBoundingClientRect();
    const zoomVal = zoom || 1;
    const offset = CANVAS.RULER_OFFSET_PX;
    const ppi = CANVAS.PIXELS_PER_INCH;
    
    const dropX = (e.clientX - rect.left - offset) / (ppi * zoomVal);
    const dropY = (e.clientY - rect.top - offset) / (ppi * zoomVal);

    await runDrop({ droppedFiles, droppedUrl, dropX, dropY });
  };

  const dropFilesAtCenter = async (files: FileList | File[]) => {
    const arr = Array.isArray(files) ? files : Array.from(files);
    const droppedFiles = filterFiles(arr);
    if (droppedFiles.length === 0) return;

    const currentCanvasWidth = canvasWidth || CANVAS.SHEET_WIDTH_IN;
    const dropX = currentCanvasWidth / 2;
    const dropY = 6;
    await runDrop({ droppedFiles, droppedUrl: "", dropX, dropY });
  };

  return {
    isDragging,
    lowDpiCount,
    fadeCount,
    isUploading,
    uploadProgress,
    uploadFileName,
    cancelUploads,
    dropFilesAtCenter,
    onDragOver,
    onDragLeave,
    onDropEvent,
  };
};
