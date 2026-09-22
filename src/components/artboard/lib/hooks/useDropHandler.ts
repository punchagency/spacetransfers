import { getToken } from "../../../../lib/utils/auth";
import { useRef, useState } from "react";
import { readDPI, loadImageSize, validateImageFile, checkFade } from "../utils";
import { placeNewItems, arrangeInitialLayout, isSheetFull } from "../utils";
import { autoCropImage } from "../utils/autoCrop";
import { convertUpload, UploadConvertError } from "../utils/uploadConvert";
import { isAcceptedUpload } from "../utils/fileValidation";
import { ArtboardItem } from "../../types";
import { gsap } from "gsap";
import {
  ACCEPTED_IMAGE_TYPES,
  CANVAS,
  MAX_SHEET_HEIGHT_IN,
} from "../../../../config/artboard.config";
import toast from "react-hot-toast";
import { getSheetWidthIn } from "../../../../lib/utils/pricingRates";
import {
  showUnsupportedFilesWarning,
  showUnsupportedFileWarning,
} from "../../../common/UnsupportedFilesWarning";
import { showLowDpiWarning } from "../../../common/DpiStatus";
import { showUploadQueuedNotice } from "../../../common/UploadQueueNotice";
import { createSerialQueue } from "../utils/serialQueue";
import type { SerialQueue } from "../utils/serialQueue";
import type { CommitHistory } from "./useHistory";

/**
 * An upload is given up on when it stops moving, not when it takes long.
 *
 * It had a 90-second ceiling on the whole request, which is backwards for print
 * files: a large one on a slow connection legitimately takes minutes (a 4 MB
 * photo from far away took over a minute), while a connection that has died
 * was waited on for the full 90 seconds. So:
 *  - while sending, 30 seconds with no progress at all means it has stalled;
 *  - once every byte is sent, the server has 2 minutes to answer (it stores
 *    the file, trims it and checks it before replying).
 */
const UPLOAD_STALL_MS = 30_000;
const UPLOAD_RESPONSE_MS = 120_000;

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

/**
 * One drop's worth of work — everything `runDrop` needs, captured at the moment
 * the customer let go.
 *
 * Held as a value rather than run immediately so a drop arriving mid-batch can
 * wait its turn without losing the position it was dropped at.
 */
interface PendingDrop {
  droppedFiles: File[];
  droppedUrl: string;
  dropX: number;
  dropY: number;
}

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
  commitHistory?: CommitHistory,
  /** Whether new uploads are cropped to their artwork — the sidebar's "Auto Crop Uploads". */
  autoCropUploads: boolean = true,
) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);

  /** Images placed so far in the active batch, and its size. Drives the overlay. */
  const [batchLoaded, setBatchLoaded] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);

  /** Files waiting behind the active batch. Drives the overlay's queued line. */
  const [queuedCount, setQueuedCount] = useState(0);

  /**
   * The live board, for the two capacity checks that read it directly.
   *
   * `items` comes from the render closure, which is correct for a drop handled
   * immediately but not for one taken off the queue: that batch runs after the
   * previous one has committed, so the closure it was captured in is by then
   * several hundred items out of date. Everything else in here already goes
   * through a functional `setItems`; these two checks are the exception, and a
   * ref is what keeps them honest across a deferred start.
   */
  const itemsRef = useRef(items);
  itemsRef.current = items;

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
   * One batch at a time, with the rest held in order behind it.
   *
   * Batches were made independent (see the token scheme above) so that a second
   * drop could no longer corrupt the first's bookkeeping — but independent is
   * not the same as free. Two live batches still competed for the same six
   * upload slots, the same decode budget, and the same packer running over an
   * ever-growing board, and the progress overlay reports one batch's counts, so
   * with two in flight it showed neither. On a pair of 100-file drops that is
   * the board going unresponsive for the length of both.
   *
   * A drop arriving mid-batch is therefore queued rather than started. The
   * ordering and no-overlap rules live in `createSerialQueue`, where they are
   * testable without a network or a React tree.
   *
   * `runDrop` is reached through a ref because the queue is created once while
   * `runDrop` is rebuilt every render: a queued batch must run against the
   * board and settings as they are when it *starts*, not as they were when it
   * was dropped.
   */
  const runDropRef = useRef<(job: PendingDrop) => Promise<void>>(async () => {});

  const dropQueueRef = useRef<SerialQueue<PendingDrop> | null>(null);
  if (!dropQueueRef.current) {
    dropQueueRef.current = createSerialQueue<PendingDrop>(
      (job) => runDropRef.current(job),
      {
        onChange: ({ pending }) =>
          setQueuedCount(pending.reduce((sum, d) => sum + d.droppedFiles.length, 0)),
        onError: (error) => console.error("[upload] batch failed", error),
      },
    );
  }
  const dropQueue = dropQueueRef.current;

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
    // Anything still queued is cancelled too. The overlay's Cancel button
    // reports on everything the customer can see waiting, so leaving the queue
    // to start up on its own the moment the active batch aborted would be the
    // upload they just cancelled reappearing by itself.
    dropQueue.clear();
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
    // XHR, not `apiFetch`, because this one reports upload progress — but the
    // token still comes from one place.
    const authToken = getToken();

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
       * Without this an upload could wait forever: `xhr.onerror` only fires on
       * a transport failure, and a server that accepts the body and never
       * answers fires nothing at all — the dialog sat at its last percentage.
       */
      let giveUpReason: string | null = null;
      let watchdog: ReturnType<typeof setTimeout> | null = null;
      const watch = (ms: number, reason: string) => {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          giveUpReason = reason;
          xhr.abort();
        }, ms);
      };
      const stopWatching = () => {
        if (watchdog) clearTimeout(watchdog);
        watchdog = null;
      };
      const stalled = `“${file.name}” stopped uploading. Check your connection and try again.`;
      const slowServer = `“${file.name}” uploaded, but we didn't hear back in time. Please try again in a moment.`;
      watch(UPLOAD_STALL_MS, stalled);

      xhr.upload.onprogress = (evt) => {
        watch(UPLOAD_STALL_MS, stalled);
        if (evt.lengthComputable) {
          onProgress(Math.max(0, Math.min(100, (evt.loaded / evt.total) * 100)));
        }
      };
      // Every byte sent: from here the wait is on the server, not the connection.
      xhr.upload.onload = () => watch(UPLOAD_RESPONSE_MS, slowServer);

      xhr.onload = () => {
        stopWatching();
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
        stopWatching();
        release();
        reject(new Error(`“${file.name}” couldn't be uploaded. Check your connection and try again.`));
      };

      xhr.onabort = () => {
        stopWatching();
        release();
        reject(new Error(giveUpReason ?? "Upload canceled"));
      };

      const formData = new FormData();
      formData.append("file", file);
      xhr.send(formData);
    });
  };

  /**
   * Turns every file in a drop into the PNG or JPEG the upload path takes.
   *
   * Runs before anything is counted, so capacity, the progress bar and the
   * "N files" label all see what actually lands on the board — a PDF's pages,
   * a PSD's flattened image. A file that cannot be converted is reported by
   * name and left out; the rest of the drop carries on.
   */
  const convertUploads = async (files: File[]): Promise<File[]> => {
    const out: File[] = [];
    for (const file of files) {
      let toastId: string | undefined;
      try {
        const result = await convertUpload(file, {
          onConverting: () => {
            toastId = toast.loading(`Converting “${file.name}”…`);
          },
          onProgress: (done, total) => {
            if (total > 1 && toastId) {
              toast.loading(`Converting “${file.name}” — page ${done} of ${total}`, { id: toastId });
            }
          },
        });
        if (toastId) toast.dismiss(toastId);
        out.push(...result.files);
        for (const notice of result.notices) toast(notice, { duration: 8000, icon: "ℹ️" });
      } catch (err) {
        if (toastId) toast.dismiss(toastId);
        if (err instanceof UploadConvertError) {
          showUnsupportedFileWarning(err.message);
        } else {
          console.warn(`[UPLOAD] ${file.name} — conversion failed`, err);
          toast.error(`“${file.name}” could not be converted. Please re-export it and try again.`, { duration: 6000 });
        }
      }
    }
    return out;
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
    // Reassigned as PDFs expand into their pages, and when the drop exceeds the
    // remaining item capacity.
    let dropped = droppedFiles;
    if (dropped.length === 0 && !droppedUrl) return;

    // Length, not count: a sheet is full when its artwork reaches the 1200in
    // maximum, however many images that took.
    if (isSheetFull(itemsRef.current as any)) {
      toast.error(
        `Sheet is full — the maximum length of ${MAX_SHEET_HEIGHT_IN.toLocaleString()}in has been reached. Remove artwork to add more.`,
      );
      return;
    }

    // After the sheet-full check, so a full sheet does not pay for conversions
    // whose results would all be refused.
    if (dropped.length > 0) {
      dropped = await convertUploads(dropped);
      if (dropped.length === 0 && !droppedUrl) return;
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
        autoCrop: autoCropUploads,
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
        uncroppedUrl: url,
        uncroppedWidthPx: loaded.widthPx,
        uncroppedHeightPx: loaded.heightPx,
      };

      const cropped = autoCropUploads ? await autoCropImage(url, dpi) : null;
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
      const capacity = Math.max(0, CANVAS.MAX_ITEMS - itemsRef.current.length);
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
        const currentCanvasWidth = canvasWidth || getSheetWidthIn();

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
            const maxPosY = Math.max(marginSize, MAX_SHEET_HEIGHT_IN - groupHeightIn);
            if (u.posY > maxPosY + 1e-6) didClamp = true;

            return {
              ...it,
              posX: u.posX,
              posY: Math.max(marginSize, Math.min(u.posY, maxPosY)),
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

        const rawDpi = Math.max(1, Math.round(assetResponse?.dpi || dpiInfo.dpiX || dpiInfo.dpiY || 300));
        // Mirror server normalization: values < 150 (e.g. 72 dpi JFIF defaults) are treated as unknown
        const dpi = rawDpi < 150 ? 300 : rawDpi;
        if (dpi < 300) lowDpiImages++;

        const serverUrl = assetResponse?.url || localInfo.url;
        // With auto crop off for uploads, the server's trimmed copy goes unused.
        const trimmedUrl = autoCropUploads ? assetResponse?.trimmedUrl || null : null;
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
          autoCrop: autoCropUploads,
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
          uncroppedUrl: serverUrl,
          uncroppedWidthPx: widthPx,
          uncroppedHeightPx: heightPx,
        };

        if (autoCropUploads && !trimmedUrl) {
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

        /**
         * The upload already ran the transparency check on the buffer it held,
         * so its verdict is remembered for this URL — no second analysis, and no
         * request. Not awaited: the flag is drawn by the artboard from the
         * image's URL (`useTransparencyVerdicts`), which also checks any image
         * the server never saw, so the item need not wait for it.
         *
         * Only for the URL the server actually analysed; a canvas auto-crop
         * produces a different image, which is checked in its own right.
         */
        if (baseItem.url === (trimmedUrl || serverUrl) && assetResponse?.fade) {
          void checkFade(baseItem.url, assetResponse.fade);
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
      const currentCanvasWidth = canvasWidth || getSheetWidthIn();
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
                      posY: Math.max(marginSize, Math.min(u.posY, 1200)),
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

    // Same queue, same card and same 7s life as the resized-to-fit notice (raised
    // by the layout once the drop settles), so a drop that trips both shows two
    // stacked notices rather than one merged sentence.
    if (lowDpiImages > 0) {
      showLowDpiWarning(lowDpiImages);
    }


    // Published from the allocator, not recomputed from a stale `counter` plus
    // a file count — the allocator is the only thing that knows what was
    // actually issued once batches can overlap.
    setCounter(idCursorRef.current);
    setSelectedId(null);
  };

  const filterFiles = (files: File[]) => {
    // By type or extension — see `isAcceptedUpload`. The contents decide the
    // rest, including refusing a file whose name was the only thing right.
    const accepted = files.filter(isAcceptedUpload);
    const other = files.length - accepted.length;
    // The count and the format list both come from this one call, so the
    // advice can never name a format the filter above would reject.
    if (other > 0) showUnsupportedFilesWarning(other, ACCEPTED_IMAGE_TYPES);
    return accepted;
  };

  // Published each render so the queue always invokes the current closure.
  runDropRef.current = runDrop;

  /**
   * The single entry point for every drop, from either the drag surface or the
   * file picker.
   *
   * Deferral is deliberately not a rejection: the files are kept, in the order
   * they arrived, and start the moment the board is free. The notice says so,
   * and repeats collapse into one card with a running total, so a customer who
   * drops four folders in a row gets one accurate message rather than four.
   */
  const submitDrop = (request: PendingDrop) => {
    const startedNow = dropQueue.submit(request);
    if (startedNow) return;

    const queued = dropQueue
      .pending()
      .reduce((sum, d) => sum + d.droppedFiles.length, 0);
    showUploadQueuedNotice(queued, batchTotal || request.droppedFiles.length);
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

    submitDrop({ droppedFiles, droppedUrl, dropX, dropY });
  };

  const dropFilesAtCenter = async (files: FileList | File[]) => {
    const arr = Array.isArray(files) ? files : Array.from(files);
    const droppedFiles = filterFiles(arr);
    if (droppedFiles.length === 0) return;

    const currentCanvasWidth = canvasWidth || getSheetWidthIn();
    const dropX = currentCanvasWidth / 2;
    const dropY = 6;
    submitDrop({ droppedFiles, droppedUrl: "", dropX, dropY });
  };

  return {
    isDragging,
    isUploading,
    uploadProgress,
    uploadFileName,
    batchLoaded,
    batchTotal,
    queuedCount,
    cancelUploads,
    dropFilesAtCenter,
    onDragOver,
    onDragLeave,
    onDropEvent,
  };
};
