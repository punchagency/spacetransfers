import { useEffect, useState } from "react";
import { FiDownload } from "react-icons/fi";
import { Modal } from "../common/Modal";
import type {
  PrintJob,
  ExportSettingsState,
} from "../../types/printQueue";
import { GangsheetPreview } from "./download-gangsheet/GangsheetPreview";
import { ExportSettings } from "./download-gangsheet/ExportSettings";
import { apiFetch } from "../../utils/api";

interface DownloadGangsheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: PrintJob;
}

export const DownloadGangsheetModal = ({
  isOpen,
  onClose,
  job,
}: DownloadGangsheetModalProps) => {
  const [settings, setSettings] = useState<ExportSettingsState>({
    cropMarks: false,
    colorBars: false,
    embedICC: true,
  });
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [previewSheet, setPreviewSheet] = useState<{ widthIn: number | null; heightIn: number | null }>({
    widthIn: null,
    heightIn: null,
  });
  const [exporting, setExporting] = useState(false);
  const [driveLink, setDriveLink] = useState<string | null>(null);

  const toggleSetting = (key: keyof ExportSettingsState) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    if (!isOpen) return;
    setDriveLink(null);
    apiFetch(`/printer/jobs/${encodeURIComponent(job.id)}/gangsheet/preview?resolution=150`)
      .then((r) => {
        setPreviewDataUrl(r?.previewDataUrl || null);
        setPreviewSheet({
          widthIn: typeof r?.sheetWidthIn === "number" ? r.sheetWidthIn : null,
          heightIn: typeof r?.sheetHeightIn === "number" ? r.sheetHeightIn : null,
        });
      })
      .catch(() => {
        setPreviewDataUrl(null);
        setPreviewSheet({ widthIn: null, heightIn: null });
      });
  }, [isOpen, job.id]);

  const downloadExport = async (exportId: string) => {
    const token = localStorage.getItem("printer_token");
    const res = await fetch(`http://localhost:4000/api/printer/exports/${encodeURIComponent(exportId)}/file`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Download failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gangsheet_${job.orderId}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExport = async (toDrive: boolean) => {
    setExporting(true);
    try {
      const res = await apiFetch(`/printer/jobs/${encodeURIComponent(job.id)}/gangsheet/export`, {
        method: "POST",
        body: JSON.stringify({ format: "PNG", toDrive }),
      });
      const exportId = String(res?.exportId || "");
      const link = res?.drive?.webViewLink ? String(res.drive.webViewLink) : null;
      setDriveLink(link);
      if (exportId) await downloadExport(exportId);
    } finally {
      setExporting(false);
    }
  };

  const headerContent = (
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 flex-shrink-0">
        <FiDownload className="w-5 h-5" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-gray-900 leading-none mt-1">
          Download Gangsheet
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          Order {job.orderId} • {job.customer}
        </p>
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-[800px] bg-white"
      title={headerContent}
    >
      <div className="space-y-6">
        <GangsheetPreview previewDataUrl={previewDataUrl} sheetWidthIn={previewSheet.widthIn} sheetHeightIn={previewSheet.heightIn} />

        <div className="p-4 rounded-xl border border-gray-200 bg-white text-sm">
          <div className="font-bold text-gray-900">Export Specs</div>
          <div className="mt-1 text-gray-600">PNG-24 • 600 DPI • sRGB • Transparent • Compression: None</div>
        </div>

        <ExportSettings settings={settings} onToggle={toggleSetting} />

        {driveLink && (
          <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 text-sm">
            <div className="font-semibold text-blue-900">Google Drive</div>
            <a href={driveLink} target="_blank" rel="noreferrer" className="text-blue-700 underline break-all">
              {driveLink}
            </a>
          </div>
        )}

        <div className="flex justify-start gap-3 pt-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
          <button
            disabled={exporting}
            onClick={() => void handleExport(false)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm shadow-blue-200 disabled:opacity-60"
          >
            {exporting ? "Exporting…" : "Export PNG (600 DPI)"}
          </button>
          <button
            disabled={exporting}
            onClick={() => void handleExport(true)}
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60"
          >
            Export + Drive
          </button>
        </div>
      </div>
    </Modal>
  );
};
