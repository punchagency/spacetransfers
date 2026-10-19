import { LegalDocumentModel } from "../models/legalDocument.model.js";
import { LEGAL_SEED, type LegalDocId } from "../config/legalSeed.js";
import { legalMarkupError } from "../utils/legalMarkup.js";

/**
 * The legal documents as the platform serves them: the current published
 * version of each, the admin's draft, and the history.
 */

export const LEGAL_DOC_IDS: LegalDocId[] = ["terms", "privacy", "content-policy"];
export const isLegalDocId = (value: unknown): value is LegalDocId => LEGAL_DOC_IDS.includes(value as LegalDocId);

/** The keys sign-ups use for each document's version. */
const VERSION_KEY: Record<LegalDocId, "terms" | "privacy" | "contentPolicy"> = {
  terms: "terms",
  privacy: "privacy",
  "content-policy": "contentPolicy",
};

const httpError = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

/** The version a document published on `today` gets: the date, then ".2", ".3" for more that day. */
export const nextLegalVersion = (existing: string[], today: Date): string => {
  const date = today.toISOString().slice(0, 10);
  if (!existing.includes(date)) return date;
  let n = 2;
  while (existing.includes(`${date}.${n}`)) n += 1;
  return `${date}.${n}`;
};

export interface CurrentLegalDocument {
  id: LegalDocId;
  title: string;
  version: string;
  isDraft: boolean;
  url: string;
  publishedAt: Date;
}

let seeded = false;
/** Writes the starting text the first time, so there is always a published version. */
const ensureSeeded = async () => {
  if (seeded) return;
  for (const docId of LEGAL_DOC_IDS) {
    const seed = LEGAL_SEED[docId];
    if (!(await LegalDocumentModel.exists({ docId, status: "published" }))) {
      const created = await LegalDocumentModel.create({
        docId,
        status: "published",
        title: seed.title,
        version: seed.published.version,
        isDraft: seed.published.isDraft,
        body: seed.published.body,
        note: "The wording in use when documents moved into the console.",
        byName: "Space Transfers",
      }).catch((err: any) => {
        if (err?.code !== 11000) throw err;
        return null;
      });
      // Dated when it took effect, not when it was copied here.
      if (created) {
        const effective = new Date(`${seed.published.version}T00:00:00Z`);
        await LegalDocumentModel.updateOne({ _id: created._id }, { $set: { createdAt: effective, updatedAt: effective } }, { timestamps: false });
      }
      if (seed.draft && !(await LegalDocumentModel.exists({ docId, status: "draft" }))) {
        await LegalDocumentModel.create({
          docId,
          status: "draft",
          title: seed.title,
          isDraft: seed.draft.isDraft,
          body: seed.draft.body,
          note: "First full draft, for counsel to review.",
          byName: "Space Transfers",
        }).catch((err: any) => {
          if (err?.code !== 11000) throw err;
        });
      }
    }
  }
  seeded = true;
};

let cache: { at: number; docs: CurrentLegalDocument[] } | null = null;
const CACHE_MS = 60_000;

export const getCurrentLegalDocuments = async (): Promise<CurrentLegalDocument[]> => {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.docs;
  await ensureSeeded();
  const docs: CurrentLegalDocument[] = [];
  for (const docId of LEGAL_DOC_IDS) {
    const current = await LegalDocumentModel.findOne({ docId, status: "published" }).sort({ createdAt: -1 }).lean();
    if (!current) throw httpError("Legal documents are unavailable.", 503);
    docs.push({
      id: docId,
      title: current.title,
      version: String(current.version),
      isDraft: Boolean(current.isDraft),
      url: `/legal/${docId}`,
      publishedAt: current.createdAt,
    });
  }
  cache = { at: Date.now(), docs };
  return docs;
};

/** The versions a sign-up must have seen, keyed as the acceptance record keys them. */
export const getCurrentLegalVersions = async (): Promise<{ terms: string; privacy: string; contentPolicy: string }> => {
  const docs = await getCurrentLegalDocuments();
  const out: any = {};
  for (const doc of docs) out[VERSION_KEY[doc.id]] = doc.version;
  return out;
};

/** A published version's full text; the current one when no version is named. */
export const getPublishedLegalDocument = async (docId: LegalDocId, version?: string) => {
  await ensureSeeded();
  const query: Record<string, unknown> = { docId, status: "published" };
  if (version) query.version = version;
  const doc = await LegalDocumentModel.findOne(query).sort({ createdAt: -1 }).lean();
  if (!doc) throw httpError("That version of the document doesn't exist.", 404);
  return {
    id: docId,
    title: doc.title,
    version: String(doc.version),
    isDraft: Boolean(doc.isDraft),
    body: doc.body,
    publishedAt: doc.createdAt,
  };
};

/** Everything an admin needs to edit one document. */
export const getLegalDocumentForAdmin = async (docId: LegalDocId) => {
  await ensureSeeded();
  const [current] = await LegalDocumentModel.find({ docId, status: "published" }).sort({ createdAt: -1 }).limit(1).lean();
  const draft = await LegalDocumentModel.findOne({ docId, status: "draft" }).lean();
  const history = await LegalDocumentModel.find({ docId, status: "published" })
    .sort({ createdAt: -1 })
    .select("version isDraft note byName createdAt title")
    .lean();
  const view = (d: any) =>
    d && {
      title: d.title,
      version: d.version ?? null,
      isDraft: Boolean(d.isDraft),
      body: d.body,
      note: d.note || "",
      byName: d.byName || "",
      at: d.updatedAt || d.createdAt,
    };
  return {
    id: docId,
    current: view(current),
    draft: view(draft),
    history: history.map((h: any) => ({
      version: h.version,
      title: h.title,
      isDraft: Boolean(h.isDraft),
      note: h.note || "",
      byName: h.byName || "",
      at: h.createdAt,
    })),
  };
};

interface Edit {
  title?: unknown;
  body?: unknown;
  isDraft?: unknown;
  note?: unknown;
}

const cleanEdit = (input: Edit) => {
  const title = String(input.title ?? "").trim();
  const body = String(input.body ?? "").replace(/\r\n?/g, "\n").trim();
  if (!title) throw httpError("Give the document a title.", 400);
  if (title.length > 120) throw httpError("Keep the title under 120 characters.", 400);
  const problem = legalMarkupError(body);
  if (problem) throw httpError(problem, 400);
  return { title, body, isDraft: input.isDraft !== false, note: String(input.note ?? "").trim().slice(0, 500) };
};

export const saveLegalDraft = async (docId: LegalDocId, input: Edit, actor: { id: string; name: string }) => {
  const edit = cleanEdit(input);
  await LegalDocumentModel.findOneAndUpdate(
    { docId, status: "draft" },
    { $set: { ...edit, byId: actor.id, byName: actor.name } },
    { upsert: true, new: true },
  );
  return getLegalDocumentForAdmin(docId);
};

export const discardLegalDraft = async (docId: LegalDocId) => {
  await LegalDocumentModel.deleteOne({ docId, status: "draft" });
  return getLegalDocumentForAdmin(docId);
};

/**
 * Makes this wording the current version. New sign-ups accept it from now on;
 * everyone who accepted an earlier version keeps their record of that one.
 */
export const publishLegalDocument = async (docId: LegalDocId, input: Edit, actor: { id: string; name: string }) => {
  const edit = cleanEdit(input);
  if (!edit.note) throw httpError("Say what changed in this version.", 400);
  const current = await getPublishedLegalDocument(docId);
  if (current.body === edit.body && current.title === edit.title && current.isDraft === edit.isDraft) {
    throw httpError("Nothing has changed since the current version.", 409);
  }
  const versions = (await LegalDocumentModel.find({ docId, status: "published" }).select("version").lean()).map((d: any) => String(d.version));
  const version = nextLegalVersion(versions, new Date());
  try {
    await LegalDocumentModel.create({ docId, status: "published", version, ...edit, byId: actor.id, byName: actor.name });
  } catch (err: any) {
    if (err?.code === 11000) throw httpError("Someone published this document a moment ago. Reload to see their version.", 409);
    throw err;
  }
  await LegalDocumentModel.deleteOne({ docId, status: "draft" });
  cache = null;
  return { version, document: await getLegalDocumentForAdmin(docId) };
};

/** For tests: forget what was read so far. */
export const resetLegalCache = () => {
  cache = null;
  seeded = false;
};
