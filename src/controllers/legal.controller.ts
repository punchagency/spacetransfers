import { Request, Response, NextFunction } from "express";
import { User } from "../models/user.model.js";
import {
  discardLegalDraft,
  getCurrentLegalDocuments,
  getLegalDocumentForAdmin,
  getPublishedLegalDocument,
  isLegalDocId,
  publishLegalDocument,
  saveLegalDraft,
} from "../services/legal.service.js";
import { notifyAllAdmins } from "../services/adminNotifications.service.js";

const notFound = () => Object.assign(new Error("Document not found"), { statusCode: 404 });

const docIdOf = (req: Request) => {
  const id = String(req.params.docId || "");
  if (!isLegalDocId(id)) throw notFound();
  return id;
};

const actorOf = async (req: Request) => {
  const admin = await User.findById(req.user?.id).select("name email").lean();
  return { id: String(req.user?.id || ""), name: String((admin as any)?.name || (admin as any)?.email || "Admin") };
};

// ── public ──

/** The current version of each document, for sign-up forms and links. */
export const listLegalDocuments = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.set("Cache-Control", "public, max-age=60");
    res.json({ documents: await getCurrentLegalDocuments() });
  } catch (error) {
    next(error);
  }
};

/** One document's text: the current version, or a named earlier one. */
export const getLegalDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const version = typeof req.query.version === "string" && req.query.version ? req.query.version : undefined;
    res.set("Cache-Control", "public, max-age=60");
    res.json(await getPublishedLegalDocument(docIdOf(req), version));
  } catch (error) {
    next(error);
  }
};

// ── admin ──

export const adminListLegalDocuments = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const current = await getCurrentLegalDocuments();
    const withDrafts = await Promise.all(
      current.map(async (doc) => {
        const full = await getLegalDocumentForAdmin(doc.id);
        return { ...doc, hasDraft: Boolean(full.draft), versions: full.history.length };
      }),
    );
    res.json({ documents: withDrafts });
  } catch (error) {
    next(error);
  }
};

export const adminGetLegalDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getLegalDocumentForAdmin(docIdOf(req)));
  } catch (error) {
    next(error);
  }
};

export const adminSaveLegalDraft = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await saveLegalDraft(docIdOf(req), req.body || {}, await actorOf(req)));
  } catch (error) {
    next(error);
  }
};

export const adminDiscardLegalDraft = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await discardLegalDraft(docIdOf(req)));
  } catch (error) {
    next(error);
  }
};

export const adminPublishLegalDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docId = docIdOf(req);
    const actor = await actorOf(req);
    const result = await publishLegalDocument(docId, req.body || {}, actor);
    notifyAllAdmins({
      category: "system",
      priority: "medium",
      title: `${result.document.current?.title || "A legal document"} updated`,
      message: `${actor.name} published version ${result.version}: ${String(req.body?.note || "").slice(0, 200)}`,
      meta: { type: "legal_published", docId, version: result.version },
    }).catch(() => {});
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const adminGetLegalVersion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getPublishedLegalDocument(docIdOf(req), String(req.params.version || "")));
  } catch (error) {
    next(error);
  }
};
