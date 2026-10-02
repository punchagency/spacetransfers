import { Request, Response, NextFunction } from "express";
import { isTitleTaken, normalizeTitle, titleTakenError, uniqueTitle, UNTITLED_SHEET } from "../../utils/designTitles.js";
import { storeDesignThumbnail } from "../../utils/designThumbnail.js";
import { Asset } from "../../models/asset.model.js";
import { Design } from "../../models/design.model.js";
import mongoose from "mongoose";
import { assertPersistable } from "../../utils/documentSize.js";
import { CustomError } from "./shared.js";

export const createDesign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title: rawTitle, thumbnail, size, pricing, artboardData, autoName } = req.body;

    /*
     * Names are unique per customer. One the app chose (autosave, "Untitled gang
     * sheet") simply takes the next free number; one the customer typed is
     * refused if taken, so they're never silently given a different name.
     */
    const wanted = normalizeTitle(rawTitle) || UNTITLED_SHEET;
    let title = wanted;
    if (await isTitleTaken(req.user?.id, wanted)) {
      if (!autoName) throw titleTakenError(wanted);
      title = await uniqueTitle(req.user?.id, wanted);
    }

    const design = new Design({
      user: req.user?.id,
      title,
      // Kept as a file, not as base64 in this document — see designThumbnail.ts.
      thumbnail: await storeDesignThumbnail(thumbnail),
      size,
      pricing,
      artboardData
    });

    // A saved design carries the same artboard payload an order does, so it
    // overflows the same way — and losing a design to an opaque 500 is worse
    // than failing an order, since the work is not recoverable from a cart.
    assertPersistable(design.toObject(), { label: "design" });
    await design.save();

    res.status(201).json({
      id: design.id,
      title: design.title,
      createdAt: design.createdAt,
      updatedAt: design.updatedAt
    });
  } catch (error) {
    next(error);
  }
};

export const listDesigns = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const designs = await Design.find({ user: req.user?.id })
      .select("title size thumbnail createdAt updatedAt")
      .sort({ updatedAt: -1 });

    const formattedDesigns = designs.map((design) => ({
      id: design.id,
      title: design.title,
      size: `${design.size.widthIn}" x ${design.size.heightIn}"`,
      thumbnail: design.thumbnail,
      createdAt: design.createdAt,
      updatedAt: design.updatedAt
    }));

    res.json({ designs: formattedDesigns });
  } catch (error) {
    next(error);
  }
};

export const searchDesigns = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== "string") {
      return res.json({ designs: [] });
    }

    /*
     * The typed text, matched literally.
     *
     * It went into the regex as written, so a name with brackets in it — which
     * copies now have ("Shirts (2)") — searched as a pattern: typing the "(" on
     * its own is an invalid regex and the search failed outright.
     */
    const designs = await Design.find({
      user: req.user?.id,
      title: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" }
    })
      .select("title size thumbnail createdAt updatedAt")
      .sort({ updatedAt: -1 });

    const formattedDesigns = designs.map((design) => ({
      id: design.id,
      title: design.title,
      size: `${design.size.widthIn}" x ${design.size.heightIn}"`,
      thumbnail: design.thumbnail,
      createdAt: design.createdAt,
      updatedAt: design.updatedAt
    }));

    res.json({ designs: formattedDesigns });
  } catch (error) {
    next(error);
  }
};

export const getDesignById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { designId } = req.params;
    const design = await Design.findOne({ _id: designId, user: req.user?.id });

    if (!design) {
      const error = new Error("Design not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    /*
     * Items store `assetId`, usually an asset's database id. The editor needs an
     * image address for a piece whose saved image is missing, and showed a broken
     * image when all it had was the id — so each id is sent with its address.
     */
    const artboardData = design.toObject().artboardData ?? { items: [] };
    const items = Array.isArray(artboardData.items) ? artboardData.items : [];
    const assetIds = [
      ...new Set(items.map((it: any) => String(it.assetId || "")).filter((id) => mongoose.isValidObjectId(id) && /^[a-f0-9]{24}$/i.test(id))),
    ];
    const addresses = new Map<string, string>();
    if (assetIds.length > 0) {
      const assets = await Asset.find({ _id: { $in: assetIds }, user: req.user?.id }).select("url").lean();
      for (const asset of assets as any[]) if (asset.url) addresses.set(String(asset._id), String(asset.url));
    }

    res.json({
      id: design.id,
      title: design.title,
      size: design.size,
      pricing: design.pricing,
      artboardData: {
        ...artboardData,
        items: items.map((it: any) => {
          const assetUrl = addresses.get(String(it.assetId));
          return assetUrl ? { ...it, assetUrl } : it;
        }),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const deleteDesign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { designId } = req.params;

    const design = await Design.findOneAndDelete({ _id: designId, user: req.user?.id });

    if (!design) {
      const error = new Error("Design not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({ message: "Design deleted successfully" });
  } catch (error) {
    next(error);
  }
};

export const updateDesign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { designId } = req.params;
    const { title, thumbnail, artboardData } = req.body;

    const updateData: any = {};
    if (title !== undefined) {
      const next = normalizeTitle(title);
      if (!next) {
        const error = new Error("A sheet needs a name.") as CustomError;
        error.statusCode = 400;
        throw error;
      }
      if (await isTitleTaken(req.user?.id, next, designId)) throw titleTakenError(next);
      updateData.title = next;
    }
    if (thumbnail !== undefined) updateData.thumbnail = await storeDesignThumbnail(thumbnail);
    if (artboardData !== undefined) updateData.artboardData = artboardData;

    if (Object.keys(updateData).length === 0) {
      const error = new Error("No fields provided to update") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const design = await Design.findOneAndUpdate(
      { _id: designId, user: req.user?.id },
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!design) {
      const error = new Error("Design not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.json({
      id: design.id,
      title: design.title,
      updatedAt: design.updatedAt
    });
  } catch (error) {
    next(error);
  }
};

export const duplicateDesign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { designId } = req.params;
    const { newTitle } = req.body;

    if (!newTitle || !newTitle.trim()) {
      const error = new Error("newTitle is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const source = await Design.findOne({ _id: designId, user: req.user?.id });
    if (!source) {
      const error = new Error("Design not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const copy = new Design({
      user: req.user?.id,
      // A copy is named for the customer, so it always gets a free name.
      title: await uniqueTitle(req.user?.id, newTitle),
      thumbnail: source.thumbnail,
      size: source.size,
      pricing: source.pricing,
      artboardData: source.artboardData
    });

    await copy.save();

    res.status(201).json({
      id: copy.id,
      title: copy.title,
      createdAt: copy.createdAt
    });
  } catch (error) {
    next(error);
  }
};
