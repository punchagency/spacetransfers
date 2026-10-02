import { useCallback, useEffect, useRef, useState } from "react";
import type { ArtboardItem } from "../../types";
import type { AiEditOptions, AiEditProgress, AiEditResult, AiIntentId, PlanStep } from "../ai";
import { AiEditAbortedError, INTENT_VERBS, classifyPrompt, runAiEdit } from "../ai";
import type { CommitHistory } from "./useHistory";
import { afterPixelEdit, captureImageSnapshot, restoreImageSnapshot } from "../utils/imageState";

const MAX_STEPS = 4;

export interface AiEditStatus {
  progress: AiEditProgress;
  /** Which step of a multi-step plan is running, 1-based. */
  stepIndex?: number;
  stepCount?: number;
  /** That step's own label, e.g. "Making it pink". */
  stepLabel?: string;
}

/**
 * A finished edit held back from the artboard, awaiting the user's decision.
 *
 * Previewing rather than applying is the difference between an editor and a
 * slot machine. A generative edit is non-deterministic and occasionally wrong
 * in ways only a human can judge, and while undo *can* reverse it, discovering
 * that requires the bad result to already be sitting on the print sheet. So
 * every run stages here and the customer compares before committing.
 */
export interface AiPreview {
  itemId: number;
  /** The item's image as it was before the run, for the comparison slider. */
  beforeUrl: string;
  afterUrl: string;
  /** The prompt as the user typed it, not the per-step rewrites. */
  prompt: string;
  intent: AiIntentId;
  /** Steps that actually ran, in order — shown so a multi-step run is legible. */
  steps: PlanStep[];
  /** Everything needed to apply this to the item, unchanged from the provider. */
  result: AiEditResult;
  /**
   * How the edit was asked for beyond its text — a chip's forced intent, a
   * swatch's colour and tolerance — so Try again repeats the same request. It
   * re-sent the prompt text alone, so a Wide swatch pick came back at Normal.
   */
  request: Pick<AiGenerateRequest, "intentOverride" | "options">;
}

export interface AiEditOutcome {
  ok: boolean;
  /** True when the user cancelled — callers should stay silent about it. */
  canceled?: boolean;
  error?: string;
  /** Id of the provider that served the run, for attribution in the UI. */
  provider?: string;
  /** Intent the run actually resolved to, so callers report on what happened
   *  rather than re-deriving it from the prompt and risking disagreement. */
  intent?: AiIntentId;
  /** Pixel size of the last edited result — lets the UI quote a concrete
   *  outcome ("now 3000 × 2400") instead of a bare acknowledgement. */
  widthPx?: number;
  heightPx?: number;
  /** How many steps ran, so the reply can say "both changes are in". */
  stepCount?: number;
  /**
   * True when the result is staged for review rather than already on the sheet.
   * The reply wording differs — "have a look" vs "done" — and getting that wrong
   * makes the customer think an edit failed when it is sitting in the preview.
   */
  awaitingReview?: boolean;
  /** Set when a model rendered below print resolution and was scaled back up. */
  upsampled?: boolean;
  /** Steps left out because the plan was longer than one run allows. */
  droppedSteps?: number;
}

/** What a caller can ask `generate` to do beyond the bare prompt. */
export interface AiGenerateRequest {
  /**
   * Pre-resolved plan from the understanding layer. When absent, the prompt is
   * classified locally and run as one step — which is what a quick-action chip
   * wants, since its intent is already known and unambiguous.
   */
  steps?: PlanStep[];
  /** Forces a specific intent, bypassing classification (chip presses). */
  intentOverride?: AiIntentId;
  /** Structured parameters, e.g. the eyedropper's picked colour. */
  options?: AiEditOptions;
}

/**
 * Applies an AI result onto an artboard item while preserving everything the
 * artboard cares about: physical print size, position, rotation and DPI truth.
 *
 * Two distinct cases, and conflating them is what makes artwork visibly jump:
 *
 *  - `reframed` (cutouts, trims, sticker borders): the subject's bounding box
 *    changed, so the print box is rescaled by the trim ratio and re-centred —
 *    the *subject* keeps its exact physical size and stays where it was.
 *  - otherwise (upscale, recolour, restyle): pixels changed but the frame did
 *    not, so geometry is untouched and only the resolution metadata moves.
 */
const applyResultToItem = (item: ArtboardItem, result: AiEditResult, prompt: string): ArtboardItem => {
  // At 90°/270° the item's widthIn/heightIn are swapped relative to the image's
  // own axes (see rotateSelected), so trim ratios must be applied to the axis
  // that actually carries the image's width.
  const rotationOdd = ((Math.round((item.rotation ?? 0) / 90) % 2) + 2) % 2 === 1;

  const aiHistory = [
    ...(item.aiHistory ?? []),
    // The whole image state, not just the URL, so reverting restores the size
    // and pixel counts that went with it.
    { prompt, url: item.url, at: Date.now(), snapshot: captureImageSnapshot(item) },
  ].slice(-10);

  const base: ArtboardItem = {
    ...item,
    // Shown, shipped to print (checkout sends croppedUrl — without it an AI
    // edit would only change the preview), and the new uncropped source for the
    // auto-crop switch.
    ...afterPixelEdit(result.url, result.widthPx, result.heightPx),
    // Keep originalUrl pointing at the pre-edit remote asset so the checkout
    // assetId still resolves to a real DB record rather than a data URL.
    originalUrl: item.originalUrl || item.url,
    aiHistory,
  };

  if (!result.reframed) {
    const widthAxisIn = rotationOdd ? item.heightIn : item.widthIn;
    return {
      ...base,
      dpi: widthAxisIn > 0 ? Math.round(result.widthPx / widthAxisIn) : item.dpi,
    };
  }

  const originalWidthPx = result.originalWidthPx ?? result.widthPx;
  const originalHeightPx = result.originalHeightPx ?? result.heightPx;
  const scaleW = originalWidthPx > 0 ? result.widthPx / originalWidthPx : 1;
  const scaleH = originalHeightPx > 0 ? result.heightPx / originalHeightPx : 1;

  const newWidthIn = item.widthIn * (rotationOdd ? scaleH : scaleW);
  const newHeightIn = item.heightIn * (rotationOdd ? scaleW : scaleH);

  return {
    ...base,
    widthIn: newWidthIn,
    heightIn: newHeightIn,
    posX: item.posX + (item.widthIn - newWidthIn) / 2,
    posY: item.posY + (item.heightIn - newHeightIn) / 2,
    originalWidthIn: item.widthIn,
    originalHeightIn: item.heightIn,
    autoCrop: true,
  };
};

/**
 * Drives AI editing of one image — the one the AI panel is open on. Holds no
 * UI concerns; the panel renders whatever this exposes.
 */
export const useAiEdit = (
  items: ArtboardItem[],
  setItems: React.Dispatch<React.SetStateAction<ArtboardItem[]>>,
  targetId: number | null,
  commitHistory?: CommitHistory,
  onActionPerformed?: (action: { type: string; id?: number; payload?: any }) => void,
) => {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<AiEditStatus | null>(null);
  const [preview, setPreview] = useState<AiPreview | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Read through a ref so applyPreview keeps a stable identity — it is passed
  // to a portalled dialog, and re-identifying it on every staged edit would
  // remount that dialog mid-comparison.
  const previewRef = useRef<AiPreview | null>(null);
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);
  // Read the target/items through a ref so `generate` keeps a stable identity
  // and an in-flight run always resolves against the latest state.
  const itemsRef = useRef(items);
  const targetIdRef = useRef(targetId);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    targetIdRef.current = targetId;
  }, [targetId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
    setStatus(null);
  }, []);

  /**
   * Runs one item through every step of a plan, in order.
   *
   * Each step edits the *output* of the one before it, which is what makes
   * "make the rabbit pink, then add a birthday hat" work — the hat is added to
   * the pink rabbit, not to the original artwork.
   *
   * The composite result reports the last step's pixels but the *first* step's
   * original dimensions, because the caller uses that pair to compute a trim
   * ratio. Reporting the final step's own "original" would measure the last
   * step against the second-to-last, and a chain of cutouts would shrink the
   * item's print box once per step instead of once overall.
   */
  const runPlanForItem = useCallback(
    async (
      item: ArtboardItem,
      steps: PlanStep[],
      options: AiEditOptions | undefined,
      signal: AbortSignal,
      onStepProgress: (stepIndex: number, step: PlanStep, progress: AiEditProgress) => void,
    ): Promise<AiEditResult> => {
      let currentUrl = item.croppedUrl || item.url;
      let composite: AiEditResult | null = null;
      let firstOriginalWidth: number | undefined;
      let firstOriginalHeight: number | undefined;
      let anyReframed = false;
      let anyUpsampled = false;

      for (let s = 0; s < steps.length; s++) {
        if (signal.aborted) throw new AiEditAbortedError();
        const step = steps[s];

        const result = await runAiEdit({
          imageUrl: currentUrl,
          prompt: step.prompt,
          intent: step.intent,
          options,
          signal,
          onProgress: (progress) => onStepProgress(s, step, progress),
        });

        if (s === 0) {
          firstOriginalWidth = result.originalWidthPx;
          firstOriginalHeight = result.originalHeightPx;
        }
        anyReframed = anyReframed || Boolean(result.reframed);
        anyUpsampled = anyUpsampled || Boolean(result.upsampled);
        currentUrl = result.url;
        composite = result;
      }

      if (!composite) throw new Error("Nothing to do.");
      return {
        ...composite,
        reframed: anyReframed,
        originalWidthPx: firstOriginalWidth ?? composite.originalWidthPx,
        originalHeightPx: firstOriginalHeight ?? composite.originalHeightPx,
        upsampled: anyUpsampled,
      };
    },
    [],
  );

  const generate = useCallback(
    async (
      prompt: string,
      request: AiGenerateRequest | AiIntentId = {},
    ): Promise<AiEditOutcome> => {
      const trimmed = prompt.trim();
      if (!trimmed) return { ok: false, error: "Enter a prompt first." };

      // Historically the second argument was a bare intent id. Accepting both
      // keeps existing call sites (and any host embedding this hook) working
      // rather than forcing a coordinated change for no behavioural gain.
      const req: AiGenerateRequest =
        typeof request === "string" ? { intentOverride: request } : request;

      const item = itemsRef.current.find((it) => it.id === targetIdRef.current);
      if (!item) {
        return { ok: false, error: "Select an image on the artboard first." };
      }
      // A lock holds against AI edits as it does against every other tool.
      if (item.locked) {
        return { ok: false, error: "This image is locked. Unlock it to make changes." };
      }

      const intent = req.intentOverride ?? classifyPrompt(trimmed);

      // A plan from the understanding layer wins; otherwise this is one step.
      const requested = req.steps?.length
        ? req.steps
        : [{ intent, prompt: trimmed, label: INTENT_VERBS[intent] }];
      const steps = requested.slice(0, MAX_STEPS);
      const droppedSteps = requested.length - steps.length;

      const controller = new AbortController();
      abortRef.current = controller;

      setIsRunning(true);
      setPreview(null);
      setStatus({
        stepIndex: 1,
        stepCount: steps.length,
        stepLabel: steps[0].label,
        progress: { phase: `${steps[0].label}…`, pct: 0 },
      });

      try {
        const result = await runPlanForItem(
          item,
          steps,
          req.options,
          controller.signal,
          (stepIndex, step, progress) =>
            setStatus({
              stepIndex: stepIndex + 1,
              stepCount: steps.length,
              stepLabel: step.label,
              // Each step reports 0–100 of its own work; scaled into its slice
              // of the whole so one bar advances monotonically across a chain
              // rather than snapping back to zero on every step.
              progress: {
                phase: steps.length > 1 ? `${step.label}…` : progress.phase,
                pct: Math.round(((stepIndex + progress.pct / 100) / steps.length) * 100),
              },
            }),
        );

        if (controller.signal.aborted) throw new AiEditAbortedError();

        // Held back deliberately: nothing is written to the artboard and no
        // history entry is committed until the customer accepts it.
        setPreview({
          itemId: item.id,
          beforeUrl: item.croppedUrl || item.url,
          afterUrl: result.url,
          prompt: trimmed,
          intent,
          steps,
          result,
          request: { intentOverride: req.intentOverride, options: req.options },
        });
        return {
          ok: true,
          provider: result.provider,
          intent,
          widthPx: result.widthPx,
          heightPx: result.heightPx,
          stepCount: steps.length,
          awaitingReview: true,
          upsampled: Boolean(result.upsampled),
          // Surfaced rather than swallowed: a customer who asked for five things
          // and got four needs to know which one to ask for again.
          ...(droppedSteps > 0 ? { droppedSteps } : {}),
        };
      } catch (err: any) {
        // A cancel is a deliberate no-op, not a failure worth surfacing.
        if (err instanceof AiEditAbortedError || err?.name === "AbortError") {
          return { ok: false, canceled: true };
        }
        return { ok: false, error: err?.message || "The AI edit failed. Please try again." };
      } finally {
        abortRef.current = null;
        setIsRunning(false);
        setStatus(null);
      }
    },
    [runPlanForItem],
  );

  /** Commits a previewed edit onto its item, as one undoable step. */
  const applyPreview = useCallback(() => {
    const staged = previewRef.current;
    if (!staged) return;

    commitHistory?.();
    setItems((prev) =>
      prev.map((it) =>
        it.id === staged.itemId ? applyResultToItem(it, staged.result, staged.prompt) : it,
      ),
    );
    onActionPerformed?.({
      type: "aiEdit",
      id: staged.itemId,
      payload: {
        prompt: staged.prompt,
        intent: staged.intent,
        provider: staged.result.provider,
        steps: staged.steps.length,
      },
    });
    setPreview(null);
  }, [commitHistory, onActionPerformed, setItems]);

  /** Throws away a previewed edit. The item was never touched, so this is state-only. */
  const discardPreview = useCallback(() => setPreview(null), []);

  /**
   * Restores an item to an earlier point in its AI edit history.
   *
   * Distinct from undo, and both are worth having. Undo walks the whole board
   * backwards one action at a time, so reaching an edit from six operations ago
   * also reverses the five unrelated changes made since. This targets one
   * image's own chain, which is how someone actually thinks about it: "go back
   * to before I made it pink", with the rest of the sheet left alone.
   *
   * Committed to the undo stack, so the revert is itself reversible.
   */
  const revertToHistoryEntry = useCallback(
    (itemId: number, entryIndex: number) => {
      const item = itemsRef.current.find((it) => it.id === itemId);
      const entry = item?.aiHistory?.[entryIndex];
      if (!item || !entry) return;

      commitHistory?.();
      setItems((prev) =>
        prev.map((it) =>
          it.id === itemId
            ? {
                // Entries recorded before snapshots existed carry only a URL.
                ...(entry.snapshot
                  ? restoreImageSnapshot(it, entry.snapshot)
                  : {
                      ...it,
                      url: entry.url,
                      croppedUrl: entry.url,
                      uncroppedUrl: entry.url,
                      // Unknown for that image; measured again when needed.
                      croppedWidthPx: undefined,
                      croppedHeightPx: undefined,
                      nativeWidthPx: undefined,
                      uncroppedWidthPx: undefined,
                      uncroppedHeightPx: undefined,
                    }),
                aiHistory: (it.aiHistory ?? []).slice(0, entryIndex),
              }
            : it,
        ),
      );
    },
    [commitHistory, setItems],
  );

  return {
    isRunning,
    status,
    generate,
    cancel,
    preview,
    applyPreview,
    discardPreview,
    revertToHistoryEntry,
  };
};
