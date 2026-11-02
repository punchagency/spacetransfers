/**
 * The catalogue of what the AI text box can do to the board.
 *
 * Kept as data next to the parser on purpose: a capability list that lives in a
 * separate doc drifts the moment a rule changes, and a user who is told the box
 * can do something it can't will stop trusting the box entirely. Every entry
 * below has a matching rule in `parse.ts`.
 */

export interface CapabilityGroup {
  title: string;
  /** Phrasings that are known to parse — safe to show as copyable examples. */
  examples: string[];
}

export const BOARD_CAPABILITIES: CapabilityGroup[] = [
  {
    title: "Size",
    examples: [
      "make it 4 inches wide",
      "3.5 x 2 inches",
      "scale to 60%",
      "fit to the full width",
    ],
  },
  {
    title: "Copies",
    examples: ["12 copies", "add 3 more copies", "duplicate it 4 times"],
  },
  {
    title: "Transform",
    examples: ["rotate 90°", "flip it", "lock this", "trim the whitespace"],
  },
  {
    title: "Placement",
    examples: [
      "center it",
      "align left",
      "move it 2 inches right",
      "space them evenly",
    ],
  },
  {
    title: "Sheet",
    examples: ["select all", "delete this", "clear the board", "undo"],
  },
  {
    title: "Canvas tools",
    examples: [
      "turn on rulers and snap to grid",
      "hide the grid",
      "show margins",
    ],
  },
  {
    title: "Layout & nesting",
    examples: [
      "enable auto-nest",
      "set item spacing to 0.25 in",
      "set the margin to 0.5 inches",
    ],
  },
  {
    title: "View",
    examples: [
      "zoom to fit",
      "zoom to 150%",
      "zoom in",
      "change the background preview to dark",
    ],
  },
  {
    title: "Image edits",
    examples: [
      "remove the background",
      "make the logo gold",
      "upscale this",
      "turn it into a sticker",
    ],
  },
];

/**
 * Reply for "what can you do?" — the one prompt where a wall of text is the
 * correct answer, because the user is explicitly asking for the menu.
 */
export const describeBoardCapabilities = (): string =>
  [
    "I can change the artwork itself and the sheet it sits on. Try:",
    ...BOARD_CAPABILITIES.map(
      (group) => `• ${group.title} — ${group.examples.map((e) => `“${e}”`).join(", ")}`,
    ),
  ].join("\n");

/** Board chips, shown alongside the existing image-edit quick actions. */
export const BOARD_QUICK_ACTIONS: Array<{
  label: string;
  prompt: string;
  /** Pre-fills the input instead of running, for actions needing a number. */
  template?: string;
  hint: string;
}> = [
  {
    label: "Resize",
    prompt: "make it ",
    template: "make it ",
    hint: "Set a physical print size — “make it 4 inches wide”",
  },
  {
    label: "Copies",
    prompt: "copies ",
    template: "copies ",
    hint: "Set how many times this prints on the sheet",
  },
  {
    label: "Fit width",
    prompt: "fit to the full width",
    hint: "Stretch to the full printable width of the film",
  },
  {
    label: "Center",
    prompt: "center it",
    hint: "Centre on the sheet",
  },
  {
    label: "Auto-nest",
    prompt: "turn auto-nest on",
    hint: "Let the layout engine pack items tightly",
  },
];
