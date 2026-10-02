import { FiCopy, FiImage, FiLayers } from "react-icons/fi";
import type { PrintJob } from "../../../types/printQueue";
import type { JobSheet } from "../SheetPicker";

interface PrintSpecificationsProps {
  job: PrintJob;
  specs?: {
    sheetSize?: string;
    filmType?: string;
    itemsCount?: number;
    sheetCount?: number;
    graphicCount?: number;
    printCount?: number;
    printDpi?: number;
  };
  sheets?: JobSheet[];
}

/*
 * Only what the order records.
 *
 * This card stated "CMYK+W" ink, a "Matte Powder" finish, "100% Coverage" white
 * underbase and an "sRGB" profile on every job — none of it stored on any
 * order or chosen by the customer — plus "600 DPI" when print files are
 * exported at 300, a 12×16" sheet size when none was known, and an "Items"
 * count that was really the number of sheets.
 */
export const PrintSpecifications = ({ job, specs, sheets = [] }: PrintSpecificationsProps) => {
  const sheetCount = specs?.sheetCount ?? specs?.itemsCount ?? sheets.length;
  const tiles = [
    { icon: FiLayers, label: sheetCount === 1 ? "Sheet" : "Sheets", value: sheetCount ?? "—" },
    { icon: FiImage, label: "Graphics", value: specs?.graphicCount ?? "—" },
    { icon: FiCopy, label: "Prints", value: specs?.printCount ?? "—" },
  ];
  const size = (sh: JobSheet) =>
    sh.widthIn && sh.heightIn ? `${sh.widthIn.toFixed(1)}" × ${sh.heightIn.toFixed(1)}"` : "—";

  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
      <h3 className="text-base font-bold text-gray-900 mb-3">Print Specifications</h3>
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
        {tiles.map(({ icon: Icon, label, value }) => (
          <div key={label} className="bg-gray-50 p-2.5 rounded-lg flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 shrink-0 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
              <Icon className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-gray-500">{label}</div>
              <div className="text-sm font-bold text-gray-900">{value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2 text-xs">
        {sheets.length > 0 ? (
          sheets.map((sh) => (
            <div key={sh.index} className="flex justify-between gap-3 py-1.5 border-b border-gray-50">
              <span className="text-gray-500 truncate">
                {sheets.length > 1 ? `Sheet ${sh.index + 1} · ${sh.name}` : "Sheet size"}
              </span>
              <span className="font-medium text-gray-900 whitespace-nowrap">
                {size(sh)}
                {sh.quantity > 1 ? ` · print ${sh.quantity}` : ""}
              </span>
            </div>
          ))
        ) : (
          <div className="flex justify-between py-1.5 border-b border-gray-50">
            <span className="text-gray-500">Sheet size</span>
            <span className="font-medium text-gray-900">{specs?.sheetSize || job.sheetSize || "—"}</span>
          </div>
        )}
        <div className="flex justify-between py-1.5 border-b border-gray-50">
          <span className="text-gray-500">Film</span>
          <span className="font-medium text-gray-900">{specs?.filmType || "DTF"}</span>
        </div>
        <div className="flex justify-between gap-3 py-1.5 border-b border-gray-50">
          <span className="text-gray-500">Print file</span>
          <span className="font-medium text-gray-900 text-right">
            PNG, transparent background{specs?.printDpi ? `, ${specs.printDpi} DPI` : ""}
          </span>
        </div>
      </div>
    </div>
  );
};
