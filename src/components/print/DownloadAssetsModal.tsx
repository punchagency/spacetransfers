import { useEffect, useMemo, useState } from "react";
import { FiDownload } from "react-icons/fi";
import { Modal } from "../common/Modal";
import type { PrintJob } from "../../types/printQueue";
import { AssetStatsBar } from "./download-assets/AssetStatsBar";
import { AssetList } from "./download-assets/AssetList";
import { DownloadFormatSelector } from "./download-assets/DownloadFormatSelector";
import { DownloadAssetsFooter } from "./download-assets/DownloadAssetsFooter";
import { apiFetch, fetchBlobWithProgress, getApiBaseUrl, saveBlobToDisk } from "../../utils/api";
import toast from "react-hot-toast";
import { SpaceLoader } from "../common/SpaceLoader";
import { DriveSaveModal } from "../drive/DriveSaveModal";
import { createResumableUploadSession, getDriveFileWebViewLink, uploadBlobResumable } from "../../utils/drive";

type ApiAsset = {
  id: string;
  filename: string;
  widthPx?: number;
  heightPx?: number;
  dpi?: number;
  downloadUrl: string;
};

interface DownloadAssetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: PrintJob;
}

export const DownloadAssetsModal = ({
  isOpen,
  onClose,
  job,
}: DownloadAssetsModalProps) => {
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());
  const [downloadFormat, setDownloadFormat] = useState<"zip" | "individual">(
    "zip",
  );
  const [assets, setAssets] = useState<ApiAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [transfer, setTransfer] = useState<{ phase: "download" | "upload"; loaded: number; total: number | null } | null>(null);
  const [driveModalOpen, setDriveModalOpen] = useState(false);

  const totalSize = useMemo(() => {
    return "—";
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedAssets(new Set());
    setLoading(true);
    apiFetch(`/printer/jobs/${encodeURIComponent(job.id)}/assets`)
      .then((r) => {
        setAssets(Array.isArray(r?.assets) ? r.assets : []);
      })
      .catch((e: any) => toast.error(e?.message || "Failed to load assets"))
      .finally(() => setLoading(false));
  }, [isOpen, job.id]);

  const toggleAsset = (id: string) => {
    const newSelected = new Set(selectedAssets);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedAssets(newSelected);
  };

  const toggleAll = () => {
    if (selectedAssets.size === assets.length) {
      setSelectedAssets(new Set());
    } else {
      setSelectedAssets(new Set(assets.map((a) => a.id)));
    }
  };

  const headerContent = (
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 flex-shrink-0">
        <FiDownload className="w-5 h-5" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-gray-900 leading-none mt-1">
          Download Assets
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          Order {job.orderId} • {job.customer}
        </p>
      </div>
    </div>
  );

  const getAuthHeader = (): Record<string, string> => {
    const token = localStorage.getItem("printer_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const downloadZipBlob = async () => {
    const include = Array.from(selectedAssets);
    const includeParam = include.length ? include.join(",") : "ALL";
    const url = `${getApiBaseUrl()}/printer/jobs/${encodeURIComponent(job.id)}/assets/bundle/download?include=${encodeURIComponent(includeParam)}`;
    return await fetchBlobWithProgress(url, {
      headers: getAuthHeader(),
      onProgress: (p) => setTransfer({ phase: "download", loaded: p.loaded, total: p.total }),
    });
  };

  const handleDownload = async () => {
    if (selectedAssets.size === 0) return;
    if (working) return;
    setWorking(true);
    setTransfer({ phase: "download", loaded: 0, total: null });

    try {
      if (downloadFormat === "individual") {
        for (const id of selectedAssets) {
          const asset = assets.find((a) => a.id === id);
          if (!asset) continue;
          const out = await fetchBlobWithProgress(asset.downloadUrl, {
            onProgress: (p) => setTransfer({ phase: "download", loaded: p.loaded, total: p.total }),
          });
          saveBlobToDisk(out.blob, out.filename || asset.filename || "asset");
        }
        toast.success("Downloads started");
        onClose();
        return;
      }

      const out = await downloadZipBlob();
      saveBlobToDisk(out.blob, out.filename || `original_assets_${job.orderId}.zip`);
      toast.success("Bundle downloaded");
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Download failed");
    } finally {
      setWorking(false);
      setTransfer(null);
    }
  };

  const driveClientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string | undefined;

  const saveZipToDrive = async ({ accessToken, folderId }: { accessToken: string; folderId: string | null }) => {
    if (selectedAssets.size === 0) return;
    if (working) return;
    setWorking(true);
    setTransfer({ phase: "download", loaded: 0, total: null });
    try {
      const downloaded = await downloadZipBlob();
      const fileName = downloaded.filename || `original_assets_${job.orderId}.zip`;
      const mimeType = downloaded.contentType || "application/zip";

      setTransfer({ phase: "upload", loaded: 0, total: Math.max(downloaded.blob.size, 1) });
      const uploadUrl = await createResumableUploadSession({
        accessToken,
        fileName,
        mimeType,
        folderId,
      });
      const fileId = await uploadBlobResumable({
        accessToken,
        uploadUrl,
        blob: downloaded.blob,
        onProgress: (p) => setTransfer({ phase: "upload", loaded: p.loaded, total: p.total }),
      });
      const link = await getDriveFileWebViewLink(accessToken, fileId);
      toast.success("Saved to Google Drive");
      window.open(link, "_blank");
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Google Drive upload failed");
    } finally {
      setWorking(false);
      setTransfer(null);
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        className="max-w-[800px] bg-white"
        title={headerContent}
      >
        <div className="space-y-6">
          <AssetStatsBar
            selectedCount={selectedAssets.size}
            totalSize={totalSize}
            totalAssets={assets.length}
            onToggleAll={toggleAll}
          />

          {loading ? (
            <div className="py-6">
              <SpaceLoader label="Loading assets…" />
            </div>
          ) : (
            <AssetList
              assets={assets.map((a) => ({
                id: a.id,
                name: a.filename,
                size: "",
                type: "artwork",
                fileType: "png",
              }))}
              selectedAssets={selectedAssets}
              onToggleAsset={toggleAsset}
            />
          )}

          {selectedAssets.size > 0 && (
            <DownloadFormatSelector
              format={downloadFormat}
              onChange={setDownloadFormat}
            />
          )}

          {transfer ? (
            <div className="text-xs text-gray-500">
              {transfer.phase === "download" ? "Downloading" : "Uploading"}{" "}
              {transfer.total ? `${Math.round((transfer.loaded / Math.max(1, transfer.total)) * 100)}%` : `${Math.round(transfer.loaded / (1024 * 1024))} MB`}
            </div>
          ) : null}

          <DownloadAssetsFooter
            onClose={onClose}
            selectedCount={selectedAssets.size}
            onDownload={handleDownload}
            onSaveToDrive={() => setDriveModalOpen(true)}
            saving={working}
            showDrive={downloadFormat === "zip"}
          />
        </div>
      </Modal>

      <DriveSaveModal
        isOpen={driveModalOpen}
        onClose={() => setDriveModalOpen(false)}
        fileName={`original_assets_${job.orderId}.zip`}
        clientId={driveClientId}
        onConnected={(v) => void saveZipToDrive(v)}
      />
    </>
  );
};
