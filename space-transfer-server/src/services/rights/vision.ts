import sharp from "sharp";
import { env } from "../../config/env.js";
import { fetchWithTimeout } from "../../utils/fetchWithTimeout.js";
import type { RightsFinding } from "../../models/rightsScreen.model.js";
import { ipFinding, LOGO_BLOCK, LOGO_REVIEW, stockAgencyIn } from "./findings.js";

/**
 * Google Cloud Vision: three checks in one request, each billed per image.
 *
 * - Logo detection recognises known brands' logos with a confidence score.
 * - Web detection finds where the picture appears online and what Google takes
 *   it to be; a copy on a stock library is held for review.
 * - Text detection reads the words, which are matched against the watch list
 *   when the image is judged (see the screening service).
 */

export const isVisionConfigured = () => Boolean(env.googleVisionApiKey);

export interface VisionResult {
  findings: RightsFinding[];
  /** Text and recognised names, kept for the watch list. */
  observedText: string;
}

/** The findings in a Vision response; separate from the call so it can be tested on recorded answers. */
export const visionFindings = (response: any): VisionResult => {
  const out: (RightsFinding | null)[] = [];
  for (const logo of response?.logoAnnotations ?? []) {
    const score = Number(logo?.score) || 0;
    const name = String(logo?.description || "").trim();
    if (!name || score < LOGO_REVIEW) continue;
    out.push(ipFinding("logo", name, score >= LOGO_BLOCK ? "block" : "review", "vision", score, `Google recognised the ${name} logo.`));
  }
  const web = response?.webDetection ?? {};
  const pages = [...(web.fullMatchingImages ?? []), ...(web.pagesWithMatchingImages ?? [])];
  for (const page of pages) {
    const agency = stockAgencyIn(String(page?.url || ""));
    if (agency) {
      out.push(ipFinding("stock", agency, "review", "vision", undefined, `The same picture is on ${agency}: ${String(page.url).slice(0, 200)}`));
      break;
    }
  }
  const names = [
    ...(web.webEntities ?? []).filter((e: any) => (Number(e?.score) || 0) >= 0.5).map((e: any) => String(e?.description || "")),
    ...(web.bestGuessLabels ?? []).map((l: any) => String(l?.label || "")),
  ].filter(Boolean);
  const text = String(response?.textAnnotations?.[0]?.description || response?.fullTextAnnotation?.text || "");
  return { findings: out.filter((f): f is RightsFinding => Boolean(f)), observedText: [text, ...names].join("\n").slice(0, 5000) };
};

export const runVision = async (buffer: Buffer): Promise<VisionResult> => {
  // Laid on grey so white artwork shows, and sized down: the checks don't need print resolution.
  const image = await sharp(buffer, { limitInputPixels: false })
    .flatten({ background: "#808080" })
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  const res = await fetchWithTimeout(
    `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(env.googleVisionApiKey || "")}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: image.toString("base64") },
            features: [
              { type: "LOGO_DETECTION", maxResults: 10 },
              { type: "WEB_DETECTION", maxResults: 10 },
              { type: "TEXT_DETECTION", maxResults: 1 },
            ],
          },
        ],
      }),
    },
    20_000,
    "Google Vision",
  );
  const body: any = await res.json().catch(() => null);
  const answer = body?.responses?.[0];
  if (!res.ok || !answer || answer.error) {
    throw new Error(`Google Vision: ${answer?.error?.message || body?.error?.message || `HTTP ${res.status}`}`);
  }
  return visionFindings(answer);
};
