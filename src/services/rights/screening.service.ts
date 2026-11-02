import crypto from "node:crypto";
import mongoose from "mongoose";
import { RightsScreen, type IRightsScreen, type RightsFinding } from "../../models/rightsScreen.model.js";
import { RightsDispute } from "../../models/rightsDispute.model.js";
import { RightsRule } from "../../models/rightsRule.model.js";
import { fetchImageBuffer } from "../../controllers/customer/shared.js";
import { reportJobError } from "../monitoring.service.js";
import { metadataFindings, metadataText } from "./metadata.js";
import { hashDistance, imageHash } from "./imageHash.js";
import { isVisionConfigured, runVision } from "./vision.js";
import { isClaudeConfigured, runClaude } from "./claude.js";
import { DEFAULT_WATCH_TERMS, termsIn } from "./terms.js";
import { ipFinding, mergeFindings, outstandingFindings, SAME_IMAGE_DISTANCE, verdictFor, type RightsVerdict } from "./findings.js";

/**
 * The rights check: whether an image carries a third-party brand, character,
 * team or work, and what that means for the customer printing it.
 *
 * Layers, each optional and each adding findings:
 *   metadata  the file's own copyright and source fields (always)
 *   hash      a fingerprint matched against images admins blocked (always)
 *   vision    Google Cloud Vision: logos, the picture on the web, its text
 *   claude    Claude: brands, characters and teams a catalogue would miss
 * plus the watch list of names, matched against the text and names found.
 *
 * Screening is per image and cached by its bytes; judging is per customer,
 * because an admin's approval belongs to the customer who proved their rights.
 */

export const RIGHTS_VERSION = 1;

type Check = "metadata" | "hash" | "vision" | "claude";

export const rightsChecks = () => ({ vision: isVisionConfigured(), claude: isClaudeConfigured() });

const wantedChecks = (): Check[] => ["metadata", "hash", ...(isVisionConfigured() ? ["vision" as const] : []), ...(isClaudeConfigured() ? ["claude" as const] : [])];

const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

/** Whether a stored screen predates the current rules or lacks a check that is now switched on. */
export const needsScreening = (screen: Pick<IRightsScreen, "version" | "checks" | "failed"> | null): boolean =>
  !screen || screen.version !== RIGHTS_VERSION || screen.failed.length > 0 || wantedChecks().some((c) => !screen.checks.includes(c));

const runCheck = async (check: Check, buffer: Buffer): Promise<{ findings: RightsFinding[]; observedText?: string; dhash?: string }> => {
  switch (check) {
    case "metadata":
      return { findings: metadataFindings(await metadataText(buffer)) };
    case "hash":
      return { findings: [], dhash: await imageHash(buffer) };
    case "vision":
      return runVision(buffer);
    case "claude":
      return runClaude(buffer);
  }
};

const inFlight = new Map<string, Promise<IRightsScreen>>();

/**
 * Screens an image, running only the checks it hasn't had. `sourceText` is the
 * readable metadata of the file the customer chose, read in the browser before
 * conversion stripped it; it can only add findings, never remove one.
 */
export const screenImage = (buffer: Buffer, opts: { urls?: string[]; sourceText?: string } = {}): Promise<IRightsScreen> => {
  const key = sha256(buffer);
  const urls = (opts.urls || []).filter((u) => typeof u === "string" && /^https?:\/\//.test(u));
  const extra = metadataFindings(String(opts.sourceText || "").slice(0, 20000));
  const running = inFlight.get(key);
  const work = (running || doScreen(key, buffer)).then((screen) => attach(screen, urls, extra));
  if (!running) {
    const settle = work.finally(() => inFlight.delete(key));
    inFlight.set(key, settle);
    settle.catch(() => {});
  }
  return work;
};

const doScreen = async (key: string, buffer: Buffer): Promise<IRightsScreen> => {
  const existing = await RightsScreen.findOne({ key });
  if (existing && !needsScreening(existing)) return existing;
  const stale = !existing || existing.version !== RIGHTS_VERSION;
  const todo = wantedChecks().filter((c) => stale || !existing!.checks.includes(c) || existing!.failed.includes(c));
  const results = await Promise.allSettled(todo.map((c) => runCheck(c, buffer)));

  const keepFrom = (stale ? [] : existing!.findings).filter((f) => !f.sources.every((s) => todo.includes(s as Check)));
  const findings: RightsFinding[] = [...keepFrom];
  const observed: string[] = stale ? [] : [existing!.observedText || ""];
  const checks = new Set<string>(stale ? [] : existing!.checks.filter((c) => !todo.includes(c as Check)));
  const failed: string[] = [];
  let dhash = stale ? undefined : existing!.dhash;
  results.forEach((r, i) => {
    const check = todo[i];
    if (r.status === "fulfilled") {
      findings.push(...r.value.findings);
      if (r.value.observedText) observed.push(r.value.observedText);
      if (r.value.dhash) dhash = r.value.dhash;
      checks.add(check);
    } else {
      failed.push(check);
      reportJobError(`RIGHTS_${check.toUpperCase()}`, r.reason);
    }
  });
  return (await RightsScreen.findOneAndUpdate(
    { key },
    {
      $set: {
        findings: mergeFindings(findings),
        observedText: observed.filter(Boolean).join("\n").slice(0, 10000),
        checks: [...checks],
        failed,
        version: RIGHTS_VERSION,
        ...(dhash ? { dhash } : {}),
      },
    },
    { upsert: true, new: true },
  ))!;
};

const attach = async (screen: IRightsScreen, urls: string[], extra: RightsFinding[]): Promise<IRightsScreen> => {
  const newUrls = urls.filter((u) => !screen.urls.includes(u));
  const newFindings = extra.filter((f) => !screen.findings.some((g) => g.id === f.id));
  if (!newUrls.length && !newFindings.length) return screen;
  return (
    (await RightsScreen.findByIdAndUpdate(
      screen._id,
      { $addToSet: { urls: { $each: newUrls } }, ...(newFindings.length ? { $set: { findings: mergeFindings([...screen.findings, ...newFindings]) } } : {}) },
      { new: true },
    )) || screen
  );
};

// ── Rules admins keep ────────────────────────────────────────────────────────

interface Rules {
  images: { id: string; dhash: string; note: string }[];
  terms: string[];
}
let rules: { at: number; value: Rules } | null = null;

/** Called whenever an admin changes a rule, so it applies at once. */
export const forgetRules = () => {
  rules = null;
};

const currentRules = async (): Promise<Rules> => {
  if (rules && Date.now() - rules.at < 60_000) return rules.value;
  const all = await RightsRule.find({}).select("kind dhash term note").lean();
  const value: Rules = {
    images: all.filter((r) => r.kind === "image" && r.dhash).map((r) => ({ id: String(r._id), dhash: String(r.dhash), note: String(r.note || "") })),
    terms: all.filter((r) => r.kind === "term" && r.term).map((r) => String(r.term)),
  };
  rules = { at: Date.now(), value };
  return value;
};

/** A screen's findings with the admins' rules applied: blocked images and the watch list. */
export const judgedFindings = (screen: Pick<IRightsScreen, "findings" | "dhash" | "observedText">, r: Rules): RightsFinding[] => {
  const extra: (RightsFinding | null)[] = [];
  if (screen.dhash) {
    for (const rule of r.images) {
      if (hashDistance(screen.dhash, rule.dhash) <= SAME_IMAGE_DISTANCE) {
        extra.push({
          id: `image:${rule.id}`,
          kind: "known_image",
          label: "An image Space Transfers has blocked",
          severity: "block",
          sources: ["blocklist"],
          ...(rule.note ? { detail: rule.note } : {}),
        });
      }
    }
  }
  for (const term of termsIn(screen.observedText || "", [...DEFAULT_WATCH_TERMS, ...r.terms])) {
    extra.push(ipFinding("text", term, "review", "terms", undefined, `“${term}” appears in the artwork or in what it was recognised as.`));
  }
  return mergeFindings([...screen.findings, ...extra]);
};

// ── One customer ─────────────────────────────────────────────────────────────

/** Findings an admin approved for this customer, from their approved disputes. */
export const approvalsFor = async (userId: string | null | undefined): Promise<Set<string>> => {
  if (!userId || !mongoose.isValidObjectId(userId)) return new Set();
  const approved = await RightsDispute.find({ user: userId, status: "approved" }).select("decision.approvedFindings").lean();
  return new Set(approved.flatMap((d: any) => d.decision?.approvedFindings || []));
};

export interface ImageCheck {
  url: string;
  verdict: RightsVerdict | "unchecked";
  /** What still stands for this customer; information included, approvals left out. */
  findings: RightsFinding[];
  /** Findings an admin approved for this customer that this image carries. */
  approved: RightsFinding[];
  screenId?: string;
  /** A check that should have run but failed, so the result rests on fewer layers. */
  incomplete: boolean;
  dispute?: { id: string; status: string };
}

const describe = (screen: IRightsScreen, url: string, r: Rules, approved: Set<string>, dispute?: { id: string; status: string }): ImageCheck => {
  const all = judgedFindings(screen, r);
  return {
    url,
    verdict: verdictFor(all, approved),
    findings: [...outstandingFindings(all, approved), ...all.filter((f) => f.severity === "info")],
    approved: all.filter((f) => f.severity !== "info" && approved.has(f.id)),
    screenId: String(screen._id),
    incomplete: screen.failed.length > 0,
    ...(dispute ? { dispute } : {}),
  };
};

const disputesFor = async (userId: string | null | undefined, screenIds: string[]) => {
  const map = new Map<string, { id: string; status: string }>();
  if (!userId || !mongoose.isValidObjectId(userId) || !screenIds.length) return map;
  const list = await RightsDispute.find({ user: userId, screen: { $in: screenIds } }).sort({ createdAt: 1 }).select("screen status").lean();
  for (const d of list as any[]) map.set(String(d.screen), { id: String(d._id), status: String(d.status) });
  return map;
};

/** The verdict for one image just uploaded or made, for this customer. */
export const judgeScreen = async (screen: IRightsScreen, url: string, userId?: string | null): Promise<ImageCheck> => {
  const [r, approved, disputes] = await Promise.all([currentRules(), approvalsFor(userId), disputesFor(userId, [String(screen._id)])]);
  return describe(screen, url, r, approved, disputes.get(String(screen._id)));
};

/**
 * Judges a set of images for a customer, screening any not yet screened (or
 * screened before a check was switched on). Used before payment and before an
 * order is saved, so nothing the customer hasn't been cleared for is printed.
 */
export const checkImages = async (
  userId: string | null | undefined,
  rawUrls: string[],
  opts: { screenMissing?: boolean } = {},
): Promise<ImageCheck[]> => {
  const screenMissing = opts.screenMissing !== false;
  const urls = [...new Set(rawUrls.filter((u) => typeof u === "string" && u))].slice(0, 300);
  const screens = new Map<string, IRightsScreen | null>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < urls.length) {
      const url = urls[cursor++];
      if (!/^https?:\/\//.test(url)) {
        screens.set(url, null);
        continue;
      }
      let screen: IRightsScreen | null = await RightsScreen.findOne({ urls: url });
      if (screenMissing && needsScreening(screen)) {
        try {
          screen = await screenImage(await fetchImageBuffer(url), { urls: [url] });
        } catch (err) {
          reportJobError("RIGHTS_FETCH", err);
        }
      }
      screens.set(url, screen);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, urls.length) }, worker));
  const ids = [...screens.values()].filter(Boolean).map((s) => String(s!._id));
  const [r, approved, disputes] = await Promise.all([currentRules(), approvalsFor(userId), disputesFor(userId, ids)]);
  return urls.map((url) => {
    const screen = screens.get(url);
    if (!screen) return { url, verdict: "unchecked" as const, findings: [], approved: [], incomplete: true };
    return describe(screen, url, r, approved, disputes.get(String(screen._id)));
  });
};

/** The images that would stop checkout, with what stops each. */
export const stoppedImages = (checks: ImageCheck[]) => checks.filter((c) => c.verdict !== "clear");

export const RIGHTS_STOP_MESSAGE =
  "Some artwork can't be printed until it's removed or cleared: it looks like it may include a brand, character or other work you'd need the rights to print.";

/**
 * Screens an upload within a time limit. Past it the upload answers "pending"
 * and the screen carries on; checkout picks up the result.
 */
export const screenUpload = async (
  buffer: Buffer,
  urls: string[],
  userId: string | null | undefined,
  sourceText?: string,
  timeoutMs = 20_000,
): Promise<ImageCheck | { url: string; verdict: "pending" }> => {
  const work = screenImage(buffer, { urls, sourceText }).then((screen) => judgeScreen(screen, urls[0], userId));
  work.catch((err) => reportJobError("RIGHTS_UPLOAD", err));
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<{ url: string; verdict: "pending" }>((resolve) => {
    timer = setTimeout(() => resolve({ url: urls[0], verdict: "pending" }), timeoutMs);
  });
  try {
    return await Promise.race([work, late]);
  } catch {
    return { url: urls[0], verdict: "pending" };
  } finally {
    clearTimeout(timer);
  }
};

/** What a partner and admin see about an order's artwork, recorded when it was placed. */
export const orderRightsRecord = async (userId: string, checks: ImageCheck[], attested: boolean) => {
  const approvedIds = [...new Set(checks.flatMap((c) => c.approved.map((f) => f.id)))];
  const decisions = approvedIds.length
    ? await RightsDispute.find({ user: userId, status: "approved", "decision.approvedFindings": { $in: approvedIds } })
        .select("decision")
        .lean()
    : [];
  const decisionFor = (id: string) => (decisions as any[]).find((d) => d.decision?.approvedFindings?.includes(id))?.decision;
  return {
    checkedAt: new Date(),
    attestedAt: attested ? new Date() : null,
    checks: Object.entries(rightsChecks()).filter(([, on]) => on).map(([k]) => k),
    images: checks.map((c) => ({
      url: c.url,
      verdict: c.approved.length ? "approved" : "clear",
      incomplete: c.incomplete,
      approvals: c.approved.map((f) => {
        const d = decisionFor(f.id);
        return { id: f.id, label: f.label, byName: d?.byName || "", at: d?.at || null, note: d?.note || "" };
      }),
      notes: c.findings.filter((f) => f.severity === "info").map((f) => f.detail || f.label),
    })),
  };
};

/** The verdict for an image already stored, within a time limit (see `screenUpload`). */
export const checkStoredWithin = async (url: string, userId: string | null | undefined, timeoutMs = 20_000) => {
  const work = checkImages(userId, [url]).then((r) => r[0]);
  work.catch((err) => reportJobError("RIGHTS_UPLOAD", err));
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<{ url: string; verdict: "pending" }>((resolve) => {
    timer = setTimeout(() => resolve({ url, verdict: "pending" }), timeoutMs);
  });
  try {
    return await Promise.race([work, late]);
  } catch {
    return { url, verdict: "pending" as const };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * The partner's check: an order's artwork judged again against today's rules,
 * so an image blocked after the order was placed is caught before it is
 * printed. Uses the screens already made; admins are told once.
 */
export const recheckOrderRights = async (order: any) => {
  // Everything the order prints and the originals, whatever the record lists.
  const urls: string[] = [
    ...(order?.items || []).flatMap((it: any) => (it.artboardItems || []).flatMap((a: any) => [a.croppedUrl, a.assetId])),
    ...(order?.rights?.images || []).map((i: any) => i.url),
  ];
  const checks = await checkImages(order?.user ? String(order.user) : null, urls.filter(Boolean), { screenMissing: false });
  const flagged = checks
    .filter((c) => c.verdict === "blocked" || c.verdict === "review")
    .map((c) => ({ url: c.url, verdict: c.verdict, findings: c.findings.filter((f) => f.severity !== "info").map((f) => f.label) }));
  if (flagged.length && !order?.rightsAlertedAt && order?._id) {
    const { Order } = await import("../../models/order.model.js");
    const { notifyAllAdmins } = await import("../adminNotifications.service.js");
    const marked = await Order.updateOne({ _id: order._id, rightsAlertedAt: null }, { $set: { rightsAlertedAt: new Date() } });
    if (marked.modifiedCount) {
      notifyAllAdmins({
        category: "orders",
        priority: "high",
        title: "Artwork flagged after the order was placed",
        message: `${order.displayId}: ${flagged.flatMap((f) => f.findings).join(", ") || "an image"} is now held by the rights check. Check it before it's printed.`.slice(0, 280),
        meta: { orderId: String(order._id), type: "rights_recheck" },
      }).catch(() => {});
    }
  }
  return { checkedAt: new Date(), flagged };
};
