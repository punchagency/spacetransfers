import { describe, it, expect } from "vitest";
import {
  INTENT_VERBS,
  LOCAL_ONLY_INTENTS,
  QUICK_ACTIONS,
  analyzePrompt,
  classifyPrompt,
  parseBoardCommands,
  planLocally,
  splitSequence,
} from "../components/artboard/lib/ai";
import { parseHexColor } from "../components/artboard/lib/utils/colorRemover";

describe("classifyPrompt", () => {
  it("routes the documented example prompts to the right tool", () => {
    // These are the requests the suite is specified against, so a regression in
    // rule ordering shows up here rather than as a wrong edit.
    const cases: Array<[string, string]> = [
      ["Turn the balloon dog into a balloon rabbit.", "replace-object"],
      ["Replace the blue shirt with a black hoodie.", "replace-object"],
      ["Make the sky look like sunset.", "replace-bg"],
      ["Add sunglasses to the person.", "add-object"],
      ["Change the background to a snowy mountain.", "replace-bg"],
      ["Convert this sketch into a realistic photo.", "sketch-to-photo"],
      ["Remove everyone except the main subject.", "isolate-subject"],
    ];
    for (const [prompt, expected] of cases) {
      expect(classifyPrompt(prompt), prompt).toBe(expected);
    }
  });

  it("distinguishes removing a background from replacing one", () => {
    // Both mention "background"; ordering is what keeps them apart, and getting
    // it wrong means a replace request silently deletes the backdrop instead.
    expect(classifyPrompt("Remove the background")).toBe("remove-bg");
    expect(classifyPrompt("Replace the background with a beach")).toBe("replace-bg");
  });

  it("treats removing a named colour as a colour removal, not a recolour", () => {
    expect(classifyPrompt("Remove the white background")).toBe("remove-bg");
    expect(classifyPrompt("Remove the white")).toBe("remove-color");
    expect(classifyPrompt("Get rid of the green")).toBe("remove-color");
    expect(classifyPrompt("Remove #ff00ff")).toBe("remove-color");
    expect(classifyPrompt("Make the white transparent")).toBe("remove-color");
    // Contrast: this asks for a new colour, not for one to be stripped out.
    expect(classifyPrompt("Make the logo gold")).toBe("change-color");
  });

  it("reads a swap as a replacement rather than as half of one", () => {
    // A swap is a removal *and* an addition; classifying it as either alone
    // loses the other half of the request.
    expect(classifyPrompt("Replace the car with a bicycle")).toBe("replace-object");
    expect(classifyPrompt("Remove the car")).toBe("remove-object");
    expect(classifyPrompt("Add a bicycle")).toBe("add-object");
  });

  it("falls back to custom for text with no recognisable operation", () => {
    expect(classifyPrompt("something completely different")).toBe("custom");
    expect(classifyPrompt("")).toBe("custom");
  });

  it("has a verb for every intent a quick action can dispatch", () => {
    // INTENT_VERBS is indexed directly to build progress copy, so a missing key
    // would render "undefined…" in the panel.
    for (const action of QUICK_ACTIONS) {
      expect(INTENT_VERBS[action.intent], action.intent).toBeTruthy();
    }
  });

  it("keeps the local-only list to intents that need no model", () => {
    // These stay clickable while the generative tier is capped, so anything
    // listed here must genuinely run without a provider.
    for (const intent of LOCAL_ONLY_INTENTS) {
      expect(INTENT_VERBS[intent], intent).toBeTruthy();
    }
    expect(LOCAL_ONLY_INTENTS).toContain("remove-color");
    expect(LOCAL_ONLY_INTENTS).toContain("remove-bg");
    // Generative work must never be advertised as available offline.
    expect(LOCAL_ONLY_INTENTS).not.toContain("replace-bg");
    expect(LOCAL_ONLY_INTENTS).not.toContain("custom");
  });
});

describe("analyzePrompt", () => {
  it("asks for the one missing detail instead of letting the model guess", () => {
    expect(analyzePrompt("Replace the background with").clarification).toBeTruthy();
    expect(analyzePrompt("Change the color").clarification).toBeTruthy();
    expect(analyzePrompt("Replace the shirt").clarification).toBeTruthy();
  });

  it("points a colour removal at the eyedropper rather than asking for a name", () => {
    const analysis = analyzePrompt("Remove the color");
    expect(analysis.clarification).toMatch(/eyedropper|click/i);
  });

  it("stays quiet once the detail is present", () => {
    expect(analyzePrompt("Replace the background with a sunset").clarification).toBeUndefined();
    expect(analyzePrompt("Make the logo gold").clarification).toBeUndefined();
    expect(analyzePrompt("Remove the white").clarification).toBeUndefined();
  });

  it("answers a help request from the command catalogue", () => {
    const analysis = analyzePrompt("what can you do?");
    expect(analysis.reply).toBeTruthy();
  });
});

describe("planLocally", () => {
  it("splits on explicit sequence markers", () => {
    const plan = planLocally("Make the rabbit pink, then add a birthday hat");
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].prompt).toMatch(/pink/i);
    expect(plan.steps[1].prompt).toMatch(/birthday hat/i);
    expect(plan.steps[1].intent).toBe("add-object");
  });

  it("handles several chained markers", () => {
    const plan = planLocally("Remove the background, then make it blue, after that add a shadow");
    expect(plan.steps).toHaveLength(3);
  });

  it("leaves a bare 'and' alone", () => {
    // "a dog and cat wearing hats" is one scene. Splitting it would turn a
    // single coherent edit into two contradictory ones, so under-splitting is
    // the deliberate bias here.
    const plan = planLocally("Add a dog and a cat wearing hats");
    expect(plan.steps).toHaveLength(1);
  });

  it("does not split on 'then' inside a phrase it cannot use", () => {
    const plan = planLocally("Make it bigger then");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].prompt).toBe("Make it bigger then");
  });

  it("caps a runaway chain rather than queueing unbounded model calls", () => {
    const plan = planLocally(
      "remove the background, then make it red, then add a hat, then add shoes, then add a scarf",
    );
    expect(plan.steps.length).toBeLessThanOrEqual(4);
  });

  it("returns no steps for a question, so nothing reaches an image model", () => {
    const plan = planLocally("what can you do?");
    expect(plan.steps).toHaveLength(0);
    expect(plan.reply).toBeTruthy();
  });

  it("returns no steps when a detail is missing", () => {
    const plan = planLocally("Change the color");
    expect(plan.steps).toHaveLength(0);
    expect(plan.clarification).toBeTruthy();
  });

  it("marks a locally-derived plan as unplanned", () => {
    // `planned` is what tells the caller whether referential resolution
    // happened — a local plan cannot resolve "it" against the conversation.
    expect(planLocally("Remove the background").planned).toBe(false);
  });
});

describe("splitSequence + board routing", () => {
  it("separates a board clause from an image clause in one sentence", () => {
    // The bug this guards: the board parser recognises "4 inches wide", claims
    // the whole sentence, and the background removal is silently dropped. The
    // conversation layer splits first so each fragment is routed on its merits.
    const fragments = splitSequence("Make it 4 inches wide, then remove the background");
    expect(fragments).toHaveLength(2);

    const board = fragments.filter((f) => parseBoardCommands(f).length > 0);
    const image = fragments.filter((f) => parseBoardCommands(f).length === 0);

    expect(board).toHaveLength(1);
    expect(board[0]).toMatch(/4 inches/);
    expect(image).toHaveLength(1);
    expect(classifyPrompt(image[0])).toBe("remove-bg");
  });

  it("routes the same pair correctly in the other order", () => {
    const fragments = splitSequence("Remove the background, then make it 4 inches wide");
    const image = fragments.filter((f) => parseBoardCommands(f).length === 0);
    expect(image).toHaveLength(1);
    expect(classifyPrompt(image[0])).toBe("remove-bg");
  });

  it("claims nothing for a purely generative chain", () => {
    const fragments = splitSequence("Make the rabbit pink, then add a birthday hat");
    for (const fragment of fragments) {
      expect(parseBoardCommands(fragment), fragment).toHaveLength(0);
    }
  });

  it("returns a single fragment when there are no sequence markers", () => {
    // The ordinary path must be untouched by the split.
    expect(splitSequence("Remove the background")).toEqual(["Remove the background"]);
  });
});

describe("parseHexColor", () => {
  it("reads the forms a user or a swatch can supply", () => {
    expect(parseHexColor("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor("000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHexColor("#f00")).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHexColor("  #3B82F6  ")).toEqual({ r: 59, g: 130, b: 246 });
  });

  it("drops an alpha suffix rather than misreading the channels", () => {
    expect(parseHexColor("#ff000080")).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("returns null for anything it cannot read", () => {
    // The caller reports this to the user, so a wrong guess would silently
    // remove a colour nobody asked for.
    expect(parseHexColor("not a colour")).toBeNull();
    expect(parseHexColor("#12")).toBeNull();
    expect(parseHexColor("")).toBeNull();
  });
});
