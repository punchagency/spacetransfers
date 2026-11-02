/**
 * Pre-save size validation for MongoDB documents.
 *
 * ## The error this exists to prevent
 *
 *     RangeError: The value of "offset" is out of range.
 *     It must be >= 0 && <= 17825792. Received 17825794
 *
 * That number is not arbitrary and it is not an image offset: 17825792 is
 * exactly `17 * 1024 * 1024` — `MAXSIZE` in `bson/lib/bson.cjs`, the shared
 * scratch buffer the serializer writes into. MongoDB caps a document at 16 MiB
 * and the buffer is a megabyte larger, but `serialize()` only ever grows it to
 * MAXSIZE. It then walks the document writing at an advancing index, and once
 * that index passes the buffer's length the next `Buffer.write` throws.
 *
 * Two consequences worth knowing, both verified against bson 6.10.4:
 *
 *  - It takes *many* fields to trigger, not one enormous one. That is why the
 *    crash only ever appeared with several images on the board.
 *  - A single oversized string does **not** throw — it writes at a low offset
 *    and is silently truncated, producing a corrupt document instead of an
 *    error. Refusing on size catches that case too.
 *
 * The result is the worst kind of production error. It names an "offset" the
 * application never computed, points at no field, no document and no collection,
 * surfaces as a 500 at checkout after the customer has already paid, and sends
 * whoever debugs it hunting through image-processing code for an off-by-one
 * that does not exist.
 *
 * ## What actually overflows
 *
 * The editor produces every canvas result — auto-crop, background removal,
 * colour removal, AI edits — as a `data:image/png;base64,…` URL. At print
 * resolution one of those runs to tens of megabytes, and base64 adds a further
 * 4/3. A single such URL reaching an order item is enough to blow the 16 MiB
 * cap on its own. The architectural fix is upstream (assets are uploaded when
 * created, so items carry short URLs — see `materializeAsset`), but that fix
 * lives in the client. A stale tab, a client-side exception between edit and
 * checkout, or any future write path that forgets to materialize would put the
 * bytes back. This guard is the backstop that keeps such a bug legible.
 *
 * ## What this does instead
 *
 * Measure the document *before* handing it to the driver, and if it is too
 * large fail with a 413 that names the offending field, its size, and whether
 * it is an embedded data URL. The customer gets an actionable message rather
 * than a 500, and the log line identifies the exact path to fix.
 */
import { BSON } from "mongodb";

/** MongoDB's hard per-document ceiling. */
export const MONGO_DOC_LIMIT_BYTES = 16 * 1024 * 1024;

/**
 * The size we actually refuse at.
 *
 * Deliberately below the real cap. Mongoose adds `_id`, `__v`, timestamps and
 * any defaults *after* this check runs, and a document measured at 15.99 MiB
 * can still cross the line by the time it reaches the driver. A ~1 MiB margin
 * costs nothing — no legitimate order comes anywhere near it, since a correctly
 * materialized order is measured in kilobytes.
 */
export const SAFE_DOC_LIMIT_BYTES = 15 * 1024 * 1024;

/** Anything at or above this is worth a log line even when it is accepted. */
const WARN_BYTES = 2 * 1024 * 1024;

/** Longest field paths to name in an error or warning. */
const REPORT_FIELDS = 5;

export interface FieldSize {
  /** Dotted path, e.g. `items.0.artboardItems.7.croppedUrl`. */
  path: string;
  bytes: number;
  /** True when the value is an embedded `data:` URL — nearly always the cause. */
  isDataUrl: boolean;
}

const formatMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

/**
 * Measures a document's serialized size.
 *
 * Uses the driver's own serializer rather than `JSON.stringify().length`, which
 * would be wrong in both directions: it counts UTF-16 code units rather than
 * encoded bytes, and it cannot represent Buffers, Dates or ObjectIds the way
 * BSON does. Since the whole point is to predict what the driver will do, the
 * measurement has to come from the driver.
 *
 * Returns `Infinity` rather than throwing if measurement itself fails — a
 * document so malformed it cannot be sized is certainly not one to persist, and
 * this function must never become a new source of 500s.
 */
export const bsonSize = (doc: unknown): number => {
  try {
    return BSON.calculateObjectSize(doc as any);
  } catch {
    return Infinity;
  }
};

/**
 * Finds the largest leaf values in a document.
 *
 * Walks to leaves rather than reporting top-level keys, because "items is 14 MB"
 * is not actionable on an order whose every field lives under `items`. The
 * useful answer is which *string* is enormous and whether it is embedded image
 * data.
 *
 * Cycles are tracked because Mongoose documents can hold parent back-references,
 * and an unguarded walk over one never terminates.
 */
export const largestFields = (doc: unknown, limit = REPORT_FIELDS): FieldSize[] => {
  const found: FieldSize[] = [];
  const seen = new WeakSet<object>();

  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      // Byte length, not `.length`: a multi-byte character costs more on the
      // wire than it does in a JS string, and the limit is measured in bytes.
      found.push({
        path,
        bytes: Buffer.byteLength(value, "utf8"),
        isDataUrl: value.startsWith("data:"),
      });
      return;
    }

    if (Buffer.isBuffer(value)) {
      found.push({ path, bytes: value.length, isDataUrl: false });
      return;
    }

    if (value && typeof value === "object") {
      if (seen.has(value as object)) return;
      seen.add(value as object);

      if (Array.isArray(value)) {
        value.forEach((entry, i) => walk(entry, `${path}[${i}]`));
        return;
      }

      // Unwrap Mongoose documents so the walk sees the plain data rather than
      // the internal state that wraps it.
      const plain =
        typeof (value as any).toObject === "function"
          ? (value as any).toObject()
          : value;

      for (const [key, entry] of Object.entries(plain)) {
        walk(entry, path ? `${path}.${key}` : key);
      }
    }
  };

  walk(doc, "");

  return found.sort((a, b) => b.bytes - a.bytes).slice(0, limit);
};

/** One-line summary of the worst offenders, for logs and error messages. */
const describeFields = (fields: FieldSize[]): string =>
  fields
    .map((f) => `${f.path}=${formatMb(f.bytes)}${f.isDataUrl ? " (embedded data URL)" : ""}`)
    .join(", ");

export interface PersistableOptions {
  /** Names the document in logs and errors, e.g. "order" or "cart". */
  label: string;
  /** Overrides the refusal threshold. Defaults to `SAFE_DOC_LIMIT_BYTES`. */
  limitBytes?: number;
}

/**
 * Throws a diagnosable 413 if a document is too large to persist.
 *
 * Call immediately before `.save()` / `.create()` on any document that can
 * carry customer artwork. The check is a single pass over the document and
 * costs microseconds on the kilobyte-sized documents that are the norm, so it
 * is not worth making conditional.
 *
 * The thrown error carries `statusCode: 413`, so the existing error middleware
 * renders it as a payload-size problem rather than an internal error.
 */
export const assertPersistable = (doc: unknown, options: PersistableOptions): void => {
  const limit = options.limitBytes ?? SAFE_DOC_LIMIT_BYTES;
  const size = bsonSize(doc);

  if (size <= limit) {
    // Not fatal, but a document this large means materialization is slipping
    // somewhere upstream. Logging it here is how that gets noticed before it
    // becomes a failed checkout.
    if (size >= WARN_BYTES) {
      console.warn(
        `[DOC_SIZE] ${options.label} is ${formatMb(size)} ` +
          `(limit ${formatMb(limit)}) — largest: ${describeFields(largestFields(doc))}`,
      );
    }
    return;
  }

  const offenders = largestFields(doc);
  const embedded = offenders.filter((f) => f.isDataUrl);

  console.error(
    `[DOC_TOO_LARGE] ${options.label} is ${formatMb(size)}, over the ${formatMb(limit)} ` +
      `limit (MongoDB caps a document at ${formatMb(MONGO_DOC_LIMIT_BYTES)}). ` +
      `Largest fields: ${describeFields(offenders)}. ` +
      (embedded.length
        ? `${embedded.length} embedded data URL(s) reached the database — these should have ` +
          `been uploaded via /customer/assets/materialize before checkout.`
        : `No embedded data URLs; the document is large from sheer field count.`),
  );

  const error = new Error(
    embedded.length
      ? "Some of your artwork was not uploaded correctly and the order is too large to save. " +
        "Please reload the page and try again — your artwork is safe."
      : "This design is too large to save in a single order. Please split it across " +
        "multiple gang sheets and try again.",
  ) as Error & { statusCode: number; code: string; details: unknown };

  error.statusCode = 413;
  error.code = "DOCUMENT_TOO_LARGE";
  error.details = { label: options.label, bytes: size, limit, offenders };
  throw error;
};
