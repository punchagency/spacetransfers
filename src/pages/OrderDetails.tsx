import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { apiFetch, fetchBlobWithProgress, getApiBaseUrl, saveBlobToDisk } from "../utils/api";
import { CustomerInformation } from "../components/print/job-details/CustomerInformation";
import { OrderDetails } from "../components/print/job-details/OrderDetails";
import { PrintSpecifications } from "../components/print/job-details/PrintSpecifications";
import { ProductionNotes } from "../components/print/job-details/ProductionNotes";
import { StatusTimeline } from "../components/print/job-details/StatusTimeline";
import { DownloadAssetsModal } from "../components/print/DownloadAssetsModal";
import { SpaceLoader } from "../components/common/SpaceLoader";
import { DriveSaveModal } from "../components/drive/DriveSaveModal";
import { createResumableUploadSession, getDriveFileWebViewLink, uploadBlobResumable } from "../utils/drive";
import { GangsheetPreview } from "../components/print/download-gangsheet/GangsheetPreview";

type Overview = {
  id: string;
  orderId: string;
  status: string;
  priority: string;
  createdAt: string;
  customer: { name: string; email: string | null; phone: string | null; region: string | null };
  shippingAddress: any | null;
  specs: { sheetSize: string; filmType: string; itemsCount: number };
  notes: string;
  timeline: { status: string; time: string; message?: string | null }[];
  faceThumbnail?: string | null;
  pricing?: { subtotal: number | null; partnerCost?: number | null; rushFee: number; shippingCost: number | null; tax: number | null; total: number; currency: string };
  earnings?: { gross: number; commission: number; net: number; currency: string };
  payment?: { method: string | null; status: string };
};

const formatMoney = (amount: number | null | undefined, currency: string) => {
  const n = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
};

const roundMoney = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;

const statusLabelFromBackend = (s: string) => {
  const v = String(s || "").toUpperCase();
  if (v === "PENDING") return "Pending Review";
  if (v === "PROCESSING" || v === "PRINTING") return "In Progress";
  if (v === "QUALITY_CHECK") return "Ready";
  if (v === "SHIPPED" || v === "COMPLETED") return "Completed";
  if (v === "CANCELLED") return "Cancelled";
  return "Pending Review";
};

const statusForRadio = (label: string) => {
  if (label === "Pending Review") return "Pending Review";
  if (label === "In Progress") return "In Progress";
  if (label === "Ready") return "Ready";
  if (label === "Completed") return "Completed";
  return "Pending Review";
};

const radioOptions = [
  { key: "Pending Review", label: "Pending Review" },
  { key: "In Progress", label: "In Progress - Printing" },
  { key: "Ready", label: "Ready for Packaging" },
  { key: "Completed", label: "Completed" },
] as const;

const getAuthHeader = (): Record<string, string> => {
  const token = localStorage.getItem("printer_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export default function OrderDetailsPage() {
  const navigate = useNavigate();
  const { jobId } = useParams();

  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [previewSheet, setPreviewSheet] = useState<{ widthIn: number | null; heightIn: number | null }>({
    widthIn: null,
    heightIn: null,
  });
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [showAssets, setShowAssets] = useState(false);
  const [downloadingGangsheet, setDownloadingGangsheet] = useState(false);
  const [gangsheetDownloadProgress, setGangsheetDownloadProgress] = useState<{ loaded: number; total: number | null } | null>(null);
  const [driveModalOpen, setDriveModalOpen] = useState(false);
  const [savingToDrive, setSavingToDrive] = useState(false);
  const [driveProgress, setDriveProgress] = useState<{ phase: "download" | "upload"; loaded: number; total: number } | null>(null);

  const displayId = useMemo(() => {
    const id = String(jobId || "");
    return id ? `ORD-${id.slice(-4).toUpperCase()}` : "ORD";
  }, [jobId]);

  const selectedStatus = useMemo(() => {
    if (!overview) return "Pending Review";
    return statusForRadio(statusLabelFromBackend(overview.status));
  }, [overview]);

  useEffect(() => {
    if (!jobId) return;
    setLoading(true);
    Promise.all([
      apiFetch(`/printer/jobs/${encodeURIComponent(jobId)}/overview`),
      apiFetch(`/printer/jobs/${encodeURIComponent(jobId)}/gangsheet/preview?resolution=150`),
    ])
      .then(([ov, prev]) => {
        setOverview(ov || null);
        setPreviewDataUrl(prev?.previewDataUrl || null);
        setPreviewSheet({
          widthIn: typeof prev?.sheetWidthIn === "number" ? prev.sheetWidthIn : null,
          heightIn: typeof prev?.sheetHeightIn === "number" ? prev.sheetHeightIn : null,
        });
      })
      .catch((e: any) => {
        toast.error(e?.message || "Failed to load job");
        navigate("/orders");
      })
      .finally(() => setLoading(false));
  }, [jobId, navigate]);

  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const poll = async () => {
      try {
        const [ov, prev] = await Promise.all([
          apiFetch(`/printer/jobs/${encodeURIComponent(jobId)}/overview`),
          apiFetch(`/printer/jobs/${encodeURIComponent(jobId)}/gangsheet/preview?resolution=150`),
        ]);
        if (!alive) return;
        setOverview(ov || null);
        setPreviewDataUrl(prev?.previewDataUrl || null);
        setPreviewSheet({
          widthIn: typeof prev?.sheetWidthIn === "number" ? prev.sheetWidthIn : null,
          heightIn: typeof prev?.sheetHeightIn === "number" ? prev.sheetHeightIn : null,
        });
      } catch {
      }
    };
    const intervalId = window.setInterval(() => void poll(), 5000);
    return () => {
      alive = false;
      window.clearInterval(intervalId);
    };
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    const ac = new AbortController();
    const token = localStorage.getItem("printer_token");
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const url = `${getApiBaseUrl()}/orders/${encodeURIComponent(jobId)}/stream`;

    let buffer = "";
    let pendingRefresh: number | null = null;

    const scheduleRefresh = () => {
      if (pendingRefresh != null) return;
      pendingRefresh = window.setTimeout(() => {
        pendingRefresh = null;
        Promise.all([
          apiFetch(`/printer/jobs/${encodeURIComponent(jobId)}/overview`),
          apiFetch(`/printer/jobs/${encodeURIComponent(jobId)}/gangsheet/preview?resolution=150`),
        ])
          .then(([ov, prev]) => {
            setOverview(ov || null);
            setPreviewDataUrl(prev?.previewDataUrl || null);
            setPreviewSheet({
              widthIn: typeof prev?.sheetWidthIn === "number" ? prev.sheetWidthIn : null,
              heightIn: typeof prev?.sheetHeightIn === "number" ? prev.sheetHeightIn : null,
            });
          })
          .catch(() => {});
      }, 250);
    };

    const run = async () => {
      try {
        const resp = await fetch(url, { headers, signal: ac.signal });
        if (!resp.ok || !resp.body) return;
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            if (chunk.includes("event:")) {
              scheduleRefresh();
            }
          }
        }
      } catch {
      }
    };

    run();

    return () => {
      ac.abort();
      if (pendingRefresh != null) window.clearTimeout(pendingRefresh);
    };
  }, [jobId]);

  const currency = overview?.pricing?.currency || "USD";

  const paymentSummary = useMemo(() => {
    const pricing = overview?.pricing;
    return {
      base: roundMoney(Number(pricing?.partnerCost ?? pricing?.subtotal ?? 0)),
    };
  }, [overview]);

  const setStatus = async (nextKey: string) => {
    if (!overview) return;
    setUpdatingStatus(true);
    try {
      await apiFetch(`/printer/orders/${encodeURIComponent(overview.id)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextKey }),
      });
      const refreshed = await apiFetch(`/printer/jobs/${encodeURIComponent(overview.id)}/overview`);
      setOverview(refreshed || null);
      toast.success("Status updated");
    } catch (e: any) {
      toast.error(e?.message || "Failed to update status");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const downloadGangsheet = async () => {
    if (!overview) return;
    setDownloadingGangsheet(true);
    setGangsheetDownloadProgress({ loaded: 0, total: null });
    try {
      const r = await apiFetch(`/printer/jobs/${encodeURIComponent(overview.id)}/gangsheet/export`, {
        method: "POST",
        body: JSON.stringify({ format: "PNG", toDrive: false }),
      });
      const exportId = String(r?.exportId || "");
      if (!exportId) throw new Error("Export failed");
      const url = `${getApiBaseUrl()}/printer/exports/${encodeURIComponent(exportId)}/file`;
      const out = await fetchBlobWithProgress(url, {
        headers: getAuthHeader(),
        onProgress: (p) => setGangsheetDownloadProgress(p),
      });
      saveBlobToDisk(out.blob, out.filename || `gangsheet_${overview.id}_600dpi.png`);
      toast.success("Gangsheet downloaded");
    } catch (e: any) {
      toast.error(e?.message || "Download failed");
    } finally {
      setDownloadingGangsheet(false);
      setGangsheetDownloadProgress(null);
    }
  };

  const saveGangsheetToDrive = async ({ accessToken, folderId }: { accessToken: string; folderId: string | null }) => {
    if (!overview) return;
    if (savingToDrive) return;
    setSavingToDrive(true);
    setDriveProgress({ phase: "download", loaded: 0, total: 1 });
    try {
      const r = await apiFetch(`/printer/jobs/${encodeURIComponent(overview.id)}/gangsheet/export`, {
        method: "POST",
        body: JSON.stringify({ format: "PNG", toDrive: false }),
      });
      const exportId = String(r?.exportId || "");
      if (!exportId) throw new Error("Export failed");

      const url = `${getApiBaseUrl()}/printer/exports/${encodeURIComponent(exportId)}/file`;
      const downloaded = await fetchBlobWithProgress(url, {
        headers: getAuthHeader(),
        onProgress: (p) => {
          const t = p.total ?? Math.max(p.loaded, 1);
          setDriveProgress({ phase: "download", loaded: p.loaded, total: t });
        },
      });

      const fileName = downloaded.filename || `gangsheet_${overview.id}_600dpi.png`;
      const mimeType = downloaded.contentType || "image/png";

      setDriveProgress({ phase: "upload", loaded: 0, total: Math.max(downloaded.blob.size, 1) });
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
        onProgress: (p) => setDriveProgress({ phase: "upload", loaded: p.loaded, total: p.total }),
      });
      const link = await getDriveFileWebViewLink(accessToken, fileId);
      toast.success("Saved to Google Drive");
      window.open(link, "_blank");
    } catch (e: any) {
      toast.error(e?.message || "Google Drive upload failed");
    } finally {
      setSavingToDrive(false);
      setDriveProgress(null);
    }
  };

  const driveClientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string | undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gray-100 overflow-hidden flex items-center justify-center flex-shrink-0">
            <img
              src={overview?.faceThumbnail || "/space.svg"}
              alt="thumbnail"
              className={overview?.faceThumbnail ? "w-full h-full object-cover" : "w-7 h-7 opacity-80"}
            />
          </div>

          <div className="space-y-1">
          <Link to="/orders" className="text-sm text-gray-500 hover:text-gray-700">
            ← Back to Jobs
          </Link>
          <div className="text-2xl font-bold text-gray-900">Order {displayId}</div>
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span>{overview?.customer?.name || "—"}</span>
            {overview?.customer?.region && <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">{overview.customer.region}</span>}
            {overview?.priority === "URGENT" && <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-xs font-bold border border-red-100">Urgent</span>}
          </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-10">
          <SpaceLoader label="Loading order…" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-300">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 font-bold text-gray-900 border-b border-gray-100">Gangsheet Preview</div>
              <div className="p-4">
                <GangsheetPreview
                  showTitle={false}
                  previewDataUrl={previewDataUrl}
                  sheetWidthIn={previewSheet.widthIn}
                  sheetHeightIn={previewSheet.heightIn}
                />

                <div className="mt-4 flex flex-col sm:flex-row gap-3">
                  <button
                    disabled={downloadingGangsheet || savingToDrive}
                    onClick={() => void downloadGangsheet()}
                    className="flex-1 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-60"
                  >
                    {downloadingGangsheet ? (
                      <span className="inline-flex items-center gap-2">
                        <SpaceLoader size={18} layout="inline" />
                        Downloading…
                      </span>
                    ) : (
                      "Download Gangsheet"
                    )}
                  </button>
                  <button
                    disabled={downloadingGangsheet || savingToDrive}
                    onClick={() => setDriveModalOpen(true)}
                    className="flex-1 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-60"
                  >
                    {savingToDrive ? (
                      <span className="inline-flex items-center gap-2">
                        <SpaceLoader size={18} layout="inline" />
                        Saving…
                      </span>
                    ) : (
                      "Download to Google Drive"
                    )}
                  </button>
                  <button
                    onClick={() => setShowAssets(true)}
                    className="flex-1 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    Download Original
                  </button>
                </div>

                {(gangsheetDownloadProgress || driveProgress) && (
                  <div className="mt-3 text-xs text-gray-500">
                    {driveProgress ? (
                      <>
                        {driveProgress.phase === "download" ? "Downloading" : "Uploading"}{" "}
                        {Math.round((driveProgress.loaded / Math.max(1, driveProgress.total)) * 100)}%
                      </>
                    ) : gangsheetDownloadProgress?.total ? (
                      <>Downloading {Math.round((gangsheetDownloadProgress.loaded / Math.max(1, gangsheetDownloadProgress.total)) * 100)}%</>
                    ) : (
                      <>Downloading…</>
                    )}
                  </div>
                )}
              </div>
            </div>

            {overview && (
              <>
                <StatusTimeline
                  job={{
                    id: overview.id,
                    orderId: `#ORD-${overview.id.slice(-6).toUpperCase()}`,
                    customer: overview.customer.name,
                    sheetSize: overview.specs.sheetSize,
                    orderDescription: `${overview.specs.itemsCount} Items`,
                    status: statusLabelFromBackend(overview.status) as any,
                    deadline: overview.createdAt,
                    priority: overview.priority === "URGENT" ? ("Urgent" as any) : undefined,
                  }}
                  timeline={overview.timeline || []}
                />
                <PrintSpecifications
                  job={{
                    id: overview.id,
                    orderId: `#ORD-${overview.id.slice(-6).toUpperCase()}`,
                    customer: overview.customer.name,
                    sheetSize: overview.specs.sheetSize,
                    orderDescription: `${overview.specs.itemsCount} Items`,
                    status: statusLabelFromBackend(overview.status) as any,
                    deadline: overview.createdAt,
                    priority: overview.priority === "URGENT" ? ("Urgent" as any) : undefined,
                  }}
                  itemsCount={overview.specs.itemsCount}
                  exportDpi={600}
                />
                <ProductionNotes jobId={overview.id} initialNotes={overview.notes} />
              </>
            )}
          </div>

          <div className="space-y-6">
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 font-bold text-gray-900 border-b border-gray-100">Update Status</div>
              <div className="p-4 space-y-2">
                {radioOptions.map((o) => (
                  <label key={o.key} className={`flex items-center gap-3 p-3 rounded-xl border ${selectedStatus === o.key ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-white"}`}>
                    <input
                      type="radio"
                      name="status"
                      checked={selectedStatus === o.key}
                      disabled={updatingStatus}
                      onChange={() => void setStatus(o.key)}
                      className="w-4 h-4"
                    />
                    <div className="text-sm font-semibold text-gray-800">{o.label}</div>
                  </label>
                ))}
              </div>
            </div>

            {overview && (
              <>
                <CustomerInformation customer={overview.customer} shippingAddress={overview.shippingAddress} />

                <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-5 py-4 font-bold text-gray-900 border-b border-gray-100">Payment Summary</div>
                  <div className="p-5">
                    <dl className="space-y-3 text-sm">
                      <div className="flex items-center justify-between">
                        <dt className="text-gray-600">Base price</dt>
                        <dd className="font-semibold text-gray-900 tabular-nums">
                          {formatMoney(paymentSummary.base, currency)}
                        </dd>
                      </div>
                    </dl>

                    <div className={`mt-4 px-3 py-2 rounded-xl text-xs font-semibold ${overview.payment?.status === "secured" ? "bg-green-50 text-green-700 border border-green-100" : "bg-gray-50 text-gray-700 border border-gray-200"}`}>
                      {overview.payment?.status === "secured" ? "Payment secured" : "Payment status unavailable"}
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-5 py-4 font-bold text-gray-900 border-b border-gray-100">Your Earnings</div>
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-gray-600">Estimated payout</div>
                      <div className="text-xl font-bold text-blue-600">
                        {formatMoney(overview.earnings?.net || 0, currency)}
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-gray-500">
                      Commission: {formatMoney(overview.earnings?.commission || 0, currency)}
                    </div>
                  </div>
                </div>

                <OrderDetails
                  orderId={`#ORD-${overview.id.slice(-6).toUpperCase()}`}
                  createdAt={new Date(overview.createdAt).toLocaleString()}
                  dueDate={new Date(overview.createdAt).toLocaleDateString()}
                  itemsCount={overview.specs.itemsCount}
                />
              </>
            )}
          </div>
        </div>
      )}

      {showAssets && overview && (
        <DownloadAssetsModal isOpen={true} onClose={() => setShowAssets(false)} job={{
          id: overview.id,
          orderId: `#ORD-${overview.id.slice(-6).toUpperCase()}`,
          customer: overview.customer.name,
          sheetSize: overview.specs.sheetSize,
          orderDescription: `${overview.specs.itemsCount} Items`,
          status: statusLabelFromBackend(overview.status) as any,
          deadline: overview.createdAt,
          priority: overview.priority === "URGENT" ? ("Urgent" as any) : undefined,
        }} />
      )}

      <DriveSaveModal
        isOpen={driveModalOpen}
        onClose={() => setDriveModalOpen(false)}
        fileName={overview ? `gangsheet_${overview.id}_600dpi.png` : "gangsheet.png"}
        clientId={driveClientId}
        onConnected={(v) => void saveGangsheetToDrive(v)}
      />
    </div>
  );
}
