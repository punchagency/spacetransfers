import PDFDocument from "pdfkit";

/**
 * Invoice rendering, using pdfkit.
 *
 * This replaced `pdf-node`, which wraps the abandoned `html-pdf` and requires a
 * PhantomJS binary that is not installed. That combination did not merely fail
 * — `pdf-node` rejected on an internal promise it never handled, so the failure
 * arrived as an unhandled rejection and took the whole Node process down. The
 * callers' try/catch could not intercept it, which turned "download an invoice"
 * into a denial of service for every user of the API.
 *
 * pdfkit was already a dependency and already renders the gang-sheet PDFs in
 * `printer.controller`, so this uses the library the codebase had settled on
 * rather than introducing another one. It draws synchronously in-process: no
 * headless browser, no binary, nothing that can fail out-of-band.
 */

export interface InvoiceLineItem {
  label: string;
  amount: string | number;
}

export interface InvoiceItem {
  name: string;
  description?: string;
  quantity: number | string;
  unitPrice: number | string;
  subtotal: number | string;
}

export interface InvoiceData {
  /** Canonical order number (DTF-####). */
  orderId: string;
  date: string;
  shippingAddress: {
    name: string;
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  items: InvoiceItem[];
  pricing: {
    lineItems: InvoiceLineItem[];
    total: string | number;
    currency: string;
  };
}

const INK = "#333333";
const MUTED = "#777777";
const ACCENT = "#0056b3";
const RULE = "#e5e5e5";

const money = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v ?? "0.00");
};

/** "$6.86", and "-$2.00" for a discount — not "$-2.00". */
const dollars = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n < 0 ? `-$${money(-n)}` : `$${money(v)}`;
};

/** Column layout for the items table, in points from the left margin. */
const COLS = { name: 50, desc: 190, qty: 330, unit: 390, sub: 470 };
const COL_W = { name: 135, desc: 135, qty: 55, unit: 75, sub: 85 };

export const renderInvoicePdf = async (data: InvoiceData): Promise<Buffer> => {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const done = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  // ── Header ────────────────────────────────────────────────────────────────
  doc.fillColor(ACCENT).fontSize(26).font("Helvetica-Bold").text("Invoice", { align: "center" });
  doc.moveDown(0.3);
  doc.fillColor(INK).fontSize(11).font("Helvetica");
  doc.text(`Order ID: ${data.orderId}`, { align: "center" });
  doc.text(`Date: ${data.date}`, { align: "center" });
  doc.moveDown(1.5);

  // ── Shipping address ──────────────────────────────────────────────────────
  const a = data.shippingAddress;
  doc.fillColor(INK).fontSize(13).font("Helvetica-Bold").text("Shipping Address");
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica-Bold").text(a.name);
  doc.font("Helvetica");
  doc.text(a.street);
  doc.text(`${a.city}, ${a.state} ${a.postalCode}`);
  doc.text(a.country);
  doc.moveDown(1.2);

  // ── Items table ───────────────────────────────────────────────────────────
  doc.fontSize(13).font("Helvetica-Bold").text("Order Items");
  doc.moveDown(0.5);

  const header = (y: number) => {
    doc.fontSize(9).font("Helvetica-Bold").fillColor(INK);
    doc.text("Item", COLS.name, y, { width: COL_W.name });
    doc.text("Description", COLS.desc, y, { width: COL_W.desc });
    doc.text("Qty", COLS.qty, y, { width: COL_W.qty, align: "right" });
    doc.text("Unit Price", COLS.unit, y, { width: COL_W.unit, align: "right" });
    doc.text("Subtotal", COLS.sub, y, { width: COL_W.sub, align: "right" });
    doc.moveTo(COLS.name, y + 14).lineTo(555, y + 14).strokeColor(RULE).stroke();
  };

  let y = doc.y;
  header(y);
  y += 22;

  doc.fontSize(9).font("Helvetica");
  for (const item of data.items || []) {
    // Height is driven by the tallest wrapping cell so a long description
    // cannot overlap the row beneath it.
    const nameH = doc.heightOfString(String(item.name ?? ""), { width: COL_W.name });
    const descH = doc.heightOfString(String(item.description ?? ""), { width: COL_W.desc });
    const rowH = Math.max(nameH, descH, 12) + 8;

    if (y + rowH > doc.page.height - 120) {
      doc.addPage();
      y = doc.y;
      header(y);
      y += 22;
      doc.fontSize(9).font("Helvetica");
    }

    doc.fillColor(INK);
    doc.text(String(item.name ?? ""), COLS.name, y, { width: COL_W.name });
    doc.text(String(item.description ?? ""), COLS.desc, y, { width: COL_W.desc });
    doc.text(String(item.quantity ?? ""), COLS.qty, y, { width: COL_W.qty, align: "right" });
    doc.text(dollars(item.unitPrice), COLS.unit, y, { width: COL_W.unit, align: "right" });
    doc.text(dollars(item.subtotal), COLS.sub, y, { width: COL_W.sub, align: "right" });

    y += rowH;
    doc.moveTo(COLS.name, y - 4).lineTo(555, y - 4).strokeColor(RULE).stroke();
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  y += 14;
  if (y > doc.page.height - 160) {
    doc.addPage();
    y = doc.y;
  }

  doc.fontSize(10).font("Helvetica").fillColor(INK);
  for (const li of data.pricing?.lineItems || []) {
    doc.text(`${li.label}:`, COLS.unit - 90, y, { width: 160, align: "right" });
    doc.text(dollars(li.amount), COLS.sub, y, { width: COL_W.sub, align: "right" });
    y += 16;
  }

  doc.moveTo(COLS.unit - 90, y + 2).lineTo(555, y + 2).strokeColor(RULE).stroke();
  y += 10;
  doc.fontSize(12).font("Helvetica-Bold");
  doc.text("Total:", COLS.unit - 90, y, { width: 160, align: "right" });
  doc.text(`${dollars(data.pricing?.total)} ${data.pricing?.currency || "USD"}`, COLS.sub, y, {
    width: COL_W.sub,
    align: "right",
  });

  // ── Footer ────────────────────────────────────────────────────────────────
  doc.fontSize(9).font("Helvetica").fillColor(MUTED);
  doc.text("Thank you for your business!", 50, doc.page.height - 80, {
    width: doc.page.width - 100,
    align: "center",
  });

  doc.end();
  await done;
  return Buffer.concat(chunks);
};
