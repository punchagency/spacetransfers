import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { env } from "../../config/env.js";
import type { FindingKind, RightsFinding } from "../../models/rightsScreen.model.js";
import { CLAUDE_BLOCK, CLAUDE_REVIEW, ipFinding } from "./findings.js";

/**
 * Claude looks at the artwork the way a person reviewing an order would, and
 * names any third-party brand, character, team or work it recognises. It
 * catches what a logo catalogue misses: stylised fan art, characters, team
 * marks redrawn by hand, a stock library's watermark.
 */

export const isClaudeConfigured = () => Boolean(env.anthropicApiKey);

const KINDS = ["logo", "character", "brand", "team", "artwork", "stock"] as const;

const SYSTEM = `You review artwork a customer uploaded to be printed as a DTF transfer for clothing and sold or worn.

Report every piece of third-party intellectual property you can recognise in the image:
- logo: a company's or organisation's logo or emblem
- brand: a brand name or wordmark, or a brand's distinctive design
- character: a character from film, TV, games, comics, anime or toys
- team: a sports team's or league's name, logo or crest
- artwork: a famous artwork, film poster, album cover or other recognisable published work
- stock: a stock library's watermark, or a picture clearly taken from a stock library

Give each by its common name only, for example "Nike", "Mickey Mouse", "Dallas Cowboys", not a description. Confidence is from 0 to 1: how sure you are that it is that brand, character, team or work.

Report only what is actually there and recognisable. Generic shapes, generic words, and original designs are not findings, and neither is a style that merely resembles something. Never identify a real person from their face. If you recognise nothing, return an empty list.`;

const SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...KINDS] },
          name: { type: "string" },
          confidence: { type: "number" },
          evidence: { type: "string" },
        },
        required: ["kind", "name", "confidence", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
};

/** The findings in Claude's answer; separate from the call so it can be tested on recorded answers. */
export const claudeFindings = (answer: any): { findings: RightsFinding[]; observedText: string } => {
  const out: RightsFinding[] = [];
  const names: string[] = [];
  for (const item of Array.isArray(answer?.findings) ? answer.findings : []) {
    const kind = String(item?.kind || "") as (typeof KINDS)[number];
    const name = String(item?.name || "").trim();
    const confidence = Math.min(1, Math.max(0, Number(item?.confidence) || 0));
    if (!KINDS.includes(kind) || !name || confidence < CLAUDE_REVIEW) continue;
    names.push(name);
    // Recognised identity marks are blocked when Claude is sure; artwork and
    // stock are always held for a person, since licences for them are common.
    const blockable = kind === "logo" || kind === "brand" || kind === "character" || kind === "team";
    const severity = blockable && confidence >= CLAUDE_BLOCK ? "block" : "review";
    const finding = ipFinding(kind as FindingKind, name, severity, "claude", confidence, String(item?.evidence || "").trim());
    if (finding) out.push(finding);
  }
  return { findings: out, observedText: names.join("\n") };
};

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: 1, timeout: 45_000 }));

/** Opus and Sonnet 5.5 accept the server-side fallback for a declined request; Haiku doesn't. */
const takesFallback = (model: string) => /opus|sonnet-5-5|fable/.test(model);

export const runClaude = async (buffer: Buffer) => {
  const image = await sharp(buffer, { limitInputPixels: false })
    .flatten({ background: "#808080" })
    .resize(1568, 1568, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  const model = env.rightsClaudeModel;
  const response = await anthropic().beta.messages.create({
    model,
    max_tokens: 4000,
    ...(takesFallback(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    // A classification: thorough thinking adds cost without changing the answer.
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.toString("base64") } },
          { type: "text", text: "Review this artwork." },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to review the image");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("Claude returned no answer");
  return claudeFindings(JSON.parse(text.text));
};
