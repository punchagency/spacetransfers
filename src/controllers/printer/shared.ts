import mongoose from "mongoose";

export interface CustomError extends Error {
  statusCode?: number;
}

export const isObjectIdString = (v: string) => /^[0-9a-fA-F]{24}$/.test(v);

export const splitAssetRefs = (refs: Set<string>) => {
  const ids: mongoose.Types.ObjectId[] = [];
  const urls: string[] = [];
  for (const r of refs) {
    const s = String(r || "");
    if (!s) continue;
    if (isObjectIdString(s)) ids.push(new mongoose.Types.ObjectId(s));
    else urls.push(s);
  }
  return { ids, urls };
};
