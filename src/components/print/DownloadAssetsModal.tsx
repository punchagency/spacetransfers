import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getToken } from "../../utils/auth";
import { FiDownload } from "react-icons/fi";
import { Modal } from "../common/Modal";
import type { PrintJob } from "../../types/printQueue";
import { AssetStatsBar } from "./download-assets/AssetStatsBar";
import { AssetList } from "./download-assets/AssetList";
import { DownloadFormatSelector } from "./download-assets/DownloadFormatSelector";
import { DownloadAssetsFooter } from "./download-assets/DownloadAssetsFooter";
import { apiFetch, fetchBlobWithProgress, getApiBaseUrl, saveBlobToDisk, triggerAuthedDownload } from "../../utils/api";
import toast from "react-hot-toast";
import { DriveSaveModal } from "../drive/DriveSaveModal";
import { createResumableUploadSession, getDriveFileWebViewLink, uploadBlobResumable } from "../../utils/drive";

type ApiAsset = {
  id: string;
  filename: string;
  widthPx?: number;
  heightPx?: number;
  dpi?: number;
  downloadUrl: string;
  thumbnailUrl?: string | null;
  sizeBytes: number;
};

const formatBytes = (bytes: number) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

// Fetch pages concurrently — 4 at a time — and update assets as they arrive.
const PAGE_LIMIT = 200;
const CONCURRENT_PAGES = 4;

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
  const [downloadFormat, setDownloadFormat] = useState<"zip" | "individual">("zip");
  const [assets, setAssets] = useState<ApiAsset[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [working, setWorking] = useState(false);
  const [transfer, setTransfer] = useState<{
    phase: "download" | "upload";
    loaded: number;
    total: number | null;
  } | null>(null);
  const [driveModalOpen, setDriveModalOpen] = useState(false);
  const cancelRef = useRef(false);

  // O(1) lookup map — rebuilt only when assets array changes.
  const assetsById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  const mappedAssets = useMemo(
    () =>
      assets.map((a) => ({
        id: a.id,
        name: a.filename || "Unnamed Asset",
        size: formatBytes(a.sizeBytes || 0),
        type: "artwork" as const,
        fileType: (a.filename?.split(".").pop()?.toLowerCase() as any) || "png",
        thumbnailUrl: a.thumbnailUrl || null,
      })),
    [assets],
  );

  const totalSize = useMemo(() => {
    const bytes = assets
      .filter((a) => selectedAssets.has(a.id))
      .reduce((sum, a) => sum + (a.sizeBytes || 0), 0);
    return formatBytes(bytes);
  }, [assets, selectedAssets]);

  // Stream a large array into state in RAF chunks so the main thread never blocks.
  const streamIntoState = useCallback(
    (all: ApiAsset[], startFrom: number, knownTotal: number) => {
      if (cancelRef.current) return;
      const CHUNK = 300;
      const chunk = all.slice(startFrom, startFrom + CHUNK);
      if (chunk.length === 0) {
        setLoadingMore(false);
        return;
      }
      setAssets((prev) => [...prev, ...chunk]);
      const next = startFrom + CHUNK;
      if (next < all.length) {
        requestAnimationFrame(() => streamIntoState(all, next, knownTotal));
      } else {
        setTotalCount(knownTotal);
        setLoadingMore(false);
      }
    },
    [],
  );

  const loadAssets = useCallback(async () => {
    cancelRef.current = false;
    setAssets([]);
    setSelectedAssets(new Set());
    setTotalCount(null);
    setLoadingMore(false);
    setLoading(true);

    try {
      // Request page 1. If the backend supports pagination, `r.total` will be set.
      // If it doesn't, it returns everything at once — we handle both paths.
      const r = await apiFetch(
        `/printer/jobs/${encodeURIComponent(job.id)}/assets?limit=${PAGE_LIMIT}&page=1`,
      );
      if (cancelRef.current) return;

      const first: ApiAsset[] = Array.isArray(r?.assets) ? r.assets : [];
      const serverTotal: number =
        typeof r?.total === "number" ? r.total : first.length;

      if (first.length === 0) {
        setTotalCount(0);
        setLoading(false);
        return;
      }

      // Show the first PAGE_LIMIT items immediately — printer can start selecting.
      const instant = first.slice(0, PAGE_LIMIT);
      setAssets(instant);
      setTotalCount(serverTotal);
      setLoading(false);

      // If the backend returned MORE than PAGE_LIMIT in one shot (no pagination support),
      // stream the remainder into state without blocking the main thread.
      if (first.length > PAGE_LIMIT) {
        setLoadingMore(true);
        requestAnimationFrame(() => streamIntoState(first, PAGE_LIMIT, first.length));
        return;
      }

      // Backend supports pagination — fetch remaining pages concurrently.
      if (serverTotal > first.length) {
        setLoadingMore(true);
        const totalPages = Math.ceil(serverTotal / PAGE_LIMIT);
        const pageNums = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);

        for (let i = 0; i < pageNums.length; i += CONCURRENT_PAGES) {
          if (cancelRef.current) return;
          const batch = await Promise.all(
            pageNums.slice(i, i + CONCURRENT_PAGES).map((p) =>
              apiFetch(
                `/printer/jobs/${encodeURIComponent(job.id)}/assets?limit=${PAGE_LIMIT}&page=${p}`,
              )
                .then((res): ApiAsset[] => (Array.isArray(res?.assets) ? res.assets : []))
                .catch((): ApiAsset[] => []),
            ),
          );
          if (cancelRef.current) return;
          setAssets((prev) => [...prev, ...batch.flat()]);
        }
        setLoadingMore(false);
      }
    } catch (e: any) {
      if (!cancelRef.current) toast.error(e?.message || "Failed to load assets");
    } finally {
      if (!cancelRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [job.id, streamIntoState]);

  useEffect(() => {
    if (!isOpen) return;
    loadAssets();
    return () => {
      cancelRef.current = true;
    };
  }, [isOpen, loadAssets]);

  // Auto-switch to ZIP when a large selection is made — browsers block 10k+ individual file dialogs.
  useEffect(() => {
    if (selectedAssets.size > 50 && downloadFormat === "individual") {
      setDownloadFormat("zip");
    }
  }, [selectedAssets.size, downloadFormat]);

  const toggleAsset = useCallback((id: string) => {
    setSelectedAssets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedAssets((prev) =>
      prev.size === assets.length
        ? new Set()
        : new Set(assets.map((a) => a.id)),
    );
  }, [assets]);

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
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // Fetches the bundle zip into memory. Used ONLY by the Google-Drive save path,
  // which must have the bytes in hand to re-upload them. The direct save-to-disk
  // path uses a native streaming download instead (see handleDownload).
  const downloadZipBlob = async () => {
    const include = Array.from(selectedAssets);
    const includeParam = include.length ? include.join(",") : "ALL";
    const url = `${getApiBaseUrl()}/printer/jobs/${encodeURIComponent(job.id)}/assets/bundle/download?include=${encodeURIComponent(includeParam)}`;
    return await fetchBlobWithProgress(url, {
      headers: getAuthHeader(),
      onProgress: (p) =>
        setTransfer({ phase: "download", loaded: p.loaded, total: p.total }),
    });
  };

  const handleDownload = async () => {
    if (selectedAssets.size === 0) return;
    if (working) return;
    setWorking(true);

    try {
      if (downloadFormat === "individual") {
        const ids = Array.from(selectedAssets);
        const total = ids.length;
        let completed = 0;
        setTransfer({ phase: "download", loaded: 0, total });

        const addedUrls = new Set<string>();
        const queue = [...ids];
        const CONCURRENCY = 6;

        const worker = async () => {
          while (true) {
            const id = queue.shift();
            if (id === undefined) break;
            const asset = assetsById.get(id); // O(1)
            if (!asset?.downloadUrl || addedUrls.has(asset.downloadUrl)) {
              completed++;
              setTransfer({ phase: "download", loaded: completed, total });
              continue;
            }
            addedUrls.add(asset.downloadUrl);
            const out = await fetchBlobWithProgress(asset.downloadUrl);
            saveBlobToDisk(out.blob, out.filename || asset.filename || "asset");
            completed++;
            setTransfer({ phase: "download", loaded: completed, total });
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker),
        );
        toast.success(`${completed} file${completed !== 1 ? "s" : ""} downloaded`);
        onClose();
        return;
      }

      // Native browser download — streams the zip straight to disk instead of
      // buffering it in page memory, which corrupted large bundles.
      const include = Array.from(selectedAssets);
      const includeParam = include.length ? include.join(",") : "ALL";
      triggerAuthedDownload(
        `${getApiBaseUrl()}/printer/jobs/${encodeURIComponent(job.id)}/assets/bundle/download?include=${encodeURIComponent(includeParam)}`,
      );
      toast.success("Download started — check your browser downloads.");
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Download failed");
    } finally {
      setWorking(false);
      setTransfer(null);
    }
  };

  const driveClientId = (import.meta as any).env
    ?.VITE_GOOGLE_CLIENT_ID as string | undefined;

  const saveZipToDrive = async ({
    accessToken,
    folderId,
  }: {
    accessToken: string;
    folderId: string | null;
  }) => {
    if (selectedAssets.size === 0) return;
    if (working) return;
    setWorking(true);
    setTransfer({ phase: "download", loaded: 0, total: null });
    try {
      const downloaded = await downloadZipBlob();
      const fileName =
        downloaded.filename || `original_assets_${job.orderId}.zip`;
      const mimeType = downloaded.contentType || "application/zip";

      setTransfer({
        phase: "upload",
        loaded: 0,
        total: Math.max(downloaded.blob.size, 1),
      });
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
        onProgress: (p) =>
          setTransfer({ phase: "upload", loaded: p.loaded, total: p.total }),
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

  const loadedCount = assets.length;
  const knownTotal = totalCount ?? loadedCount;
  const loadPct = knownTotal > 0 ? Math.round((loadedCount / knownTotal) * 100) : 0;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        className="max-w-[800px] bg-white"
        title={headerContent}
      >
        <div className="space-y-4">
          <AssetStatsBar
            selectedCount={selectedAssets.size}
            totalSize={totalSize}
            loadedAssets={loadedCount}
            totalAssets={knownTotal}
            onToggleAll={toggleAll}
            isLoadingMore={loadingMore}
          />

          {/* Background load progress bar */}
          {loadingMore && knownTotal > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-gray-400">
                <span>Loading assets in background…</span>
                <span>
                  {loadedCount.toLocaleString()} / {knownTotal.toLocaleString()}
                </span>
              </div>
              <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-400 rounded-full transition-all duration-300"
                  style={{ width: `${loadPct}%` }}
                />
              </div>
            </div>
          )}

          <AssetList
            assets={mappedAssets}
            selectedAssets={selectedAssets}
            onToggleAsset={toggleAsset}
            isLoading={loading}
            isLoadingMore={loadingMore}
          />

          {selectedAssets.size > 0 && (
            <DownloadFormatSelector
              format={downloadFormat}
              onChange={setDownloadFormat}
            />
          )}

          {transfer ? (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-gray-500">
                <span>
                  {transfer.phase === "download" ? "Downloading" : "Uploading"}
                </span>
                <span>
                  {downloadFormat === "individual" && transfer.phase === "download"
                    ? `${transfer.loaded.toLocaleString()} / ${(transfer.total ?? 0).toLocaleString()} files`
                    : transfer.total
                      ? `${Math.round((transfer.loaded / Math.max(1, transfer.total)) * 100)}%`
                      : `${(transfer.loaded / (1024 * 1024)).toFixed(1)} MB`}
                </span>
              </div>
              {transfer.total && (
                <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-150"
                    style={{
                      width: `${Math.round((transfer.loaded / Math.max(1, transfer.total)) * 100)}%`,
                    }}
                  />
                </div>
              )}
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
