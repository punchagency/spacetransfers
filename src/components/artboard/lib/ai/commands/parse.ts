import { CANVAS_BACKGROUNDS } from "../../../../../config/artboard.config";
import type { BoardCommand } from "./types";

/**
 * Deterministic prompt → board command parser.
 *
 * Runs *before* the image-intent classifier, so its single most important
 * property is restraint: it must claim only what is unambiguously a board
 * operation and leave everything else to the pixel pipeline. Two rules keep
 * that honest:
 *
 *  1. Destructive verbs only match when the object is the item itself.
 *     "delete this" is a board command; "remove the background" and "remove the
 *     person on the left" are image edits and must fall straight through.
 *  2. Resolution vocabulary is off-limits. "upscale", "enlarge", "scale up" and
 *     "higher resolution" belong to the `upscale` intent — physical resizing is
 *     expressed as a measurement or a percentage, never as those words.
 *
 * Returning data (not closures) means a parse can be logged, previewed, or
 * replayed, and a model-driven parser can later emit the same shapes.
 */

// ── Measurement primitives ──────────────────────────────────────────────────
// Fractions matter here: print people write 3 1/2", not 3.5in.
const NUMBER = String.raw`\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d*\.\d+|\d+`;
const UNIT = String.raw`"|''|inches|inch|in\b|cm\b|mm\b`;

const toNumber = (raw: string): number => {
  const text = raw.trim().replace(/\s+/g, " ");
  const mixed = text.match(/^(\d+) (\d+)\s*\/\s*(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = text.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  return Number(text);
};

/** Normalises any supported unit to inches — the artboard's only unit. */
const toInches = (raw: string, unit?: string): number => {
  const value = toNumber(raw);
  const u = (unit || "").trim().toLowerCase();
  if (u === "cm") return value / 2.54;
  if (u === "mm") return value / 25.4;
  return value;
};

const LEN = new RegExp(String.raw`(${NUMBER})\s*(${UNIT})?`, "i");
const lengthAt = (match: RegExpMatchArray, numIdx: number): number =>
  toInches(match[numIdx], match[numIdx + 1]);

// ── Guards ──────────────────────────────────────────────────────────────────
/**
 * Vocabulary owned by the image pipeline. A prompt containing any of these is
 * never treated as a physical resize, so "upscale this" keeps reaching the
 * model that can actually add pixels.
 */
const RESOLUTION_WORDS =
  /\b(upscale|scale up|enlarge|resolution|dpi|pixels?|4k|8k|sharpen|quality)\b/i;

/**
 * Words that make a destructive verb refer to the item itself rather than to
 * something *inside* the image. Deliberately excludes "object", "background",
 * "person" and every other in-image noun.
 */
// The determiner is allowed to stand alone ("delete this"), so the separator is
// `\s*` — with `\s+` the bare determiner fails to match and the command is lost.
const SELF_TARGET =
  /^(?:(?:the|this|that|these|those|my|current|selected)\s*)*(?:it|one|image|images|item|items|artwork|design|designs|graphic|graphics|picture|pictures|selection|copy|copies)?$/i;

const isSelfTarget = (remainder: string): boolean =>
  SELF_TARGET.test(remainder.replace(/[.!?,]/g, "").trim());

const ALL_WORDS = /\b(all|everything|every item|every image|the lot)\b/i;

/**
 * Zoom is a change to the *view*, never to the artwork or its print size.
 * Without this guard "zoom to 150%" resizes the selected image (the percentage
 * rule) and "zoom to fit the sheet" stretches it to the full film width.
 */
const ZOOM_WORDS = /\b(zoom|magnif|actual size)\b|\bfit to (?:screen|view|window)\b/i;

// ── Rules ───────────────────────────────────────────────────────────────────
type Rule = (text: string) => BoardCommand[] | null;

const RULES: Rule[] = [
  // History — checked first; they are unambiguous single words.
  (t) => (/^(undo|undo that|go back|revert)\b/i.test(t) ? [{ kind: "undo" }] : null),
  (t) => (/^(redo|redo that|forward)\b/i.test(t) ? [{ kind: "redo" }] : null),

  // Selection
  (t) =>
    /\b(select|highlight)\s+(all|everything)\b/i.test(t)
      ? [{ kind: "select", scope: "all" }]
      : null,
  (t) =>
    /\b(deselect|unselect|clear\s+(the\s+)?selection|select\s+none)\b/i.test(t)
      ? [{ kind: "select", scope: "none" }]
      : null,

  // Clear the whole sheet. Matched before the self-referential delete so
  // "delete everything" isn't read as "delete this".
  (t) =>
    /\b(clear|empty|wipe|reset)\s+(the\s+)?(board|artboard|sheet|canvas|gang\s*sheet|everything)\b/i.test(t) ||
    (/\b(delete|remove|get rid of)\b/i.test(t) && ALL_WORDS.test(t))
      ? [{ kind: "delete", scope: "all" }]
      : null,

  // Delete the selection — only when the object is the item itself (guard #1).
  (t) => {
    const m = t.match(
      /^(?:(?:can|could|would) you\s+|please\s+)*(?:delete|remove|discard|get rid of|trash)\s*(.*)$/i,
    );
    if (!m) return null;
    return isSelfTarget(m[1]) ? [{ kind: "delete", scope: "selection" }] : null;
  },

  // Independent duplicates, distinct from `copies` on a single item.
  (t) => {
    const m = t.match(/\b(?:duplicate|clone)\b(?:\s+(?:it|this|that))?(?:\s+(\d+)\s*(?:times|x))?/i);
    if (!m) return null;
    return [{ kind: "duplicate", times: m[1] ? Math.max(1, parseInt(m[1], 10)) : 1 }];
  },

  // Copy count — "add 3 more copies" is relative, everything else absolute.
  (t) => {
    const delta = t.match(/\b(?:add|another|plus)\s+(\d+)\s*(?:more\s+)?(?:copies|copy|of these|of them)\b/i);
    if (delta) return [{ kind: "copies-delta", delta: parseInt(delta[1], 10) }];

    const abs =
      t.match(/\b(?:set\s+)?copies\s*(?:to|=|:)?\s*(\d+)\b/i) ||
      t.match(/\b(?:make|give me|i want|need|print)\s+(\d+)\s+(?:copies|of these|of them)\b/i) ||
      // "12x" on its own is a copy count; "4 x 6" is a size, so the bare-number
      // form must not be followed by another number.
      t.match(/^(\d+)\s*(?:copies\b|x\s*$)/i);
    if (abs) return [{ kind: "copies", value: parseInt(abs[1], 10) }];
    return null;
  },

  // Fill the printable width. Skipped for zoom phrasing (guard #3).
  (t) =>
    !ZOOM_WORDS.test(t) &&
    /\b(fit|fill|stretch|expand)\b[^.]*\b(width|sheet|film|across|full\s*width)\b|\bfull\s*width\b|\bas wide as possible\b/i.test(t)
      ? [{ kind: "fit-width" }]
      : null,

  // Both dimensions at once: "4x6", "4 by 6 inches", "make it 3.5 x 2".
  (t) => {
    const m = t.match(
      new RegExp(String.raw`(${NUMBER})\s*(${UNIT})?\s*(?:x|by|×)\s*(${NUMBER})\s*(${UNIT})?`, "i"),
    );
    if (!m) return null;
    // A trailing unit ("4 x 6 in") applies to both numbers.
    const unit = m[2] || m[4];
    return [
      {
        kind: "resize-both",
        widthIn: toInches(m[1], m[2] || unit),
        heightIn: toInches(m[3], m[4] || unit),
      },
    ];
  },

  // Single-axis absolute size. Guarded against resolution vocabulary (guard #2)
  // and against movement verbs — "move it 2 inches down" is a nudge, and
  // "down"/"across" would otherwise read as height/width keywords.
  (t) => {
    if (RESOLUTION_WORDS.test(t)) return null;
    if (/\b(move|nudge|shift|push|bump|align|center|centre)\b/i.test(t)) return null;
    const width = t.match(
      new RegExp(String.raw`(?:width\s*(?:to|=|:)?\s*)?(${NUMBER})\s*(${UNIT})?\s*(?:wide|width|across)\b`, "i"),
    ) || t.match(new RegExp(String.raw`\bwidth\s*(?:to|=|:)?\s*(${NUMBER})\s*(${UNIT})?`, "i"));
    if (width) return [{ kind: "resize", axis: "width", valueIn: lengthAt(width, 1) }];

    const height = t.match(
      new RegExp(String.raw`(${NUMBER})\s*(${UNIT})?\s*(?:tall|high|height)\b`, "i"),
    ) || t.match(new RegExp(String.raw`\bheight\s*(?:to|=|:)?\s*(${NUMBER})\s*(${UNIT})?`, "i"));
    if (height) return [{ kind: "resize", axis: "height", valueIn: lengthAt(height, 1) }];
    return null;
  },

  // Proportional scaling. Never claims "upscale"/"enlarge" (guard #2), and
  // never a zoom percentage (guard #3) — those change the view, not the print.
  (t) => {
    if (RESOLUTION_WORDS.test(t) || ZOOM_WORDS.test(t)) return null;
    const pct = t.match(new RegExp(String.raw`(?:scale|resize|size)?[^.\d]*(${NUMBER})\s*(?:%|percent)`, "i"));
    if (pct) {
      const factor = toNumber(pct[1]) / 100;
      if (factor > 0) return [{ kind: "scale", factor }];
    }
    if (/\b(twice as (?:big|large|wide)|double the size|2x the size|double it)\b/i.test(t))
      return [{ kind: "scale", factor: 2 }];
    if (/\b(half the size|half as (?:big|large)|shrink by half)\b/i.test(t))
      return [{ kind: "scale", factor: 0.5 }];
    if (/\b(?:make it |a bit |slightly )?(bigger|larger)\b/i.test(t)) return [{ kind: "scale", factor: 1.25 }];
    if (/\b(?:make it |a bit |slightly )?(smaller|tinier)\b/i.test(t)) return [{ kind: "scale", factor: 0.8 }];
    return null;
  },

  // Rotation. "turn X into Y" is a restyle request ("turn it into a sticker"),
  // never a rotation — that exclusion has to come first or it steals the
  // `to-sticker` and `cartoon` intents.
  (t) => {
    if (/\bturn\s+(?:it|this|that|the\s+\w+)?\s*into\b/i.test(t)) return null;
    if (/\b(upside down|180)\b/i.test(t) && /\b(rotate|turn|flip)\b/i.test(t))
      return [{ kind: "rotate", degrees: 180 }];
    const explicit = t.match(/\b(?:rotate|turn|spin)\b[^.\d]*(-?\d+)\s*(?:°|deg|degrees)?/i);
    if (explicit) return [{ kind: "rotate", degrees: parseInt(explicit[1], 10) }];
    if (/\b(?:rotate|turn|spin)\b.*\b(left|anti-?clockwise|counter-?clockwise|ccw)\b/i.test(t))
      return [{ kind: "rotate", degrees: -90 }];
    if (/\b(?:rotate|turn|spin)\b.*\b(right|clockwise|cw)\b/i.test(t))
      return [{ kind: "rotate", degrees: 90 }];
    if (/\b(rotate|spin it|sideways|landscape|portrait)\b/i.test(t))
      return [{ kind: "rotate", degrees: 90 }];
    return null;
  },

  // Flip / mirror. "flip horizontally" and "mirror" are the same toggle here,
  // because the item model exposes a single `flipped` boolean.
  (t) => (/\b(flip|mirror|reverse it)\b/i.test(t) ? [{ kind: "flip" }] : null),

  // Lock
  (t) => {
    if (/\b(unlock|un-?lock)\b/i.test(t)) return [{ kind: "lock", value: false }];
    if (/\block\b/i.test(t) && !/\baspect|ratio\b/i.test(t)) return [{ kind: "lock", value: true }];
    return null;
  },

  // Auto-crop / trim surrounding whitespace.
  (t) => {
    if (/\b(?:un-?crop|undo crop|restore|full bleed)\b/i.test(t)) return [{ kind: "auto-crop", value: false }];
    if (/\b(auto-?crop|trim|crop)\b[^.]*\b(whitespace|white space|edges|transparent|padding|excess)?\b/i.test(t))
      return [{ kind: "auto-crop", value: true }];
    return null;
  },

  // Distribute — checked before the spacing setting so "space them evenly"
  // doesn't get read as a numeric spacing change.
  (t) => {
    if (/\b(distribute|space (?:them |these )?(?:out )?evenly|even(?:ly)? spaced?|equal spacing)\b/i.test(t)) {
      const axis: "x" | "y" = /\b(vertical|column|down|stacked)\b/i.test(t) ? "y" : "x";
      return [{ kind: "distribute", axis }];
    }
    return null;
  },

  // Alignment
  (t) => {
    if (!/\b(align|center|centre)\b/i.test(t)) return null;
    if (/\b(center|centre)\b/i.test(t) && !/\b(left|right|top|bottom)\b/i.test(t)) {
      if (/\bhorizontal(ly)?\b/i.test(t)) return [{ kind: "align", edge: "center-x" }];
      if (/\bvertical(ly)?\b/i.test(t)) return [{ kind: "align", edge: "center-y" }];
      // Bare "center it" means both axes — one command so it reads back as one
      // confirmation rather than two.
      return [{ kind: "align", edge: "center" }];
    }
    if (/\bleft\b/i.test(t)) return [{ kind: "align", edge: "left" }];
    if (/\bright\b/i.test(t)) return [{ kind: "align", edge: "right" }];
    if (/\btop\b/i.test(t)) return [{ kind: "align", edge: "top" }];
    if (/\bbottom\b/i.test(t)) return [{ kind: "align", edge: "bottom" }];
    return null;
  },

  // Relative movement
  (t) => {
    const m = t.match(
      new RegExp(
        String.raw`\b(?:move|nudge|shift|push|bump)\b[^.\d]*(${NUMBER})\s*(${UNIT})?\s*(?:to the\s+)?(left|right|up|down)\b`,
        "i",
      ),
    );
    if (!m) return null;
    const distance = toInches(m[1], m[2]);
    const dir = m[3].toLowerCase();
    return [
      {
        kind: "nudge",
        dxIn: dir === "left" ? -distance : dir === "right" ? distance : 0,
        dyIn: dir === "up" ? -distance : dir === "down" ? distance : 0,
      },
    ];
  },

  // Absolute placement
  (t) => {
    const m = t.match(
      new RegExp(
        String.raw`\b(?:put|place|position|move)\b[^.\d]*\bat\b[^.\d]*(${NUMBER})\s*(${UNIT})?\s*(?:,|and|by)\s*(${NUMBER})\s*(${UNIT})?`,
        "i",
      ),
    );
    if (!m) return null;
    return [{ kind: "position", xIn: toInches(m[1], m[2]), yIn: toInches(m[3], m[4]) }];
  },

  // ── Board settings ────────────────────────────────────────────────────────
  (t) => {
    const on = /\b(on|enable|turn on|show|start|activate|yes)\b/i.test(t);
    const off = /\b(off|disable|turn off|hide|stop|deactivate|no|don'?t)\b/i.test(t);

    if (/\b(auto-?nest|nest(ing)?|pack(ing)?|tighten the layout)\b/i.test(t))
      return [{ kind: "setting", key: "autoNestStickers", value: !off }];

    const spacing = t.match(new RegExp(String.raw`\bspacing\b[^.\d]*(${NUMBER})\s*(${UNIT})?`, "i"))
      || t.match(new RegExp(String.raw`\bgaps?\b[^.\d]*(${NUMBER})\s*(${UNIT})?`, "i"));
    if (spacing) return [{ kind: "setting", key: "spacing", value: toInches(spacing[1], spacing[2]) }];

    const margin = t.match(new RegExp(String.raw`\bmargins?\b[^.\d]*(${NUMBER})\s*(${UNIT})?`, "i"));
    if (margin) return [{ kind: "setting", key: "marginSize", value: toInches(margin[1], margin[2]) }];

    if (/\bmargins?\b/i.test(t) && (on || off))
      return [{ kind: "setting", key: "showMargins", value: on && !off }];
    if (/\bgrid\b/i.test(t) && !/\bsnap\b/i.test(t))
      return [{ kind: "setting", key: "showGrid", value: !off }];
    if (/\brulers?\b/i.test(t)) return [{ kind: "setting", key: "showRulers", value: !off }];
    if (/\bsnap(ping)?\b/i.test(t)) return [{ kind: "setting", key: "snapToGrid", value: !off }];

    // Canvas background.
    //
    // Requires an explicit canvas/preview qualifier. A bare "background" is
    // ambiguous and belongs to the image pipeline — "replace the background
    // with white" is about the artwork's own background, not the sheet it sits
    // on, and silently repainting the canvas instead would be wrong.
    if (/\b(?:canvas|artboard|board|sheet|background preview|preview)\b/i.test(t)) {
      const hex = t.match(/#[0-9a-f]{3,8}\b/i);
      if (hex) return [{ kind: "setting", key: "canvasBg", value: hex[0] }];

      // Longest alias first, so "dark gray" wins over "gray" and "light gray"
      // is never mistaken for plain "gray".
      const aliases = CANVAS_BACKGROUNDS.flatMap((swatch) =>
        swatch.aliases.map((alias) => ({ alias, id: swatch.id })),
      ).sort((a, b) => b.alias.length - a.alias.length);

      for (const { alias, id } of aliases) {
        if (new RegExp(String.raw`\b${alias.replace(/\s+/g, String.raw`\s+`)}\b`, "i").test(t)) {
          return [{ kind: "setting", key: "canvasBg", value: id }];
        }
      }
    }
    return null;
  },

  // ── View / zoom ───────────────────────────────────────────────────────────
  (t) => {
    if (!/\b(zoom|magnif|fit to (?:screen|view|window)|actual size)\b/i.test(t)) return null;
    if (/\bfit\b|\bfit to (?:screen|view|window)\b|\bwhole (?:sheet|board)\b/i.test(t))
      return [{ kind: "zoom", mode: "fit" }];
    if (/\bactual size\b|\b100\s*%\b/i.test(t)) return [{ kind: "zoom", mode: "set", factor: 1 }];

    const pct = t.match(new RegExp(String.raw`(${NUMBER})\s*(?:%|percent)`, "i"));
    if (pct) {
      const factor = toNumber(pct[1]) / 100;
      if (factor > 0) return [{ kind: "zoom", mode: "set", factor }];
    }
    if (/\bzoom\s+out\b|\bzoom\s+back\b|\bsmaller view\b/i.test(t)) return [{ kind: "zoom", mode: "out" }];
    if (/\bzoom\s+in\b|\bcloser\b|\bmagnif/i.test(t)) return [{ kind: "zoom", mode: "in" }];
    return null;
  },
];

const runRules = (text: string): BoardCommand[] => {
  for (const rule of RULES) {
    const result = rule(text);
    if (result && result.length) return result;
  }
  return [];
};

/**
 * Parses a prompt into zero or more board commands.
 *
 * Clause splitting lets one sentence carry several instructions ("make it 4
 * inches wide and give me 12 copies"). The whole string is tried first so
 * multi-word phrases containing a conjunction ("4 by 6 and centered") aren't
 * torn apart before they can match.
 */
export const parseBoardCommands = (prompt: string): BoardCommand[] => {
  const text = prompt.trim().replace(/\s+/g, " ");
  if (!text) return [];

  // `\.(?!\d)` is load-bearing: a plain `\.` splits "0.25" into "0" and "25",
  // silently turning every decimal measurement into a different number.
  const clauses = text
    .split(/\s*(?:,|;|\.(?!\d)|\band\b|\bthen\b|\balso\b)\s*/i)
    .filter(Boolean);

  // A single clause means nothing was split — the whole-string pass already
  // covers it, so don't run the rules twice.
  if (clauses.length <= 1) return runRules(text);

  const collected: BoardCommand[] = [];
  const seen = new Set<string>();
  for (const clause of clauses) {
    for (const command of runRules(clause)) {
      // One command per kind: a later clause replaces an earlier one of the
      // same kind rather than queueing two conflicting mutations.
      const key = command.kind === "setting" ? `setting:${command.key}`
        : command.kind === "resize" ? `resize:${command.axis}`
        : command.kind === "align" ? `align:${command.edge}`
        : command.kind;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(command);
    }
  }

  // Nothing matched clause-by-clause — the conjunction was probably internal
  // to a phrase, so fall back to the unsplit string.
  return collected.length ? collected : runRules(text);
};
