import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { exportGangsheetPng24 } from "../services/gangsheetExport.service.js";

/**
 * Preview completeness.
 *
 * The printer preview passed `maxComposites: 500`, which stopped laying out
 * placements past the 500th. Live sheets carry 1,200–2,600 placements, so the
 * printer saw roughly a third of the job — and because the crop bounds are
 * computed from every item, the missing pieces left reserved-but-empty space
 * rather than a shorter sheet. Measured against real orders before the fix:
 * 700 of 1,200 items absent, and 2,112 of 2,612.
 *
 * These tests use a synthetic sheet with inline data-URL artwork so they need
 * neither the database nor the network, and assert the property that actually
 * matters: every item the sheet declares is visible in the rendered preview,
 * at the position the sheet put it.
 */

/** A solid 2x2 PNG, inlined so the renderer needs no network. */
const SWATCH =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQqTjxH4QZYAwATZwJTT1ZqfsAAAAASUVORK5CYII=";

/** A sheet of `count` swatches tiled down the page, one per row band. */
const buildSheet = (count: number) => {
  const perRow = 10;
  const size = 2; // inches
  const gap = 0.1;
  return Array.from({ length: count }, (_, i) => ({
    assetId: `item-${i}`,
    croppedUrl: SWATCH,
    widthIn: size,
    heightIn: size,
    posX: (i % perRow) * (size + gap),
    posY: Math.floor(i / perRow) * (size + gap),
    rotation: 0,
    flipped: false,
    copies: 1,
  }));
};

/** Items whose box contains no visible pixel in the rendered output. */
const findMissingItems = async (
  filePath: string,
  items: ReturnType<typeof buildSheet>,
  dpi: number,
  crop: { leftIn: number; topIn: number } | null,
) => {
  const { data, info } = await sharp(filePath, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const cropL = crop ? crop.leftIn : 0;
  const cropT = crop ? crop.topIn : 0;
  const missing: string[] = [];

  for (const it of items) {
    const x0 = Math.max(0, Math.round((it.posX - cropL) * dpi));
    const y0 = Math.max(0, Math.round((it.posY - cropT) * dpi));
    const x1 = Math.min(info.width, Math.round((it.posX - cropL + it.widthIn) * dpi));
    const y1 = Math.min(info.height, Math.round((it.posY - cropT + it.heightIn) * dpi));

    let visible = false;
    for (let y = y0; y < y1 && !visible; y++) {
      for (let x = x0; x < x1; x++) {
        if (data[(y * info.width + x) * 4 + 3] !== 0) {
          visible = true;
          break;
        }
      }
    }
    if (!visible) missing.push(it.assetId);
  }
  return missing;
};

describe("gang sheet preview renders every item", () => {
  it("places all 600 items when no composite cap is given", async () => {
    const items = buildSheet(600);
    const rendered = await exportGangsheetPng24({
      jobId: "preview-completeness-uncapped",
      printerId: "test",
      sheetWidthIn: 23.5,
      sheetHeightIn: 130,
      artboardItems: items,
      dpi: 36,
      cropToContent: true,
      format: "png",
      itemSpacingIn: 0.1,
      sheetMarginIn: 0,
    });

    const missing = await findMissingItems(
      rendered.filePath,
      items,
      rendered.dpi,
      rendered.crop,
    );
    assert.equal(
      missing.length,
      0,
      `${missing.length} item(s) absent from the preview, e.g. ${missing.slice(0, 5).join(", ")}`,
    );
  });

  it("demonstrates the regression a composite cap reintroduces", async () => {
    // Guards the fix itself: if `maxComposites` is ever put back on the
    // preview path, this is what it does to the printer's view of the job.
    const items = buildSheet(600);
    const rendered = await exportGangsheetPng24({
      jobId: "preview-completeness-capped",
      printerId: "test",
      sheetWidthIn: 23.5,
      sheetHeightIn: 130,
      artboardItems: items,
      dpi: 36,
      cropToContent: true,
      maxComposites: 500,
      format: "png",
      itemSpacingIn: 0.1,
      sheetMarginIn: 0,
    });

    const missing = await findMissingItems(
      rendered.filePath,
      items,
      rendered.dpi,
      rendered.crop,
    );
    assert.ok(
      missing.length >= 90,
      `expected the cap to drop ~100 items, it dropped ${missing.length}`,
    );
  });

  it("keeps every copy of a multi-copy item", async () => {
    // Copies expand into placements too, so a sheet of few items but many
    // copies is just as exposed to a cap as a sheet of many items.
    const items = [
      {
        assetId: "many-copies",
        croppedUrl: SWATCH,
        widthIn: 2,
        heightIn: 2,
        posX: 0,
        posY: 0,
        rotation: 0,
        flipped: false,
        copies: 40,
      },
    ];
    const rendered = await exportGangsheetPng24({
      jobId: "preview-completeness-copies",
      printerId: "test",
      sheetWidthIn: 23.5,
      sheetHeightIn: 40,
      artboardItems: items,
      dpi: 36,
      cropToContent: true,
      format: "png",
      itemSpacingIn: 0.1,
      sheetMarginIn: 0,
    });

    // 40 copies of a 2in item on a 23.5in sheet wrap to 11 per row → 4 rows.
    const { data, info } = await sharp(rendered.filePath, { limitInputPixels: false })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) opaque++;
    const areaPerCopy = Math.round(2 * rendered.dpi) ** 2;
    // Allow generous slack for resampling at the edges; the point is that the
    // rendered coverage reflects ~40 copies rather than a truncated subset.
    assert.ok(
      opaque > areaPerCopy * 35,
      `expected ~40 copies of coverage, saw about ${(opaque / areaPerCopy).toFixed(1)}`,
    );
    void info;
  });
});
