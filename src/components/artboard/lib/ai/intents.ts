import type { AiIntentId } from "./types";
// Imported from the module rather than the barrel to keep `./commands` from
// importing `./intents` back through `./index`.
import { describeBoardCapabilities } from "./commands/capabilities";

export interface QuickAction {
  intent: AiIntentId;
  label: string;
  /** Prompt sent when the chip is clicked with an empty input. */
  prompt: string;
  /**
   * When set, clicking the chip pre-fills the input with this template and
   * places the caret at the end instead of generating immediately — used for
   * actions that are meaningless without a user-supplied noun ("gold", "sunset").
   */
  template?: string;
  hint: string;
}

/**
 * Quick-action chips, in bar order. Chips whose intent maps to a local
 * (already-shipping) capability are listed first so the common cases are
 * one click away and never depend on a generative provider being configured.
 */
export const QUICK_ACTIONS: QuickAction[] = [
  {
    intent: "remove-bg",
    label: "Remove background",
    prompt: "Remove the background",
    hint: "Cuts out the subject and makes the background transparent",
  },
  {
    intent: "upscale",
    label: "Upscale",
    prompt: "Upscale this image",
    hint: "Increases resolution without changing the print size",
  },
  {
    intent: "enhance",
    label: "Enhance quality",
    prompt: "Enhance the quality of this image",
    hint: "Sharpens detail and lifts the image to print-ready DPI",
  },
  {
    intent: "to-sticker",
    label: "Convert to sticker",
    prompt: "Convert this into a die-cut sticker with a clean white border",
    hint: "Cutout plus a contour sticker border",
  },
  {
    intent: "replace-bg",
    label: "Replace background",
    prompt: "Replace the background with ",
    template: "Replace the background with ",
    hint: "Describe the scene you want behind the subject",
  },
  {
    intent: "change-color",
    label: "Change color",
    prompt: "Change the color to ",
    template: "Change the color to ",
    hint: "Recolour the subject — name the colour you want",
  },
  {
    intent: "remove-color",
    label: "Remove color",
    prompt: "Remove the color ",
    template: "Remove the color ",
    hint: "Click a colour in the image, or name one, to strip it out",
  },
  {
    intent: "remove-object",
    label: "Remove object",
    prompt: "Remove ",
    template: "Remove ",
    hint: "Name the object to erase from the image",
  },
  {
    intent: "replace-object",
    label: "Replace object",
    prompt: "Replace ",
    template: "Replace ",
    hint: "Swap one thing for another — “replace the shirt with a black hoodie”",
  },
  {
    intent: "add-object",
    label: "Add something",
    prompt: "Add ",
    template: "Add ",
    hint: "Insert a new element — “add sunglasses to the person”",
  },
  {
    intent: "isolate-subject",
    label: "Keep only subject",
    prompt: "Remove everyone and everything except the main subject",
    hint: "Erases the rest of the scene and rebuilds the background",
  },
  {
    intent: "relight",
    label: "Relight",
    prompt: "Change the lighting to ",
    template: "Change the lighting to ",
    hint: "Golden hour, studio light, sunset — describe the light you want",
  },
  {
    intent: "style-transfer",
    label: "Restyle",
    prompt: "Restyle this as ",
    template: "Restyle this as ",
    hint: "Watercolour, anime, vintage poster — name the style",
  },
  {
    intent: "sketch-to-photo",
    label: "Sketch → photo",
    prompt: "Convert this sketch into a realistic photograph",
    hint: "Renders line art as a photorealistic image",
  },
  {
    intent: "outpaint",
    label: "Expand image",
    prompt: "Extend the image outwards, continuing the scene naturally on all sides",
    hint: "Generates more scene beyond the current edges",
  },
];

/**
 * Keyword → intent rules, evaluated in order. Deliberately ordered
 * most-specific-first: "replace the background with a sunset" must classify as
 * `replace-bg`, not `remove-bg`, even though both mention "background".
 */
const RULES: Array<{ intent: AiIntentId; test: RegExp }> = [
  // "everything/everyone except X" is checked before the generic remove rules:
  // it is literally a removal request, but reconstructing a whole scene minus
  // its extras is a different operation from erasing one named object.
  {
    intent: "isolate-subject",
    test: /\b(remove|delete|erase|get rid of)\b[^.]*\bexcept\b|\b(keep|leave)\s+(only|just)\b|\b(isolate|only)\s+the\s+(main\s+)?(subject|person|product)\b/i,
  },
  { intent: "sketch-to-photo", test: /\b(sketch|drawing|line ?art|doodle|outline)\b[^.]*\b(realistic|photo|photograph|real life|lifelike)\b|\bmake (this|it) (a )?(realistic|real) (photo|photograph)\b/i },
  { intent: "replace-bg", test: /\b(replace|change|swap|put|set|make)\b[^.]*\b(background|backdrop|sky|scene)\b/i },
  { intent: "remove-bg", test: /\b(remove|delete|erase|cut ?out|strip|get rid of)\b[^.]*\b(background|backdrop|bg)\b/i },
  // A colour naming a *thing* — "remove the red circle", "delete the blue car" —
  // is an object removal. Without this the colour-removal rule below claimed it
  // and would have erased every red pixel in the artwork. A colour followed by
  // nothing, or by colour/area words or a connective ("remove the red", "the
  // white from the logo", "red and blue"), is still a colour removal.
  {
    intent: "remove-object",
    test: /\b(remove|delete|erase|get rid of)\b[^.]*\b(?:white|black|green|blue|red|yellow|orange|purple|pink|gr[ae]y|gold|silver|brown|magenta|cyan|teal|navy|beige|cream)\s+(?!(?:colou?rs?|background|backdrop|bg|parts?|areas?|pixels?|bits?|tones?|shades?|from|in|on|of|and|or|with|around|behind)\b)[a-z]{3,}/i,
  },
  // Ahead of change-color: "remove the white" and "make the white transparent"
  // are colour *removals*, and change-color would repaint instead of stripping.
  {
    // The hex alternative carries no leading \b: `#` is a non-word character,
    // so between a space and a `#` there is no word boundary at all and
    // "Remove #ff00ff" would fall through to remove-object.
    intent: "remove-color",
    test: /\b(remove|delete|erase|drop|strip|knock out|get rid of|kill)\b[^.]*(?:\b(?:colou?r|white|black|green|blue|red|yellow|orange|purple|pink|gr[ae]y|magenta|cyan|teal|navy|beige|cream)\b|#[0-9a-f]{3,8}\b)|\bmake\b[^.]*\b(white|black|green|blue|red|yellow|orange|purple|pink|gr[ae]y)\b[^.]*\btransparent\b|\b(chroma ?key|green ?screen)\b/i,
  },
  { intent: "make-transparent", test: /\b(transparent|transparency|alpha|no background)\b/i },
  { intent: "to-sticker", test: /\b(sticker|die[- ]?cut|decal)\b/i },
  { intent: "add-shadow", test: /\b(shadow|drop ?shadow)\b/i },
  { intent: "outpaint", test: /\b(outpaint|expand|extend|widen|zoom out|more (of the )?(scene|background)|fill (in )?(the )?(edges|sides))\b/i },
  { intent: "relight", test: /\b(re-?light|lighting|sunset|sunrise|golden hour|studio light|backlit|night ?time|daylight|shadows softer|light direction)\b/i },
  { intent: "upscale", test: /\b(upscale|scale up|enlarge|\b[24]k\b|\b8k\b|higher resolution|more pixels)\b/i },
  { intent: "enhance", test: /\b(enhance|improve|sharpen|clean up|higher quality|increase (the )?quality|print[- ]ready|dpi)\b/i },
  { intent: "generative-fill", test: /\b(fill (in )?|inpaint|patch)\b[^.]*\b(area|region|gap|hole|space|spot)\b/i },
  // A recolour phrased as a change — "change the colour to green", the
  // Change color chip's own wording, or "turn it gold". Ahead of the swap rule
  // below, whose "change … to" claimed it as an object replacement and then
  // asked what the object should become.
  {
    intent: "change-color",
    test: /\b(change|switch|set)\b[^.]*\bcolou?rs?\b[^.]*\b(to|into)\b|\b(turn|make|change|paint)\b[^.]*\b(?:white|black|green|blue|red|yellow|orange|purple|pink|gr[ae]y|gold|silver|brown|magenta|cyan|teal|navy|beige|cream)\s*[.!]?\s*$/i,
  },
  // Before the bare remove/add rules — a swap is a removal *and* an addition,
  // and treating it as either half alone loses the other.
  { intent: "replace-object", test: /\b(replace|swap|change|turn|convert)\b[^.]*\b(with|for|into|to)\b/i },
  { intent: "style-transfer", test: /\b(cartoon|anime|comic|illustration|watercolou?r|oil painting|vintage|retro|poster|pixel art|pop ?art|art style|restyle|in the style of)\b/i },
  { intent: "change-color", test: /\b(colou?r|recolou?r|tint|make (it|the .+) (gold|silver|red|blue|green|black|white|pink|purple|orange|yellow))\b/i },
  // A bare "replace the shirt" with no target named. Placed after the specific
  // rules so "swap the colours" still reads as a recolour, but ahead of the
  // generic add/remove rules — landing on remove-object would erase the shirt,
  // whereas classifying it here lets `analyzePrompt` ask what it should become.
  { intent: "replace-object", test: /\b(replace|swap)\b/i },
  { intent: "add-object", test: /\b(add|put|place|give (him|her|them|it)|wearing)\b/i },
  { intent: "remove-object", test: /\b(remove|delete|erase|get rid of)\b/i },
];

/**
 * Maps free-form text onto a canonical intent. Falls back to `custom`, which
 * only generative providers accept.
 *
 * Classification matters beyond routing: it keeps the common operations
 * (background removal, upscaling) on the local/deterministic path instead of
 * spending a generative call on work the app already does well offline.
 */
export const classifyPrompt = (prompt: string): AiIntentId => {
  const text = prompt.trim();
  if (!text) return "custom";
  for (const rule of RULES) {
    if (rule.test.test(text)) return rule.intent;
  }
  return "custom";
};

/**
 * A small, deterministic preflight for the text box. It deliberately does not
 * rewrite a customer's request: image edits are creative work and silently
 * changing their words is surprising. Instead it recognises the common
 * conversational shortcuts, identifies missing details that would make a
 * model guess, and gives the customer one precise next step.
 */
export interface PromptAnalysis {
  intent: AiIntentId;
  clarification?: string;
  reply?: string;
}

const COLOUR_WORD = /\b(red|blue|green|yellow|orange|purple|pink|black|white|gray|grey|gold|silver|brown|teal|cyan|magenta|navy|beige|cream)\b/i;
const HELP_REQUEST =
  /^(help|what can (you|i) do|what (else )?can you do|how does this work|what edits|what commands|show (me )?(examples|commands)|options)\??$/i;

export const analyzePrompt = (prompt: string): PromptAnalysis => {
  const text = prompt.trim().replace(/\s+/g, " ");
  const intent = classifyPrompt(text);

  if (HELP_REQUEST.test(text)) {
    // Generated from the command catalogue rather than hand-written, so the
    // help text cannot drift out of step with what actually parses.
    return { intent: "custom", reply: describeBoardCapabilities() };
  }

  if (intent === "replace-bg" && !/\b(with|to|into|as)\s+\S+/i.test(text)) {
    return { intent, clarification: "What should replace the background? For example: “with a sunny beach.”" };
  }

  if (intent === "change-color" && !COLOUR_WORD.test(text)) {
    return { intent, clarification: "Which colour should I use? For example: “make the logo metallic gold.”" };
  }

  // A colour removal needs a colour, and unlike the other intents it has a
  // second, better way to supply one — so the ask points at the swatches
  // rather than asking the customer to name a shade they'd have to guess at.
  if (intent === "remove-color" && !COLOUR_WORD.test(text) && !/#[0-9a-f]{3,8}\b/i.test(text)) {
    return {
      intent,
      clarification: "Which colour? Click one of the swatches above, or name it — “remove the white”.",
    };
  }

  if (intent === "replace-object" && !/\b(with|for|into|to)\s+\S+/i.test(text)) {
    return { intent, clarification: "What should it become? For example: “replace the blue shirt with a black hoodie.”" };
  }

  if (intent === "relight" && /^(re-?light|change the lighting|fix the lighting)[!. ]*$/i.test(text)) {
    return { intent, clarification: "What light are you after? For example: “warm golden-hour light from the left.”" };
  }

  if (intent === "remove-object") {
    const subject = text
      .replace(/\b(remove|delete|erase|get rid of)\b/i, "")
      .replace(/\b(the|a|an|this|that|it|object)\b/gi, "")
      .replace(/[.!,?]/g, "")
      .trim();
    if (!subject) {
      return { intent, clarification: "What should I remove? Name it and, if helpful, say where it is in the image." };
    }
  }

  if (/^(make it better|make this better|fix it|improve it|do something cool)[!. ]*$/i.test(text)) {
    return {
      intent: "custom",
      clarification:
        "Tell me the outcome you want — sharper print quality, a new background, a colour change, or a different style?",
    };
  }

  return { intent };
};

/** Short label for an intent, used in progress copy ("Removing background…"). */
export const INTENT_VERBS: Record<AiIntentId, string> = {
  "remove-bg": "Removing background",
  "remove-color": "Removing colour",
  "make-transparent": "Making transparent",
  "to-sticker": "Building sticker",
  "isolate-subject": "Isolating the subject",
  upscale: "Upscaling",
  enhance: "Enhancing quality",
  "replace-bg": "Replacing background",
  "change-color": "Recolouring",
  "remove-object": "Removing object",
  "replace-object": "Replacing object",
  "add-object": "Adding element",
  "add-shadow": "Adding shadow",
  relight: "Relighting",
  outpaint: "Expanding image",
  "generative-fill": "Filling in",
  "style-transfer": "Restyling",
  "sketch-to-photo": "Making it photoreal",
  cartoon: "Restyling",
  custom: "Generating",
};

/**
 * Intents that never call out to a model.
 *
 * Used to keep their chips live and their copy honest while the generative
 * tier is capped or unreachable — telling a customer that background and
 * colour removal are unavailable when they run entirely in their own browser
 * would be simply untrue.
 */
export const LOCAL_ONLY_INTENTS: readonly AiIntentId[] = [
  "remove-bg",
  "remove-color",
  "make-transparent",
  "to-sticker",
  "upscale",
  "enhance",
];

/**
 * Rotating placeholder examples shown under the input as suggestions.
 * Board and image examples are interleaved so the box never reads as
 * image-only — most users would otherwise never discover it can resize a
 * print or set a copy count.
 */
export const PROMPT_SUGGESTIONS = [
  "Make it 4 inches wide.",
  "Remove the white background.",
  "12 copies.",
  "Turn this into a watercolor painting.",
  "Center it on the sheet.",
  "Make the logo gold.",
  "Fit to the full width.",
  "Replace the sky with a sunset.",
  "Space them evenly.",
  "Remove the person on the left.",
  "Set spacing to 0.25 in.",
  "Add realistic shadows.",
  // Multi-step and referential examples, so the chained form is discoverable —
  // most people never try "then" unless they've seen that it works.
  "Make the rabbit pink, then add a birthday hat.",
  "Turn the balloon dog into a balloon rabbit.",
  "Add sunglasses to the person.",
  "Change the background to a snowy mountain.",
  "Remove everyone except the main subject.",
  "Convert this sketch into a realistic photo.",
];
