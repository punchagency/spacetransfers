/**
 * Provider-agnostic contract for AI image editing.
 *
 * The UI (AiImagePanel) and the orchestration hook (useAiEdit) only ever speak in
 * terms of these types — they never import a provider directly. Swapping in
 * OpenAI / Gemini / Stability / Replicate is therefore a matter of writing one
 * `AiEditProvider` and registering it, with zero UI changes.
 */

/**
 * Canonical operations the bar can dispatch. `custom` = free-form prompt.
 *
 * Adding a tool to the suite starts here and the type checker walks you through
 * the rest: the verb table, the completion copy and the tuning map are all
 * exhaustive `Record<AiIntentId, …>`s, so a new id cannot be half-wired.
 */
export type AiIntentId =
  // Cutout / colour — served locally and deterministically wherever possible.
  | "remove-bg"
  | "remove-color"
  | "make-transparent"
  | "to-sticker"
  | "isolate-subject"
  // Resolution.
  | "upscale"
  | "enhance"
  // Generative editing.
  | "replace-bg"
  | "change-color"
  | "remove-object"
  | "replace-object"
  | "add-object"
  | "add-shadow"
  | "relight"
  | "outpaint"
  | "generative-fill"
  | "style-transfer"
  | "sketch-to-photo"
  | "cartoon"
  | "custom";

export interface AiEditProgress {
  /** Human-readable stage, surfaced verbatim in the progress bar. */
  phase: string;
  /** 0–100. Providers that can't report real progress should ramp this. */
  pct: number;
}

/**
 * Structured parameters that a prompt cannot express precisely.
 *
 * "Remove this colour" is the motivating case: the user picks a swatch out of
 * the artwork with the eyedropper, and the exact RGB they clicked is the whole
 * instruction. Round-tripping that through English ("remove the light blue")
 * would throw away the precision that makes the operation one click.
 */
export interface AiEditOptions {
  /** Hex colour the user picked, e.g. "#3b82f6". */
  targetColor?: string;
  /**
   * What to put in its place. `null` (the default) means transparency — the
   * distinction matters, since "" would read as a colour and transparency is
   * the common case for print artwork.
   */
  replacementColor?: string | null;
  /** 0–100. How far from `targetColor` still counts as that colour. */
  tolerance?: number;
}

export interface AiEditRequest {
  /** Source image — a remote URL or a data URL. */
  imageUrl: string;
  /** Raw text the user typed (or the chip's canonical prompt). */
  prompt: string;
  intent: AiIntentId;
  /** Structured parameters for intents that need more than prose. */
  options?: AiEditOptions;
  /**
   * Fixes the model's sampling so the same prompt reproduces the same image.
   * Omit for a fresh sample (the normal path); pass the seed echoed by a
   * previous result to re-run one edit while varying only the wording.
   * Ignored by providers whose model exposes no seed control.
   */
  seed?: number;
  /** Aborts in-flight work when the user cancels. */
  signal?: AbortSignal;
  onProgress?: (progress: AiEditProgress) => void;
}

export interface AiEditResult {
  /** Edited image — data URL or remote URL. */
  url: string;
  widthPx: number;
  heightPx: number;
  /** Pixel size of the input, when the provider measured it. */
  originalWidthPx?: number;
  originalHeightPx?: number;
  /**
   * True when the edit changed the subject's bounding box (a trim/cutout), so
   * the caller must rescale the item's print box by the trim ratio and re-centre
   * it. False for pure pixel edits (upscale, recolour, stylize) where the
   * physical placement must stay byte-identical and only DPI changes.
   */
  reframed?: boolean;
  /** Id of the provider that produced this result — shown in the result toast. */
  provider: string;
  /** Seed the model actually used, when it exposes one. Feed back in to reproduce. */
  seed?: number;
  /** Model that produced this result, for tracing a bad output to its source. */
  model?: string;
  /**
   * The model rendered below the source's resolution and the server scaled it
   * back up to keep the print box and DPI intact. The pixel count is therefore
   * honest but the detail is not, so the UI says so and points at Enhance —
   * a soft file that *reports* 300 DPI is the one failure mode a customer
   * cannot see until it is printed on a garment.
   */
  upsampled?: boolean;
}

export interface AiEditProvider {
  /** Stable machine id, e.g. "local" | "server" | "openai". */
  id: string;
  /** Shown in UI when attributing a result. */
  label: string;
  /** Lower runs first when several providers can serve the same intent. */
  priority: number;
  /** Whether this provider can execute the given intent at all. */
  supports(intent: AiIntentId): boolean;
  /**
   * Cheap readiness probe (API key present, model reachable, …). A provider that
   * returns false is skipped without being counted as a failure.
   */
  isAvailable(): boolean | Promise<boolean>;
  edit(request: AiEditRequest): Promise<AiEditResult>;
}

/**
 * Thrown when no registered provider can serve an intent.
 *
 * The message is what the customer reads in the chat thread, so it avoids
 * asserting a cause it cannot know — an unreachable API and an unconfigured one
 * are indistinguishable from here, and "ask an administrator" is wrong (and
 * unactionable) when the model is fine and the network merely blipped.
 *
 * It also names the way forward: board commands run locally with no model at
 * all, so sizing, copies, placement and sheet settings still work.
 */
export class NoProviderError extends Error {
  /** Kept for logging and for callers that want to retry a specific intent. */
  readonly intent: AiIntentId;

  constructor(intent: AiIntentId) {
    super(
      `I couldn't reach the image model, so that edit can't run right now. ` +
        `Board changes still work — try “make it 4 inches wide” or ask “what can you do?”. ` +
        `If it keeps failing, the image model may need connecting.`,
    );
    this.name = "NoProviderError";
    this.intent = intent;
  }
}

/** Thrown when the user cancels — callers treat this as a no-op, not a failure. */
export class AiEditAbortedError extends Error {
  constructor() {
    super("Generation canceled");
    this.name = "AiEditAbortedError";
  }
}
