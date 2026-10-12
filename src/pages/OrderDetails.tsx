import { useEffect, useMemo, useRef, useState } from "react";
import { describeLabelFailure } from "../utils/labelFailure";
import { getToken } from "../utils/auth";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { apiFetch, fetchBlobWithProgress, getApiBaseUrl, triggerAuthedDownload } from "../utils/api";
import { formatDateTime } from "../utils/datetime";
import { CustomerInformation } from "../components/print/job-details/CustomerInformation";
import { OrderDetails } from "../components/print/job-details/OrderDetails";
import { PrintSpecifications } from "../components/print/job-details/PrintSpecifications";
import { ProductionNotes } from "../components/print/job-details/ProductionNotes";
import { StatusTimeline } from "../components/print/job-details/StatusTimeline";
import { JobIssues } from "../components/print/job-details/JobIssues";
import { DownloadAssetsModal } from "../components/print/DownloadAssetsModal";
import { SpaceLoader } from "../components/common/SpaceLoader";
import { DriveSaveModal } from "../components/drive/DriveSaveModal";
import { createResumableUploadSession, getDriveFileWebViewLink, uploadBlobResumable } from "../utils/drive";
import { GangsheetPreview } from "../components/print/download-gangsheet/GangsheetPreview";
import { SheetPicker, type JobSheet } from "../components/print/SheetPicker";
import { ConfirmDialog } from "../components/common/ConfirmDialog";
import { confirmCopy, timelineStepAction, type ConfirmableStep } from "../utils/statusActions";

type Overview = {
  id: string;
  sheets?: JobSheet[];
  /** Why the last label attempt failed; cleared when a label is made. */
  shipStationError?: string | null;
  orderId: string;
  displayId?: string | null;
  status: string;
  /** The partner-facing label, decided server-side by `printerStatusLabel`. */
  statusLabel?: string | null;
  priority: string;
  createdAt: string;
  assignedAt?: string | null;
  /** When the next step is due (ISO): accept by, then print by; null after that. */
  deadline?: string | null;
  dueStage?: "ACCEPT" | "PRINT" | null;
  customer: { name: string; email: string | null; phone: string | null; region: string | null };
  shippingAddress: any | null;
  specs: {
    sheetSize: string;
    filmType: string;
    itemsCount: number;
    sheetCount?: number;
    graphicCount?: number;
    printCount?: number;
    printDpi?: number;
  };
  notes: string;
  timeline: { status: string; time: string; message?: string | null }[];
  faceThumbnail?: string | null;
  pricing?: { base?: number | null; rushFee?: number | null; specialInkFee?: number | null; partnerCost?: number | null; total: number; currency: string };
  /** `realized` is false until the job ships — partners are paid on shipment. `derivable` is false when the items carry no printable dimensions to cost. */
  earnings?: { net: number; currency: string; realized?: boolean; derivable?: boolean };
  payment?: { method: string | null };
  trackingNumber?: string | null;
  carrier?: string | null;
  trackingUrl?: string | null;
  shipStationTriggeredAt?: string | null;
  shipStationLabelUrl?: string | null;
};

const formatMoney = (amount: number | null | undefined, currency: string) => {
  const n = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
};

const roundMoney = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;

/*
 * The status label comes from the server now.
 *
 * This page kept its own copy of the vocabulary and it disagreed with the
 * shared map twice: PROCESSING read "In Progress - Printing" (the shared map
 * says Pending Review — the partner has not started it) and COMPLETED read
 * "Delivered". So one order was described three different ways across Home,
 * Jobs & Orders and its own detail page. `printerStatusLabel` decides, once.
 */
const labelOf = (o: { statusLabel?: string | null; status?: string } | null) =>
  o?.statusLabel || "Pending Review";

const statusForRadio = (label: string) => {
  if (label === "Pending Review") return "Pending Review";
  if (label === "In Progress - Printing") return "In Progress - Printing";
  if (label === "Print Shipping Label") return "Print Shipping Label";
  return "Pending Review";
};

const radioOptions = [
  { key: "Pending Review",       label: "Pending Review",       rank: 0 },
  { key: "In Progress - Printing", label: "In Progress - Printing", rank: 1 },
  { key: "Print Shipping Label", label: "Print Shipping Label", rank: 2 },
] as const;

// Maps the raw backend status to the rank of the highest radio option already reached.
// Any radio option at a lower rank than this is locked — status can only move forward.
const BACKEND_STATUS_RANK: Record<string, number> = {
  PENDING: 0, PROCESSING: 1, PRINTING: 1, QUALITY_CHECK: 2, SHIPPED: 3, COMPLETED: 4,
};

const getAuthHeader = (): Record<string, string> => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const LabelFailed = ({ error, busy, onRetry }: { error: string; busy: boolean; onRetry: () => void }) => {
  const { title, body } = describeLabelFailure(error);
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
      <div>
        <div className="text-sm font-semibold text-red-800">{title}</div>
        <p className="mt-1 text-xs leading-relaxed text-red-700">{body}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        className="flex items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-60"
      >
        {busy ? "Trying again…" : "Try again"}
      </button>
      <details className="text-[11px] text-red-600/80">
        <summary className="cursor-pointer select-none">Details for support</summary>
        <div className="mt-1 break-words font-mono">{error}</div>
      </details>
    </div>
  );
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
  const [sheetIndex, setSheetIndex] = useState(0);
  const sheetRef = useRef(0);
  sheetRef.current = sheetIndex;
  const previewPath = () =>
    `/printer/jobs/${encodeURIComponent(String(jobId))}/gangsheet/preview?resolution=600&sheet=${sheetRef.current}`;
  /** Applies a preview only if it is for the sheet still on screen. */
  const applyPreview = (forSheet: number, prev: any) => {
    if (forSheet !== sheetRef.current) return;
    setPreviewDataUrl(prev?.previewDataUrl || null);
    setPreviewSheet({
      widthIn: typeof prev?.sheetWidthIn === "number" ? prev.sheetWidthIn : null,
      heightIn: typeof prev?.sheetHeightIn === "number" ? prev.sheetHeightIn : null,
    });
  };
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [showAssets, setShowAssets] = useState(false);
  const [pngExportProgress, setPngExportProgress] = useState<{ phase: string; pct: number } | null>(null);
  const [driveModalOpen, setDriveModalOpen] = useState(false);
  const [savingToDrive, setSavingToDrive] = useState(false);
  const [driveProgress, setDriveProgress] = useState<{ phase: "download" | "upload"; loaded: number; total: number } | null>(null);

  const displayId = useMemo(() => {
    if (overview?.displayId) return String(overview.displayId);
    const id = String(jobId || "");
    return id ? `#${id.slice(-8).toUpperCase()}` : "—";
  }, [overview?.displayId, jobId]);

  const sheets: JobSheet[] = Array.isArray(overview?.sheets) ? overview!.sheets! : [];

  const selectedStatus = useMemo(() => {
    if (!overview) return "Pending Review";
    return statusForRadio(labelOf(overview));
  }, [overview]);

  // Rank of the current backend status — radio options below this rank are locked.
  const currentStatusRank = useMemo(() => {
    if (!overview) return 0;
    return BACKEND_STATUS_RANK[overview.status.toUpperCase()] ?? 0;
  }, [overview]);

  useEffect(() => {
    if (!jobId) return;
    setLoading(true);
    const forSheet = sheetRef.current;
    const previewFetch = apiFetch(previewPath()).catch(() => null);
    Promise.all([
      apiFetch(`/printer/jobs/${encodeURIComponent(jobId)}/overview`),
      previewFetch,
    ])
      .then(([ov, prev]) => {
        setOverview(ov || null);
        applyPreview(forSheet, prev);
      })
      .catch((e: any) => {
        toast.error(e?.message || "Failed to load job");
        navigate("/orders");
      })
      .finally(() => setLoading(false));
  }, [jobId, navigate]);

  // A different sheet chosen: show its preview.
  useEffect(() => {
    if (!jobId) return;
    const forSheet = sheetIndex;
    setPreviewDataUrl(null);
    apiFetch(previewPath())
      .then((prev) => applyPreview(forSheet, prev))
      .catch(() => applyPreview(forSheet, null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetIndex]);

  // Poll every 3 s while ShipStation is generating the label (QUALITY_CHECK, no labelUrl yet).
  useEffect(() => {
    if (!jobId) return;
    if (overview?.status !== "QUALITY_CHECK" || overview?.shipStationLabelUrl) return;
    const id = setInterval(async () => {
      try {
        const refreshed = await apiFetch(`/printer/jobs/${encodeURIComponent(jobId)}/overview`);
        if (refreshed) setOverview(refreshed);
        if (refreshed?.shipStationLabelUrl || refreshed?.status !== "QUALITY_CHECK") {
          clearInterval(id);
        }
      } catch { /* ignore — will retry */ }
    }, 3000);
    return () => clearInterval(id);
  }, [jobId, overview?.status, overview?.shipStationLabelUrl]);

  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const poll = async () => {
      try {
        const forSheet = sheetRef.current;
        const [ov, prev] = await Promise.all([
          apiFetch(`/printer/jobs/${encodeURIComponent(jobId)}/overview`),
          apiFetch(previewPath()).catch(() => null),
        ]);
        if (!alive) return;
        setOverview(ov || null);
        applyPreview(forSheet, prev);
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
    const token = getToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const url = `${getApiBaseUrl()}/orders/${encodeURIComponent(jobId)}/stream`;

    let buffer = "";
    let pendingRefresh: number | null = null;

    const scheduleRefresh = () => {
      if (pendingRefresh != null) return;
      pendingRefresh = window.setTimeout(() => {
        pendingRefresh = null;
        const forSheet = sheetRef.current;
        Promise.all([
          apiFetch(`/printer/jobs/${encodeURIComponent(jobId)}/overview`),
          apiFetch(previewPath()).catch(() => null),
        ])
          .then(([ov, prev]) => {
            setOverview(ov || null);
            applyPreview(forSheet, prev);
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

  /*
   * One breakdown. "Payment Summary" and "Your Earnings" were two cards showing
   * the same number under two labels — "Base price" and "Estimated payout" —
   * and the first sat under a "Payment secured" badge the server invented for
   * every order. Rush pay was inside the total and reported as a separate zero.
   */
  const earningsBreakdown = useMemo(() => {
    const p = overview?.pricing;
    return {
      base: roundMoney(Number(p?.base ?? p?.partnerCost ?? 0)),
      rushFee: roundMoney(Number(p?.rushFee ?? 0)),
      specialInkFee: roundMoney(Number(p?.specialInkFee ?? 0)),
      total: roundMoney(Number(overview?.earnings?.net ?? p?.partnerCost ?? 0)),
      realized: Boolean(overview?.earnings?.realized),
      derivable: overview?.earnings?.derivable !== false,
    };
  }, [overview]);

  const [pendingStep, setPendingStep] = useState<ConfirmableStep | null>(null);

  const [labelRetryAt, setLabelRetryAt] = useState<number | null>(null);
  const retryingLabel = labelRetryAt !== null && Date.now() - labelRetryAt < 8000;
  const retryLabel = async () => {
    setLabelRetryAt(Date.now());
    await setStatus("Print Shipping Label");
  };

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

  const exportPng = async () => {
    if (!overview) return;
    setPngExportProgress({ phase: "Preparing...", pct: 0 });
    try {
      const startRes = await apiFetch(`/printer/jobs/${encodeURIComponent(overview.id)}/gangsheet/png-export`, {
        method: "POST",
        body: JSON.stringify({ sheet: sheetIndex }),
      });
      const exportJobId = String(startRes?.exportJobId || "");
      if (!exportJobId) throw new Error("Export failed to start");

      let exportId = "";
      while (true) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        const statusRes = await apiFetch(`/printer/jobs/export-status/${encodeURIComponent(exportJobId)}`);
        setPngExportProgress({
          phase: String(statusRes?.message || "Processing..."),
          pct: typeof statusRes?.progress === "number" ? statusRes.progress : 50,
        });
        if (statusRes?.status === "done") {
          exportId = String(statusRes.result?.exportId || "");
          break;
        } else if (statusRes?.status === "failed") {
          throw new Error(statusRes.error || "Export failed");
        }
      }

      if (!exportId) throw new Error("Export ID missing");
      setPngExportProgress({ phase: "Starting download...", pct: 100 });

      // Native browser download — streams straight to disk. Required for large
      // split-gangsheet zips that the previous in-memory Blob download corrupted.
      triggerAuthedDownload(`${getApiBaseUrl()}/printer/exports/${encodeURIComponent(exportId)}/file`);

      toast.success("Download started — check your browser downloads.");
      await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    } catch (e: any) {
      toast.error(e?.message || "PNG export failed");
    } finally {
      setPngExportProgress(null);
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
        body: JSON.stringify({ format: "PNG", toDrive: false, sheet: sheetIndex }),
      });
      const exportJobId = String(r?.exportJobId || "");
      if (!exportJobId) throw new Error("Export failed");

      let exportId = "";
      while (true) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        const statusRes = await apiFetch(`/printer/jobs/export-status/${encodeURIComponent(exportJobId)}`);
        if (statusRes.status === "done") {
          exportId = String(statusRes.result?.exportId || "");
          break;
        } else if (statusRes.status === "failed") {
          throw new Error(statusRes.error || "Export failed");
        }
      }

      if (!exportId) throw new Error("Export failed");
      const url = `${getApiBaseUrl()}/printer/exports/${encodeURIComponent(exportId)}/file`;
      const downloaded = await fetchBlobWithProgress(url, {
        headers: getAuthHeader(),
        onProgress: (p) => {
          const t = p.total ?? Math.max(p.loaded, 1);
          setDriveProgress({ phase: "download", loaded: p.loaded, total: t });
        },
      });

      const fileName = downloaded.filename || `gangsheet_${overview.orderId}.png`;
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
            {overview && <JobIssues orderId={overview.id} />}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 font-bold text-gray-900 border-b border-gray-100">
                {sheets.length > 1 ? `Gangsheet Preview · ${sheets.length} sheets` : "Gangsheet Preview"}
              </div>
              <div className="p-4">
                <SheetPicker sheets={sheets} value={sheetIndex} onChange={setSheetIndex} />
                <GangsheetPreview
                  showTitle={false}
                  previewDataUrl={previewDataUrl}
                  sheetWidthIn={previewSheet.widthIn}
                  sheetHeightIn={previewSheet.heightIn}
                />

                <div className="mt-4 flex flex-col sm:flex-row gap-3">
                  <button
                    disabled={savingToDrive || pngExportProgress !== null}
                    onClick={() => void exportPng()}
                    className="flex-1 px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-60 min-h-[42px]"
                  >
                    {pngExportProgress !== null ? (
                      <span className="flex flex-col items-center gap-1 w-full">
                        <span className="text-xs font-medium">
                          {pngExportProgress.phase} {pngExportProgress.pct}%
                        </span>
                        <span className="w-full h-1.5 bg-indigo-800/40 rounded-full overflow-hidden">
                          <span
                            className="h-full bg-white rounded-full transition-all duration-300 block"
                            style={{ width: `${pngExportProgress.pct}%` }}
                          />
                        </span>
                      </span>
                    ) : sheets.length > 1 ? (
                      `Export Sheet ${sheetIndex + 1} PNG`
                    ) : (
                      "Export PNG"
                    )}
                  </button>
                  <button
                    disabled={savingToDrive || pngExportProgress !== null}
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

                {driveProgress && (
                  <div className="mt-3 text-xs text-gray-500">
                    {driveProgress.phase === "download" ? "Downloading" : "Uploading"}{" "}
                    {Math.round((driveProgress.loaded / Math.max(1, driveProgress.total)) * 100)}%
                  </div>
                )}
              </div>
            </div>

            {overview && (
              <>
                <StatusTimeline
                  job={{
                    id: overview.id,
                    orderId: overview.orderId,
                    customer: overview.customer.name,
                    sheetSize: overview.specs.sheetSize,
                    orderDescription: `${overview.specs.itemsCount} Items`,
                    status: labelOf(overview) as any,
                    deadline: overview.deadline || "",
                    createdAt: overview.createdAt,
                    priority: overview.priority === "URGENT" ? ("Urgent" as any) : undefined,
                  }}
                  timeline={overview.timeline || []}
                  backendStatus={overview.status}
                  assignedAt={overview.assignedAt || null}
                  stepAction={(step) => timelineStepAction(step, overview.status, Boolean(overview.shipStationLabelUrl))}
                  onStepClick={setPendingStep}
                  busy={updatingStatus}
                />
                <PrintSpecifications
                  job={{
                    id: overview.id,
                    orderId: overview.orderId,
                    customer: overview.customer.name,
                    sheetSize: overview.specs.sheetSize,
                    orderDescription: `${overview.specs.itemsCount} Items`,
                    status: labelOf(overview) as any,
                    deadline: overview.deadline || "",
                    createdAt: overview.createdAt,
                    priority: overview.priority === "URGENT" ? ("Urgent" as any) : undefined,
                  }}
                  specs={overview.specs}
                  sheets={sheets}
                />
                <ProductionNotes jobId={overview.id} initialNotes={overview.notes} />
              </>
            )}
          </div>

          <div className="space-y-6">
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 font-bold text-gray-900 border-b border-gray-100">
                {overview?.status === "SHIPPED" ? "Order Shipped" :
                 overview?.status === "COMPLETED" ? "Order Delivered" :
                 "Update Status"}
              </div>
              <div className="p-4 space-y-2">
                {overview?.status === "COMPLETED" ? (
                  <div className="flex flex-col items-center gap-3 py-4 text-center">
                    <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div className="text-sm font-bold text-green-700">Delivered</div>
                    <div className="text-xs text-gray-500">This order has been delivered to the customer.</div>
                    {overview.trackingNumber && (
                      <div className="text-xs font-mono bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700">
                        {overview.carrier ? `${overview.carrier.toUpperCase()} · ` : ""}{overview.trackingNumber}
                      </div>
                    )}
                  </div>
                ) : overview?.status === "SHIPPED" ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-blue-700 text-sm font-semibold">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zm10 0a2 2 0 11-4 0 2 2 0 014 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l2 .002M13 16l2 .002M13 16V8h4l3 5v3h-2" />
                      </svg>
                      In Transit
                    </div>
                    {overview.trackingNumber && (
                      <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 space-y-1.5">
                        <div className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Tracking Number</div>
                        <div className="text-sm font-mono font-semibold text-gray-900">{overview.trackingNumber}</div>
                        {overview.carrier && <div className="text-xs text-gray-500">Carrier: {overview.carrier.toUpperCase()}</div>}
                        {overview.trackingUrl && (
                          <a href={overview.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">Track Package →</a>
                        )}
                      </div>
                    )}
                    <div className="text-xs text-gray-500 leading-relaxed">The status will automatically update to Delivered once the carrier confirms delivery.</div>
                    {overview.shipStationLabelUrl && (
                      <a
                        href={overview.shipStationLabelUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        Reprint Shipping Label
                      </a>
                    )}
                  </div>
                ) : overview?.status === "QUALITY_CHECK" && overview?.shipStationLabelUrl ? (
                  // Label is ready — printer reviews and confirms
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-green-700 text-sm font-semibold">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Shipping label ready
                    </div>

                    <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 space-y-1.5 text-xs">
                      <div className="font-semibold text-gray-700 uppercase tracking-wide text-[10px]">Ship To</div>
                      <div className="text-gray-900 font-medium">
                        {overview.customer.name}
                      </div>
                      {overview.shippingAddress && (
                        <div className="text-gray-500 leading-relaxed">
                          {overview.shippingAddress.street}<br />
                          {overview.shippingAddress.city}, {overview.shippingAddress.state} {overview.shippingAddress.postalCode}
                        </div>
                      )}
                    </div>

                    {overview.trackingNumber && (
                      <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 space-y-1">
                        <div className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Tracking</div>
                        <div className="text-sm font-mono font-semibold text-gray-900">{overview.trackingNumber}</div>
                        {overview.carrier && <div className="text-xs text-gray-500">{overview.carrier.toUpperCase()}</div>}
                      </div>
                    )}

                    {/*
                      "generated" means ShipStation made the label but sent back no
                      printable copy. Linking to it opened a page that doesn't exist;
                      the label modal already treats it this way.
                    */}
                    {overview.shipStationLabelUrl !== "generated" ? (
                      <a
                        href={overview.shipStationLabelUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        Open & Print Label
                      </a>
                    ) : (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
                        The label was created, but ShipStation didn't send back a printable copy.
                        Contact Space Transfers for the label before you hand the package over.
                      </div>
                    )}

                    <button
                      disabled={updatingStatus}
                      onClick={() => setPendingStep("Order Shipped")}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-60"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {updatingStatus ? "Confirming…" : "Confirm — Package Ready for Pickup"}
                    </button>

                    <div className="text-[11px] text-gray-400 text-center leading-relaxed">
                      Attach the label to the package, then confirm. The customer will be notified when the carrier scans it.
                    </div>
                  </div>
                ) : overview?.status === "QUALITY_CHECK" && (overview?.shipStationTriggeredAt || retryingLabel) ? (
                  <div className="flex flex-col items-center gap-3 py-4 text-center">
                    <SpaceLoader size={28} layout="inline" />
                    <div className="text-sm font-semibold text-gray-800">Generating shipping label…</div>
                    <div className="text-xs text-gray-500">ShipStation is creating your label. This usually takes a few seconds.</div>
                  </div>
                ) : overview?.status === "QUALITY_CHECK" && overview?.shipStationError ? (
                  <LabelFailed
                    error={overview.shipStationError}
                    busy={updatingStatus}
                    onRetry={() => void retryLabel()}
                  />
                ) : (
                  radioOptions.map((o) => {
                    const isPast = o.rank < currentStatusRank;
                    const isCurrent = selectedStatus === o.key;
                    return (
                      <label
                        key={o.key}
                        className={`flex items-center gap-3 p-3 rounded-xl border transition-opacity ${
                          isCurrent
                            ? "border-blue-300 bg-blue-50"
                            : isPast
                            ? "border-gray-100 bg-gray-50 opacity-40 cursor-not-allowed"
                            : "border-gray-200 bg-white"
                        }`}
                      >
                        <input
                          type="radio"
                          name="status"
                          checked={isCurrent}
                          disabled={updatingStatus || isPast}
                          onChange={() => {
                            if (isPast || isCurrent) return;
                            if (o.key === "In Progress - Printing" || o.key === "Print Shipping Label") setPendingStep(o.key);
                          }}
                          className="w-4 h-4"
                        />
                        <div className={`text-sm font-semibold ${isPast ? "text-gray-400" : "text-gray-800"}`}>
                          {o.label}
                        </div>
                        {isPast && (
                          <span className="ml-auto text-[10px] font-medium text-gray-400 uppercase tracking-wide">Locked</span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {overview && (
              <>
                <CustomerInformation customer={overview.customer} shippingAddress={overview.shippingAddress} />

                {/*
                  One card, not two.
                
                  "Payment Summary" and "Your Earnings" showed the SAME number under two
                  labels — "Base price" and "Estimated payout" — and the first sat under a
                  "Payment secured" badge the server invented for every order that was not
                  cancelled. Nothing records whether the customer's payment actually
                  succeeded, and a partner is paid by the platform regardless, so it was
                  never their question. Rush pay was inside the total and reported as a
                  separate zero; it has its own line now, when it applies.
                */}
                <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-5 py-4 font-bold text-gray-900 border-b border-gray-100">Your Earnings</div>
                  <div className="p-5">
                    {overview.status === "CANCELLED" && !earningsBreakdown.realized ? (
                      <p className="text-sm text-gray-600">
                        This job was cancelled before it shipped, so it doesn&rsquo;t pay.
                      </p>
                    ) : !earningsBreakdown.derivable ? (
                      <p className="text-sm text-amber-700">
                        This job&rsquo;s artwork carries no printable dimensions, so we cannot work out
                        its payout yet. Please contact support before printing it.
                      </p>
                    ) : (
                      <>
                        <dl className="space-y-3 text-sm">
                          <div className="flex items-center justify-between">
                            <dt className="text-gray-600">Print</dt>
                            <dd className="font-semibold text-gray-900 tabular-nums">
                              {formatMoney(earningsBreakdown.base, currency)}
                            </dd>
                          </div>
                          {earningsBreakdown.rushFee > 0 && (
                            <div className="flex items-center justify-between">
                              <dt className="text-gray-600">Rush (urgent)</dt>
                              <dd className="font-semibold text-gray-900 tabular-nums">
                                {formatMoney(earningsBreakdown.rushFee, currency)}
                              </dd>
                            </div>
                          )}
                          {earningsBreakdown.specialInkFee > 0 && (
                            <div className="flex items-center justify-between">
                              <dt className="text-gray-600">Special ink</dt>
                              <dd className="font-semibold text-gray-900 tabular-nums">
                                {formatMoney(earningsBreakdown.specialInkFee, currency)}
                              </dd>
                            </div>
                          )}
                        </dl>
                        <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                          <div className="text-sm font-semibold text-gray-900">
                            {earningsBreakdown.realized ? "You earned" : "You will earn"}
                          </div>
                          <div className="text-xl font-bold text-blue-600 tabular-nums">
                            {formatMoney(earningsBreakdown.total, currency)}
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] text-gray-400">
                          {earningsBreakdown.realized
                            ? overview.status === "CANCELLED"
                              ? "This job was cancelled, but you're still paid for it. It joins your next payout."
                              : "Payable — it joins your next payout."
                            : "Becomes payable once you ship this job."}
                        </p>
                      </>
                    )}
                  </div>
                </div>

                <OrderDetails
                  orderId={overview.orderId}
                  createdAt={formatDateTime(overview.createdAt)}
                  dueLabel={overview.dueStage === "PRINT" ? "Print by" : overview.dueStage === "ACCEPT" ? "Accept by" : null}
                  dueDate={overview.deadline ? formatDateTime(overview.deadline) : null}
                  sheetCount={overview.specs.sheetCount ?? overview.specs.itemsCount}
                />
              </>
            )}
          </div>
        </div>
      )}

      {showAssets && overview && (
        <DownloadAssetsModal isOpen={true} onClose={() => setShowAssets(false)} job={{
          id: overview.id,
          orderId: overview.orderId,
          customer: overview.customer.name,
          sheetSize: overview.specs.sheetSize,
          orderDescription: `${overview.specs.itemsCount} Items`,
          status: labelOf(overview) as any,
          deadline: overview.deadline || "",
          createdAt: overview.createdAt,
          priority: overview.priority === "URGENT" ? ("Urgent" as any) : undefined,
        }} />
      )}

      <ConfirmDialog
        isOpen={pendingStep !== null}
        busy={updatingStatus}
        {...(pendingStep ? confirmCopy(pendingStep, displayId) : { title: "", body: "", confirmLabel: "" })}
        onConfirm={() => {
          const step = pendingStep;
          if (!step) return;
          void setStatus(step).finally(() => setPendingStep(null));
        }}
        onCancel={() => setPendingStep(null)}
      />

      <DriveSaveModal
        isOpen={driveModalOpen}
        onClose={() => setDriveModalOpen(false)}
        fileName={overview ? `gangsheet_${overview.orderId}.png` : "gangsheet.png"}
        clientId={driveClientId}
        onConnected={(v) => void saveGangsheetToDrive(v)}
      />
    </div>
  );
}
