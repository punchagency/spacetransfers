import { useRef, useState } from "react";
import { readDPI, loadImageSize, validateImageFile, checkFade, shouldWarn } from "../utils";
import type { FadeVerdict } from "../utils";
import { placeNewItems, arrangeInitialLayout, isSheetFull } from "../utils";
import { autoCropImage } from "../utils/autoCrop";
import { ArtboardItem } from "../../types";
import { gsap } from "gsap";
import {
  ACCEPTED_IMAGE_TYPES,
  CANVAS,
  MAX_SHEET_HEIGHT_IN,
} from "../../../../config/artboard.config";
import toast from "react-hot-toast";
import { showLargeImageWarning } from "../../../common/LargeImageWarning";
import {
  showUnsupportedFilesWarning,
  showUnsupportedFileWarning,
} from "../../../common/UnsupportedFilesWarning";
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

/**
 * How many finished items are committed to the board at once.
 *
 * Items used to be held back until every file in the drop had finished, so a
 * 120-file batch showed nothing at all for its entire duration. They are now
 * flushed in chunks as they complete.
 *
 * Chunked rather than one-at-a-time because each flush runs the packer and a
 * React commit over the whole board: at 120 items that is 120 packing passes
 * versus 15, for no visible difference at the speed uploads actually land.
 */
const COMMIT_CHUNK_SIZE = 8;

/** Longest a finished item waits for chunk-mates before being committed alone. */
const COMMIT_MAX_WAIT_MS = 400;

/**
 * Largest batch that still gets the fly-in animation.
 *
 * Beyond this the stagger is noise — and, more importantly, a thousand
 * simultaneous tweens is its own frame-rate problem. Correctness never depends
 * on this: items are committed at their final packed position regardless, and
 * the tween is a purely visual `from` on top of an already-correct layout.
 */
const MAX_ANIMATED_ITEMS = 120;

/** Total time an animated stagger is allowed to span, in seconds. */
const STAGGER_WINDOW_S = 0.9;

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

  /** Images placed so far in the active batch, and its size. Drives the overlay. */
  const [batchLoaded, setBatchLoaded] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);

  /**
   * Per-batch state, keyed by a token minted on each drop.
   *
   * Previously a single `canceledRef` boolean and one flat `activeUploadsRef`
   * array were shared by every drop. A second drop starting while the first was
   * still running reset `canceledRef` to false under the first batch's workers
   * and both wrote to the same progress state; cancelling either aborted both.
   * That shared mutable state is why a repeat upload could wedge the board —
   * the second batch inherited the first's bookkeeping.
   *
   * A token per batch makes the batches genuinely independent: a worker only
   * ever consults its own cancel flag, and only its own requests are aborted.
   */
  const batchTokenRef = useRef(0);
  const canceledBatchesRef = useRef(new Set<number>());
  const activeUploadsRef = useRef(new Map<number, Set<XMLHttpRequest>>());

  /**
   * Monotonic item-id allocator.
   *
   * Ids were derived as `counter + 1 + index`, where `counter` came from the
   * render closure. Two drops issued before React re-rendered — which is
   * exactly what "upload the same batch again" does — both read the same
   * `counter` and minted the *same ids*. Duplicate ids mean duplicate React
   * keys, items that overwrite each other in the packer's id map, and
   * `setItems` updates landing on the wrong element: the reported "new images
   * stuck floating around the first upload".
   *
   * A ref cursor cannot go backwards and cannot be stale, so ids are unique
   * across overlapping batches by construction. It is seeded from `counter` so
   * ids stay continuous with a restored design.
   */
  const idCursorRef = useRef(0);

  const warnedMaxHeightRef = useRef(false);
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const isCanceled = (token: number) => canceledBatchesRef.current.has(token);

  /** Frees a finished batch's bookkeeping so neither set grows without bound. */
  const releaseBatch = (token: number) => {
    canceledBatchesRef.current.delete(token);
    activeUploadsRef.current.delete(token);
  };

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

  /**
   * Cancels every in-flight batch.
   *
   * The button is global ("Cancel" on the overlay), so this marks all live
   * tokens rather than one — but each worker still checks only its own token,
   * so the semantics stay per-batch and a batch that finishes first is
   * unaffected by a later cancel.
   */
  const cancelUploads = () => {
    activeUploadsRef.current.forEach((requests, token) => {
      canceledBatchesRef.current.add(token);
      requests.forEach((xhr) => {
        try {
          xhr.abort();
        } catch {
          // Already settled — nothing to abort.
        }
      });
      requests.clear();
    });
    setIsUploading(false);
    setUploadProgress(0);
    setUploadFileName(null);
    setBatchLoaded(0);
    setBatchTotal(0);
  };

  const uploadAssetWithProgress = (
    file: File,
    token: number,
    onProgress: (pct: number) => void,
  ) => {
    // Was hardcoded to http://localhost:4000/api, which meant every upload in
    // any deployed build pointed at a server on the customer's own machine.
    // Read from the environment the same way `apiFetch` does, so there is one
    // definition of where the API lives.
    const API_BASE_URL =
      import.meta.env.VITE_API_URL || "https://space-transfers-475154718031.herokuapp.com/api";
    const authToken = localStorage.getItem("token");

    return new Promise<any>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let requests = activeUploadsRef.current.get(token);
      if (!requests) {
        requests = new Set<XMLHttpRequest>();
        activeUploadsRef.current.set(token, requests);
      }
      requests.add(xhr);

      const release = () => {
        activeUploadsRef.current.get(token)?.delete(xhr);
      };

      xhr.open("POST", `${API_BASE_URL}/customer/assets`);
      if (authToken) {
        xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
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

    // Length, not count: a sheet is full when its artwork reaches the 1200in
    // maximum, however many images that took.
    if (isSheetFull(items as any)) {
      toast.error(
        `Sheet is full — the maximum length of ${MAX_SHEET_HEIGHT_IN.toLocaleString()}in has been reached. Remove artwork to add more.`,
      );
      return;
    }


    /**
     * Seeded from the render's `counter`, but never allowed to move backwards.
     *
     * `Math.max` is what makes a repeat drop safe: if React has not yet
     * re-rendered with the previous batch's counter, `counter` is stale and
     * lower than what has already been issued — taking the max keeps the
     * cursor ahead of every id in play instead of reissuing them.
     */
    idCursorRef.current = Math.max(idCursorRef.current, counter);
    const nextItemId = () => (idCursorRef.current += 1);

    let lowDpiImages = 0;
    let fadeImages = 0;
    // Artwork wider than the printable area. Tallied across the drop so the
    // notice appears once, however many files were added.
    let oversizeImages = 0;

    const createItemFromUrl = async (
      url: string,
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
        id: nextItemId(),
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

      const cropped = await autoCropImage(url, dpi);
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
      const token = (batchTokenRef.current += 1);
      const uploadUiStart = Date.now();
      setIsUploading(true);
      setUploadProgress(0);
      setUploadFileName(
        dropped.length > 1 ? `${dropped.length} files` : dropped[0]?.name || null,
      );

      // Capacity is resolved once, up front, instead of being re-checked inside
      // the loop. With files now processed concurrently there is no meaningful
      // "how many have I made so far" to test against mid-flight, and the
      // customer is better told immediately how many files won't fit.
      /**
       * Only the absolute safety ceiling is checked up front.
       *
       * How many of these files fit is a question about their physical sizes,
       * which are not known until each has been decoded — so it cannot be
       * answered here. The real limit is enforced where it can be: the packer
       * refuses any placement past the sheet's length, and `flushPending`
       * reports whatever did not fit.
       */
      const capacity = Math.max(0, CANVAS.MAX_ITEMS - items.length);
      if (dropped.length > capacity) {
        const skipped = dropped.length - capacity;
        toast.error(
          `That is more artwork than a single sheet can hold. ${skipped} file${skipped !== 1 ? "s" : ""} skipped.`,
        );
        dropped = dropped.slice(0, capacity);
      }

      setBatchTotal(dropped.length);
      setBatchLoaded(0);

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
       * Progressive commit.
       *
       * Finished items are buffered here and flushed to the board in chunks
       * while the rest of the batch is still uploading, so artwork appears as
       * it lands instead of all at once at the end.
       *
       * The packing runs *inside* the `setItems` updater, against `prev`. That
       * matters more than it looks: the previous implementation packed against
       * the `items` array captured in the render closure, which on a 120-file
       * drop was a snapshot from before the upload started — tens of seconds
       * stale by the time it was used. New items were therefore packed against
       * a board that no longer existed, and landed on top of whatever had been
       * added since. Reading `prev` is the only way to see the real board.
       */
      const pending: ArtboardItem[] = [];
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      let committedCount = 0;

      /**
       * Files resolved by *this* batch, counted locally and published only
       * while this batch owns the overlay.
       *
       * Incrementing the shared counter with `n => n + 1` let a still-running
       * batch drive the display of a newer one, so the overlay could read
       * "150 / 120". Counting locally keeps each batch's number its own.
       */
      /**
       * Artwork refused for want of sheet length, tallied across the batch.
       *
       * Reported once at the end rather than per chunk: a full sheet rejects
       * every remaining file, and fifteen identical toasts is noise.
       */
      let overflowedInBatch = 0;
      let overflowReported = false;
      const reportOverflow = () => {
        if (overflowReported || overflowedInBatch === 0) return;
        overflowReported = true;
        toast.error(
          `Sheet is full at ${MAX_SHEET_HEIGHT_IN.toLocaleString()}in. ` +
            `${overflowedInBatch} image${overflowedInBatch === 1 ? "" : "s"} could not be added.`,
          { duration: 6000, id: "sheet-full" },
        );
      };

      let resolvedInBatch = 0;
      const publishLoaded = () => {
        resolvedInBatch += 1;
        if (batchTokenRef.current === token) setBatchLoaded(resolvedInBatch);
      };

      const flushPending = () => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (pending.length === 0 || isCanceled(token)) return;

        const chunk = pending.splice(0, pending.length);
        const chunkIds = new Set(chunk.map((c) => c.id));
        const currentCanvasWidth = canvasWidth || CANVAS.SHEET_WIDTH_IN;

        setItems((prev) => {
          const all = [...prev, ...chunk];

          /**
           * Ids the packer could not fit inside the sheet's length.
           *
           * These are dropped from the commit rather than clamped. Clamping
           * was the old behaviour and it is worse than refusing: it stacked
           * everything that would not fit against the bottom edge, on top of
           * each other, and told the customer nothing about which artwork was
           * now unusable.
           */
          const overflowed = new Set<number>();

          // Shelf-pack only when this chunk is landing on a genuinely empty
          // board; every later chunk flows into the gaps of what is already
          // there, which is what keeps a progressive batch packing as tightly
          // as the old all-at-once pass did.
          const packed =
            prev.length === 0 && chunk.length > 1
              ? arrangeInitialLayout(chunk, currentCanvasWidth, spacing, marginSize)
              : placeNewItems(
                  all,
                  chunkIds,
                  currentCanvasWidth,
                  spacing,
                  marginSize,
                  overflowed,
                );

          if (overflowed.size > 0) {
            overflowedInBatch += overflowed.size;
            // Deferred: this runs inside a state updater.
            setTimeout(reportOverflow, 0);
          }

          const byId = new Map(packed.map((u: any) => [u.id, u]));

          // Copies wrap vertically, so clamp on a worst-case group height —
          // an item can never be positioned past the bottom ruler.
          let didClamp = false;

          const next = all
            // Artwork that did not fit never joins the board. Keeping it would
            // mean an item with no valid position on a sheet that is full.
            .filter((it) => !overflowed.has(it.id))
            .map((it) => {
            if (!chunkIds.has(it.id)) return it;
            const u: any = byId.get(it.id);
            if (!u) {
              // No layout slot came back for this id. Land it where it was
              // dropped rather than leaving `isDropping` set — a stuck flag
              // disables the whole layout engine (see useArtboardEffects),
              // which is the freeze this rewrite exists to remove.
              return { ...it, isDropping: false, gravityActive: false };
            }

            const itemH = typeof u.heightIn === "number" ? u.heightIn : 0;
            const copies = typeof u.copies === "number" && u.copies > 0 ? u.copies : 1;
            const gap = CANVAS.GRID_GAP_IN;
            const groupHeightIn =
              copies <= 1 ? itemH : copies * itemH + (copies - 1) * gap;
            const maxPosY = Math.max(0, MAX_SHEET_HEIGHT_IN - groupHeightIn);
            if (u.posY > maxPosY + 1e-6) didClamp = true;

            return {
              ...it,
              posX: u.posX,
              posY: Math.max(0, Math.min(u.posY, maxPosY)),
              flowCols: u.flowCols,
              flowStartCol: u.flowStartCol,
              flowEndCol: u.flowEndCol,
              nestRotation: (u.nestRotation ?? 0) as 0 | 90,
              gravityActive: false,
              // Committed already positioned. The entrance tween below is a
              // `from`, so it decorates a correct layout instead of being
              // responsible for producing one.
              isDropping: false,
            };
          });

          if (didClamp && !warnedMaxHeightRef.current) {
            warnedMaxHeightRef.current = true;
            // Deferred: this runs inside a state updater, and React forbids
            // scheduling another component's update from within one.
            setTimeout(
              () => toast.error("Max sheet height of 1200 inches reached."),
              0,
            );
          }

          return next;
        });

        committedCount += chunk.length;

        /**
         * Entrance animation — opacity and scale only. Never position.
         *
         * The fly-in-from-the-drop-point effect has now caused the same class
         * of bug twice, and it is worth being explicit about why it cannot
         * work here. Any positional tween has to know where the item is
         * landing. Reading that from the DOM (`gsap.from`, which captures the
         * element's computed position as its destination) races React: this
         * runs immediately after `setItems`, so the node either does not exist
         * yet or still carries its previous position. GSAP then tweens to the
         * stale value and — because it writes inline `left`/`top` — that wrong
         * position wins over React's correct one permanently. Measured, that
         * produced items sitting fully on top of each other.
         *
         * Passing explicit `to` coordinates would fix the race but reintroduce
         * inline positional styles that fight the drag system and the layout
         * engine for the lifetime of the item.
         *
         * A fade-and-settle has none of that: React owns position exclusively,
         * the tween touches only compositor-friendly properties, and
         * `clearProps` removes even those when it finishes. The drop point is
         * not meaningful for a bulk add anyway — these files come from a file
         * picker, not a drag.
         */
        if (dropped.length <= MAX_ANIMATED_ITEMS) {
          const stagger = Math.min(
            0.06,
            STAGGER_WINDOW_S / Math.max(1, dropped.length),
          );
          requestAnimationFrame(() => {
            chunk.forEach((item, index) => {
              const element = document.querySelector(
                `[data-item-id="${item.id}"]`,
              ) as HTMLElement | null;
              if (!element) return;
              gsap.fromTo(
                element,
                { opacity: 0, scale: 0.94 },
                {
                  opacity: 1,
                  scale: 1,
                  duration: 0.35,
                  delay: index * stagger,
                  ease: "power2.out",
                  clearProps: "opacity,scale,transform",
                },
              );
            });
          });
        }
      };

      /** Buffers a finished item and flushes once a chunk's worth has built up. */
      const queueItem = (item: ArtboardItem) => {
        if (isCanceled(token)) return;
        pending.push(item);
        publishLoaded();
        if (pending.length >= COMMIT_CHUNK_SIZE) {
          flushPending();
        } else if (!flushTimer) {
          flushTimer = setTimeout(flushPending, COMMIT_MAX_WAIT_MS);
        }
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
          showUnsupportedFileWarning(validation.message!);
          return null;
        }

        const [dpiInfo, localInfo] = await Promise.all([
          readDPI(file),
          loadImageSize(file),
        ]);

        let assetResponse: any = null;
        try {
          assetResponse = await uploadAssetWithProgress(file, token, (pct) => {
            fileProgress[idx] = pct / 100;
            publishProgress();
          });
        } catch (err: any) {
          if (isCanceled(token) || err?.message === "Upload canceled") throw err;
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
          id: nextItemId(),
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
          const cropped = await autoCropImage(serverUrl, dpi);
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
      let cursor = 0;

      const worker = async () => {
        while (cursor < dropped.length) {
          if (isCanceled(token)) return;
          const idx = cursor++;
          const file = dropped[idx];
          // Only meaningful for a single file. With a pool running, six names
          // would race each other in the dialog several times a second, which
          // reads as a glitch; the count set before the pool started is both
          // stable and more useful.
          if (dropped.length === 1) setUploadFileName(file.name);
          try {
            const item = await buildItem(file, idx);
            // Committed as soon as it is ready rather than accumulated into a
            // results array — this is what puts artwork on the board while the
            // rest of the batch is still uploading.
            if (item) queueItem(item);
          } catch (err: any) {
            // Cancel unwinds every worker; anything else is this file's problem
            // alone and must not stop the rest of the drop.
            if (isCanceled(token) || err?.message === "Upload canceled") throw err;
            console.warn(`[UPLOAD] ${file.name} failed`, err);
            toast.error(
              err?.message || `“${file.name}” could not be read — please re-export it and try again.`,
              { duration: 6000 },
            );
            // Count the failed slot so the bar still reaches 100%.
            fileProgress[idx] = 1;
            publishProgress();
            // Counted as "resolved" for the overlay too. Without this a batch
            // containing a single bad file would sit at "119 / 120" forever
            // and the overlay would never dismiss.
            publishLoaded();
          }
        }
      };

      try {
        await Promise.all(
          Array.from({ length: Math.min(UPLOAD_CONCURRENCY, dropped.length) }, worker),
        );
      } finally {
        // Runs on every exit path — success, cancel, or a throw that escapes
        // the pool. A batch that dies partway must still release its requests
        // and commit whatever it finished, or the next upload inherits a
        // wedged overlay.
        flushPending();
        releaseBatch(token);

        /**
         * Only the newest batch owns the shared UI.
         *
         * Two drops can overlap — the customer adds more files while the first
         * lot is still uploading, which is ordinary behaviour. Tearing the
         * overlay down unconditionally here meant the *first* batch to finish
         * blanked the progress of one still running: the counter vanished and
         * the customer was left with no indication that work was in flight.
         *
         * The per-batch work above is already independent; this is the one
         * genuinely shared resource, so last-write-wins is resolved explicitly
         * rather than by whichever promise happened to settle first.
         */
        if (batchTokenRef.current === token) {
          setIsUploading(false);
          setUploadProgress(0);
          setUploadFileName(null);
          setBatchTotal(0);
          setBatchLoaded(0);
        }
      }

      if (isCanceled(token)) return;

      // Nothing survived validation or upload; the per-file toasts have already
      // explained why.
      if (committedCount === 0) return;

      // Kept purely so a very fast drop does not flash the overlay on and off.
      const MIN_DIALOG_VISIBLE_MS = 260;
      const elapsed = Date.now() - uploadUiStart;
      if (elapsed < MIN_DIALOG_VISIBLE_MS) await sleep(MIN_DIALOG_VISIBLE_MS - elapsed);
    } else {
      let asset: any = null;
      try {
        asset = JSON.parse(droppedUrl);
      } catch {
      }

      const url = asset?.trimmedUrl || asset?.url || droppedUrl;
      const dpi = asset?.dpi;
      const item = await createItemFromUrl(
        url,
        asset?.originalFilename,
        dpi,
        asset?.url,
      );

      // Single item from a URL or a saved design. Packed against `prev` in the
      // same updater that adds it, for the same reason the file path is: the
      // closure's `items` is a snapshot from before the decode and fade check.
      const currentCanvasWidth = canvasWidth || CANVAS.SHEET_WIDTH_IN;
      setItems((prev) => {
        const all = [...prev, item];
        const packed = placeNewItems(
          all,
          new Set([item.id]),
          currentCanvasWidth,
          spacing,
          marginSize,
        );
        const u: any = packed.find((p: any) => p.id === item.id);
        return all.map((it) =>
          it.id === item.id
            ? {
                ...it,
                ...(u
                  ? {
                      posX: u.posX,
                      posY: Math.max(0, Math.min(u.posY, 1200)),
                      flowCols: u.flowCols,
                      flowStartCol: u.flowStartCol,
                      flowEndCol: u.flowEndCol,
                      nestRotation: (u.nestRotation ?? 0) as 0 | 90,
                    }
                  : {}),
                gravityActive: false,
                isDropping: false,
              }
            : it,
        );
      });
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


    // Published from the allocator, not recomputed from a stale `counter` plus
    // a file count — the allocator is the only thing that knows what was
    // actually issued once batches can overlap.
    setCounter(idCursorRef.current);
    setSelectedId(null);
  };

  const filterFiles = (files: File[]) => {
    const accepted = files.filter((f) =>
      (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(f.type),
    );
    const other = files.length - accepted.length;
    // The count and the format list both come from this one call, so the
    // advice can never name a format the filter above would reject.
    if (other > 0) showUnsupportedFilesWarning(other, ACCEPTED_IMAGE_TYPES);
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
    batchLoaded,
    batchTotal,
    cancelUploads,
    dropFilesAtCenter,
    onDragOver,
    onDragLeave,
    onDropEvent,
  };
};
