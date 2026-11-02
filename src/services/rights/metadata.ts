import sharp from "sharp";
import type { RightsFinding } from "../../models/rightsScreen.model.js";
import { ipFinding, stockAgencyIn } from "./findings.js";

/**
 * What an image's own details say about where it came from: the EXIF, IPTC and
 * XMP fields cameras, stock libraries and design tools write (copyright,
 * creator, credit, source).
 *
 * Only ever a signal, never a clearance: these fields are trivially removed,
 * and a copyright line is just as often the customer's own. A stock library's
 * name holds the image for review (their standard licences seldom allow
 * printing on goods for sale); any other copyright line is shown to the admin
 * and partner but stops nobody.
 */

const tag = (xml: string, name: string): string => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml) || new RegExp(`${name}="([^"]*)"`, "i").exec(xml);
  return m ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
};

/** Findings from the readable text of an image's details. */
export const metadataFindings = (text: string): RightsFinding[] => {
  if (!text) return [];
  const out: (RightsFinding | null)[] = [];
  const agency = stockAgencyIn(text);
  if (agency) out.push(ipFinding("stock", agency, "review", "metadata", undefined, `The file's details name ${agency}.`));
  const notice =
    tag(text, "dc:rights") ||
    tag(text, "photoshop:Credit") ||
    tag(text, "photoshop:CopyrightFlag") ||
    (/(?:©|\(c\)|copyright)\s*[^\x00-\x1f]{2,80}/i.exec(text)?.[0] ?? "");
  const creator = tag(text, "dc:creator") || tag(text, "photoshop:AuthorsPosition");
  const line = [notice, creator && `creator: ${creator}`].filter(Boolean).join(" · ").slice(0, 200);
  if (line) out.push(ipFinding("metadata", "Copyright details in the file", "info", "metadata", undefined, line));
  return out.filter((f): f is RightsFinding => Boolean(f));
};

/** The readable text of a stored image's EXIF, IPTC and XMP fields. */
export const metadataText = async (buffer: Buffer): Promise<string> => {
  try {
    const meta = await sharp(buffer, { limitInputPixels: false }).metadata();
    return [meta.exif, meta.iptc, meta.xmp]
      .filter((b): b is Buffer => Buffer.isBuffer(b))
      .map((b) => b.toString("latin1").replace(/[^\x20-\x7e\xa9\n]+/g, " "))
      .join("\n")
      .slice(0, 20000);
  } catch {
    return "";
  }
};
