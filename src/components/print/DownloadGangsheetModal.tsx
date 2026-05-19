import { useEffect, useState } from "react";
import { FiDownload } from "react-icons/fi";
import toast from "react-hot-toast";
import { Modal } from "../common/Modal";
import type {
  PrintJob,
  ExportSettingsState,
} from "../../types/printQueue";
import { GangsheetPreview } from "./download-gangsheet/GangsheetPreview";
import { ExportSettings } from "./download-gangsheet/ExportSettings";
import { apiFetch, fetchBlobWithProgress, getApiBaseUrl, saveBlobToDisk } from "../../utils/api";
import { SpaceLoader } from "../common/SpaceLoader";

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
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewSheet, setPreviewSheet] = useState<{ widthIn: number | null; heightIn: number | null }>({
    widthIn: null,
    heightIn: null,
  });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTotalItems, setPreviewTotalItems] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [progressLabel, setProgressLabel] = useState("Preparing export…");
  const [driveLink, setDriveLink] = useState<string | null>(null);

  const toggleSetting = (key: keyof ExportSettingsState) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    if (!isOpen) return;
    setDriveLink(null);
    setPreviewLoading(true);
    setPreviewTotalItems(null);
    const controller = new AbortController();
    let alive = true;

    (async () => {
      try {
        // Resolution 72 is plenty for an in-modal preview; the export uses 300 DPI anyway.
        const r = await apiFetch(
          `/printer/jobs/${encodeURIComponent(job.id)}/gangsheet/preview?resolution=72`,
          { signal: controller.signal },
        );
        if (!alive || controller.signal.aborted) return;

        setPreviewSheet({
          widthIn: typeof r?.sheetWidthIn === "number" ? r.sheetWidthIn : null,
          heightIn: typeof r?.sheetHeightIn === "number" ? r.sheetHeightIn : null,
        });
        if (typeof r?.totalItems === "number") setPreviewTotalItems(r.totalItems);

        // Server returns an absolute file URL — browser fetches the PNG directly with
        // immutable cache headers, no base64 decode, progressive rendering.
        const url = typeof r?.previewDataUrl === "string" ? r.previewDataUrl : null;
        setPreviewBlobUrl(url);
        setPreviewLoading(false);
      } catch (e: any) {
        if (controller.signal.aborted || e?.name === "AbortError") return;
        if (!alive) return;
        setPreviewBlobUrl(null);
        setPreviewSheet({ widthIn: null, heightIn: null });
        setPreviewLoading(false);
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [isOpen, job.id]);

  const downloadExport = async (exportId: string) => {
    const token = localStorage.getItem("printer_token");
    // Stream the export with progress so the printer sees byte-level progress instead of a frozen UI.
    const out = await fetchBlobWithProgress(
      `${getApiBaseUrl()}/printer/exports/${encodeURIComponent(exportId)}/file`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        onProgress: ({ loaded, total }) => {
          if (total) {
            setProgressLabel(`Downloading… ${Math.round((loaded / total) * 100)}%`);
          } else {
            setProgressLabel(`Downloading… ${(loaded / (1024 * 1024)).toFixed(1)} MB`);
          }
        },
      },
    );
    saveBlobToDisk(out.blob, out.filename || `gangsheet_${job.orderId}.png`);
  };

  const handleExport = async (toDrive: boolean) => {
    setExporting(true);
    setProgressLabel(toDrive ? "Queuing export + Drive…" : "Queuing export…");
    setShowProgress(false);
    const t = window.setTimeout(() => setShowProgress(true), 1000);
    try {
      const res = await apiFetch(`/printer/jobs/${encodeURIComponent(job.id)}/gangsheet/export`, {
        method: "POST",
        body: JSON.stringify({ format: "PNG", toDrive }),
      });

      const exportJobId = String(res?.exportJobId || "");
      if (!exportJobId) throw new Error("No export job ID returned");

      // Poll until the background render finishes.
      setProgressLabel("Rendering gangsheet…");
      let exportId = "";
      let driveResult: any = null;
      while (true) {
        await new Promise<void>((r) => setTimeout(r, 2000));
        const statusRes = await apiFetch(`/printer/jobs/export-status/${encodeURIComponent(exportJobId)}`);
        if (statusRes.status === "done") {
          exportId = String(statusRes.result?.exportId || "");
          driveResult = statusRes.result?.drive ?? null;
          break;
        } else if (statusRes.status === "failed") {
          throw new Error(statusRes.error || "Export failed");
        }
      }

      const link = driveResult?.webViewLink ? String(driveResult.webViewLink) : null;
      setDriveLink(link);
      if (exportId) {
        setProgressLabel("Downloading…");
        await downloadExport(exportId);
      }
    } catch (e: any) {
      toast.error(e?.message || "Export failed");
    } finally {
      window.clearTimeout(t);
      setShowProgress(false);
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
        {previewLoading ? (
          <div>
            <h3 className="text-sm font-bold text-gray-900 mb-3">Gangsheet Preview</h3>
            <div className="w-full flex justify-center">
              <div className="w-full max-w-[520px]">
                <div className="relative w-full aspect-square border border-gray-200 rounded-xl bg-gray-50 flex flex-col items-center justify-center gap-3">
                  <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
                  <p className="text-sm text-gray-500">Rendering gangsheet preview…</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <GangsheetPreview previewDataUrl={previewBlobUrl} sheetWidthIn={previewSheet.widthIn} sheetHeightIn={previewSheet.heightIn} />
            {previewTotalItems !== null && previewTotalItems > 500 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700">
                <span className="font-semibold">Preview shows first 500 of {previewTotalItems.toLocaleString()} items.</span>
                <span>The full export at 300 DPI includes all items.</span>
              </div>
            )}
          </>
        )}

        <div className="p-4 rounded-xl border border-gray-200 bg-white text-sm">
          <div className="font-bold text-gray-900">Export Specs</div>
          <div className="mt-1 text-gray-600">PNG-24 • 300 DPI • sRGB • Transparent • Compression: Fast (lossless)</div>
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

        {exporting && showProgress && (
          <div className="p-4 rounded-xl border border-gray-200 bg-white">
            <SpaceLoader label={progressLabel} />
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
            {exporting ? "Exporting…" : "Export PNG (300 DPI)"}
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
