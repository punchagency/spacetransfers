import type { FindingKind, FindingSeverity, FindingSource, RightsFinding } from "../../models/rightsScreen.model.js";

/**
 * The rights check's rules: how a detector's observation becomes a finding,
 * how findings combine, and what they mean for one customer.
 *
 * A finding is identified by what it is about, not by who saw it: the Nike logo
 * found by Google and the word "Nike" read by Claude are both `ip:nike`, so one
 * approval covers both, and the customer's licence for Nike covers Nike in any
 * of their images.
 */

export type RightsVerdict = "clear" | "review" | "blocked";

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const KIND_WORD: Record<FindingKind, string> = {
  logo: "logo",
  character: "character",
  brand: "brand",
  team: "team",
  artwork: "artwork",
  stock: "stock image",
  text: "name in the text",
  known_image: "image blocked by Space Transfers",
  metadata: "file details",
};

/** A finding about third-party IP, identified by the name of the brand, character or work. */
export const ipFinding = (
  kind: FindingKind,
  name: string,
  severity: FindingSeverity,
  source: FindingSource,
  score?: number,
  detail?: string,
): RightsFinding | null => {
  const id = slug(name);
  if (!id) return null;
  return {
    id: kind === "stock" ? `stock:${id}` : kind === "known_image" ? `image:${id}` : kind === "metadata" ? `meta:${id}` : `ip:${id}`,
    kind,
    label: kind === "known_image" || kind === "metadata" ? name : `${name} (${KIND_WORD[kind]})`,
    severity,
    sources: [source],
    ...(typeof score === "number" && Number.isFinite(score) ? { score: Math.round(score * 100) / 100 } : {}),
    ...(detail ? { detail: detail.slice(0, 300) } : {}),
  };
};

const RANK: Record<FindingSeverity, number> = { info: 0, review: 1, block: 2 };

/** A finding as a plain object: one read from the database is a sub-document, whose fields a spread doesn't copy. */
const plain = (f: any): RightsFinding => (f && typeof f.toObject === "function" ? f.toObject() : f);

/** One finding per id: the strongest severity and score, every source that saw it. */
export const mergeFindings = (findings: (RightsFinding | null | undefined)[]): RightsFinding[] => {
  const byId = new Map<string, RightsFinding>();
  for (const raw of findings) {
    if (!raw) continue;
    const f = plain(raw);
    const had = byId.get(f.id);
    if (!had) {
      byId.set(f.id, { ...f, sources: [...f.sources] });
      continue;
    }
    const stronger = RANK[f.severity] > RANK[had.severity] ? f : had;
    byId.set(f.id, {
      ...stronger,
      sources: [...new Set([...had.sources, ...f.sources])],
      ...(Math.max(had.score ?? -1, f.score ?? -1) >= 0 ? { score: Math.max(had.score ?? 0, f.score ?? 0) } : {}),
      detail: stronger.detail || had.detail || f.detail,
    });
  }
  return [...byId.values()].sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.label.localeCompare(b.label));
};

/** The findings that still stand for a customer, given what an admin approved for them. */
export const outstandingFindings = (findings: RightsFinding[], approved: Set<string>): RightsFinding[] =>
  findings.filter((f) => f.severity !== "info" && !approved.has(f.id));

/**
 * Confident matches are blocked, uncertain ones held for review, and both stop
 * checkout until the image is removed or an admin approves it. Information
 * (a copyright line in the file's details) is shown but never stops anyone.
 */
export const verdictFor = (findings: RightsFinding[], approved: Set<string>): RightsVerdict => {
  const open = outstandingFindings(findings, approved);
  if (open.some((f) => f.severity === "block")) return "blocked";
  if (open.length) return "review";
  return "clear";
};

// ── Thresholds ───────────────────────────────────────────────────────────────

/** Google Vision's logo score above which a match is treated as certain. */
export const LOGO_BLOCK = 0.75;
export const LOGO_REVIEW = 0.5;
/** Claude's confidence above which a recognised brand, character or team is blocked. */
export const CLAUDE_BLOCK = 0.85;
export const CLAUDE_REVIEW = 0.5;
/** Bits of a 64-bit perceptual hash that may differ for two images to be the same picture. */
export const SAME_IMAGE_DISTANCE = 6;

/** Stock libraries: their licences rarely allow printing on goods for sale. */
export const STOCK_AGENCIES: { name: string; pattern: RegExp }[] = [
  { name: "Shutterstock", pattern: /shutterstock/i },
  { name: "Getty Images", pattern: /getty ?images|gettyimages/i },
  { name: "iStock", pattern: /istock(photo)?/i },
  { name: "Adobe Stock", pattern: /adobe ?stock|stock\.adobe\.com|fotolia/i },
  { name: "Alamy", pattern: /alamy/i },
  { name: "Depositphotos", pattern: /depositphotos/i },
  { name: "Dreamstime", pattern: /dreamstime/i },
  { name: "123RF", pattern: /123rf/i },
  { name: "Freepik", pattern: /freepik/i },
  { name: "Vecteezy", pattern: /vecteezy/i },
  { name: "Envato", pattern: /envato/i },
  { name: "Pond5", pattern: /pond5/i },
  { name: "Bigstock", pattern: /bigstock/i },
  { name: "Creative Market", pattern: /creativemarket|creative market/i },
];

export const stockAgencyIn = (text: string): string | null => STOCK_AGENCIES.find((a) => a.pattern.test(text))?.name ?? null;
