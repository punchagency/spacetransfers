/**
 * The rights check's rules, on recorded detector answers: no keys, no network.
 * Run with: npm test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { ipFinding, mergeFindings, verdictFor } from "../services/rights/findings.js";
import { visionFindings } from "../services/rights/vision.js";
import { claudeFindings } from "../services/rights/claude.js";
import { metadataFindings } from "../services/rights/metadata.js";
import { hashDistance, imageHash } from "../services/rights/imageHash.js";
import { termsIn } from "../services/rights/terms.js";
import { judgedFindings } from "../services/rights/screening.service.js";

describe("findings and verdicts", () => {
  it("names a finding by what it is about, so two detectors and one approval agree", () => {
    const merged = mergeFindings([
      ipFinding("logo", "Nike", "block", "vision", 0.93),
      ipFinding("brand", "Nike", "review", "claude", 0.7),
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, "ip:nike");
    assert.equal(merged[0].severity, "block");
    assert.deepEqual(merged[0].sources.sort(), ["claude", "vision"]);
    assert.equal(merged[0].score, 0.93);
  });

  it("keeps every field of a finding read back from the database", async () => {
    const { RightsScreen } = await import("../models/rightsScreen.model.js");
    const stored = new RightsScreen({ key: "k", findings: [ipFinding("stock", "Shutterstock", "review", "metadata")] });
    const [f] = mergeFindings(stored.findings);
    assert.equal(f.id, "stock:shutterstock");
    assert.equal(f.severity, "review");
    assert.equal(f.label, "Shutterstock (stock image)");
  });

  it("blocks a confident match, holds an uncertain one, and never stops on information", () => {
    const block = ipFinding("logo", "Nike", "block", "vision")!;
    const review = ipFinding("character", "Pikachu", "review", "claude")!;
    const info = ipFinding("metadata", "Copyright details in the file", "info", "metadata")!;
    assert.equal(verdictFor([block, review, info], new Set()), "blocked");
    assert.equal(verdictFor([review, info], new Set()), "review");
    assert.equal(verdictFor([info], new Set()), "clear");
  });

  it("clears only what an admin approved for this customer", () => {
    const nike = ipFinding("logo", "Nike", "block", "vision")!;
    const pikachu = ipFinding("character", "Pikachu", "review", "claude")!;
    assert.equal(verdictFor([nike, pikachu], new Set(["ip:nike"])), "review");
    assert.equal(verdictFor([nike, pikachu], new Set(["ip:nike", "ip:pikachu"])), "clear");
  });
});

describe("Google Vision answers", () => {
  it("blocks a confident logo, holds a weaker one, ignores a faint one", () => {
    const { findings } = visionFindings({
      logoAnnotations: [
        { description: "Nike", score: 0.91 },
        { description: "Adidas", score: 0.6 },
        { description: "Puma", score: 0.3 },
      ],
    });
    assert.deepEqual(
      findings.map((f) => [f.id, f.severity]),
      [["ip:nike", "block"], ["ip:adidas", "review"]],
    );
  });

  it("holds a picture that is on a stock library, and keeps text and names for the watch list", () => {
    const { findings, observedText } = visionFindings({
      webDetection: {
        fullMatchingImages: [{ url: "https://www.shutterstock.com/image-vector/cute-cat-123" }],
        webEntities: [{ description: "Mickey Mouse", score: 0.8 }, { description: "Noise", score: 0.1 }],
        bestGuessLabels: [{ label: "mickey mouse t-shirt" }],
      },
      textAnnotations: [{ description: "HAPPY BIRTHDAY" }],
    });
    assert.deepEqual(findings.map((f) => [f.id, f.severity]), [["stock:shutterstock", "review"]]);
    assert.match(observedText, /HAPPY BIRTHDAY/);
    assert.match(observedText, /Mickey Mouse/);
    assert.doesNotMatch(observedText, /Noise/);
  });
});

describe("Claude's answers", () => {
  it("blocks a recognised character or brand it's sure of, holds artwork and stock for a person", () => {
    const { findings } = claudeFindings({
      findings: [
        { kind: "character", name: "Mickey Mouse", confidence: 0.95, evidence: "Round ears, red shorts" },
        { kind: "team", name: "Dallas Cowboys", confidence: 0.6, evidence: "Star logo" },
        { kind: "artwork", name: "The Starry Night", confidence: 0.97, evidence: "Swirling sky" },
        { kind: "stock", name: "Shutterstock", confidence: 0.9, evidence: "Watermark" },
        { kind: "logo", name: "Faint", confidence: 0.2, evidence: "" },
        { kind: "person", name: "Someone", confidence: 0.99, evidence: "" },
      ],
    });
    assert.deepEqual(
      findings.map((f) => [f.id, f.severity]),
      [
        ["ip:mickey-mouse", "block"],
        ["ip:dallas-cowboys", "review"],
        ["ip:the-starry-night", "review"],
        ["stock:shutterstock", "review"],
      ],
    );
  });

  it("finds nothing in an empty answer", () => {
    assert.deepEqual(claudeFindings({ findings: [] }).findings, []);
    assert.deepEqual(claudeFindings(null).findings, []);
  });
});

describe("the file's own details", () => {
  it("holds a stock library's image and records any other copyright line as information", () => {
    const xmp = `<x:xmpmeta><dc:rights><rdf:Alt><rdf:li>© Jane Doe 2026</rdf:li></rdf:Alt></dc:rights><photoshop:Credit>Getty Images</photoshop:Credit></x:xmpmeta>`;
    const findings = metadataFindings(xmp);
    assert.deepEqual(findings.map((f) => [f.id, f.severity]), [["stock:getty-images", "review"], ["meta:copyright-details-in-the-file", "info"]]);
    assert.match(findings[1].detail || "", /Jane Doe/);
  });

  it("says nothing about a file with no such details", () => {
    assert.deepEqual(metadataFindings(""), []);
    assert.deepEqual(metadataFindings("Exif MM camera Canon"), []);
  });
});

describe("rules admins keep", () => {
  const picture = async (shade: number, size = 300) =>
    sharp({ create: { width: size, height: size, channels: 3, background: { r: shade, g: shade, b: shade } } })
      .composite([{ input: Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 3}" cy="${size / 2}" r="${size / 4}" fill="black"/></svg>`) }])
      .png()
      .toBuffer();

  it("recognises the same picture resized, and not a different one", async () => {
    const a = await imageHash(await picture(230, 300));
    const resized = await imageHash(await sharp(await picture(230, 300)).resize(120).png().toBuffer());
    const other = await imageHash(await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 20, g: 200, b: 40 } } }).composite([{ input: Buffer.from('<svg width="300" height="300"><rect x="150" y="0" width="150" height="300" fill="white"/></svg>') }]).png().toBuffer());
    assert.ok(hashDistance(a, resized) <= 6, `resized copy differs by ${hashDistance(a, resized)} bits`);
    assert.ok(hashDistance(a, other) > 6, `different picture differs by only ${hashDistance(a, other)} bits`);
  });

  it("blocks an image an admin blocked, and holds names on the watch list", () => {
    const findings = judgedFindings(
      { findings: [], dhash: "ffff0000ffff0000", observedText: "Official NBA merch\nsomething else" },
      { images: [{ id: "r1", dhash: "ffff0000ffff0001", note: "Rejected: no licence" }], terms: ["Acme Rockets"] },
    );
    assert.deepEqual(findings.map((f) => [f.id, f.severity]), [["image:r1", "block"], ["ip:nba", "review"]]);
    const custom = judgedFindings({ findings: [], dhash: undefined, observedText: "ACME ROCKETS team" }, { images: [], terms: ["Acme Rockets"] });
    assert.deepEqual(custom.map((f) => f.id), ["ip:acme-rockets"]);
  });

  it("matches watch terms as whole words only", () => {
    assert.deepEqual(termsIn("Mickey Mouse party", ["Mickey Mouse"]), ["Mickey Mouse"]);
    assert.deepEqual(termsIn("NBAX club", ["NBA"]), []);
    assert.deepEqual(termsIn("I love Pokémon", ["Pokémon"]), ["Pokémon"]);
  });
});
