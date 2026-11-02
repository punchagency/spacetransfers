import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { legalMarkupError, parseLegalMarkup } from "../utils/legalMarkup.js";
import { nextLegalVersion } from "../services/legal.service.js";
import { LEGAL_SEED } from "../config/legalSeed.js";

describe("the text legal documents are written in", () => {
  it("reads an introduction, headings, paragraphs and bullets in order", () => {
    const parsed = parseLegalMarkup(`Opening line one
continues here.

Second intro paragraph.

## 1. First
A paragraph.

- one
- two

After the list.

## 2. Second
- only bullets`);
    assert.deepEqual(parsed.intro, [
      { type: "p", text: "Opening line one continues here." },
      { type: "p", text: "Second intro paragraph." },
    ]);
    assert.deepEqual(parsed.sections, [
      { heading: "1. First", blocks: [{ type: "p", text: "A paragraph." }, { type: "ul", items: ["one", "two"] }, { type: "p", text: "After the list." }] },
      { heading: "2. Second", blocks: [{ type: "ul", items: ["only bullets"] }] },
    ]);
  });

  it("treats markup characters as text, never as code", () => {
    const parsed = parseLegalMarkup("## Title\n<script>alert(1)</script>");
    assert.equal((parsed.sections[0].blocks[0] as any).text, "<script>alert(1)</script>");
  });

  it("needs at least one section to publish", () => {
    assert.match(legalMarkupError("")!, /empty/);
    assert.match(legalMarkupError("Just a paragraph.")!, /section heading/);
    assert.equal(legalMarkupError("## 1. Heading\nText."), null);
  });

  it("parses every document's starting text and draft", () => {
    for (const [id, seed] of Object.entries(LEGAL_SEED)) {
      assert.equal(legalMarkupError(seed.published.body), null, id);
      if (seed.draft) assert.equal(legalMarkupError(seed.draft.body), null, id + " draft");
    }
  });
});

describe("version names", () => {
  const day = new Date("2026-10-16T15:00:00Z");
  it("are the publishing date, numbered when there are several that day", () => {
    assert.equal(nextLegalVersion(["2026-07-28"], day), "2026-10-16");
    assert.equal(nextLegalVersion(["2026-07-28", "2026-10-16"], day), "2026-10-16.2");
    assert.equal(nextLegalVersion(["2026-10-16", "2026-10-16.2"], day), "2026-10-16.3");
  });
});
