import { useEffect, useRef, useState } from "react";
import { Modal } from "../common/Modal";
import { SpaceLoader } from "../common/SpaceLoader";
import { apiFetch } from "../../utils/api";
import toast from "react-hot-toast";

interface Overview {
  id: string;
  status: string;
  customer: { name: string };
  shippingAddress: { street: string; city: string; state: string; postalCode: string } | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  trackingUrl?: string | null;
  shipStationTriggeredAt?: string | null;
  shipStationLabelUrl?: string | null;
  shipStationError?: string | null;
}

type Phase = "triggering" | "generating" | "ready" | "error" | "timeout";

interface ShippingLabelModalProps {
  jobId: string;
  displayId: string;
  /** Pass true when called from "Print Shipping Label" button (needs to trigger update).
   *  Pass false when called from "View Label" on an already-QUALITY_CHECK job. */
  triggerUpdate?: boolean;
  onClose: () => void;
  onShipped: () => void;
}

const LABEL_TIMEOUT_MS = 90_000;

export const ShippingLabelModal = ({
  jobId,
  displayId,
  triggerUpdate = true,
  onClose,
  onShipped,
}: ShippingLabelModalProps) => {
  const [phase, setPhase] = useState<Phase>("triggering");
  const [attempt, setAttempt] = useState(0);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [confirming, setConfirming] = useState(false);
  const aliveRef = useRef(true);

  // ── Step 1: trigger status update then fetch initial overview ───────────────
  useEffect(() => {
    aliveRef.current = true;
    const timeoutId = window.setTimeout(() => {
      if (aliveRef.current && phase !== "ready") setPhase("timeout");
    }, LABEL_TIMEOUT_MS);

    const run = async () => {
      try {
        if (triggerUpdate) {
          await apiFetch(`/printer/orders/${encodeURIComponent(jobId)}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status: "Print Shipping Label" }),
          });
        }
        if (!aliveRef.current) return;

        const ov = await apiFetch(`/printer/jobs/${encodeURIComponent(jobId)}/overview`);
        if (!aliveRef.current) return;
        setOverview(ov || null);

        if (ov?.shipStationLabelUrl) {
          setPhase("ready");
          window.clearTimeout(timeoutId);
        } else if (ov?.shipStationError) {
          setErrorMsg(ov.shipStationError);
          setPhase("error");
          window.clearTimeout(timeoutId);
        } else {
          setPhase("generating");
        }
      } catch (e: any) {
        if (!aliveRef.current) return;
        setErrorMsg(e?.message || "Failed to initiate label generation.");
        setPhase("error");
        window.clearTimeout(timeoutId);
      }
    };

    run();
    return () => {
      aliveRef.current = false;
      window.clearTimeout(timeoutId);
    };
  // `attempt` increments on retry to re-run this effect
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // ── Step 2: poll every 3 s until label URL appears or an error is stored ────
  useEffect(() => {
    if (phase !== "generating") return;

    const id = setInterval(async () => {
      try {
        const r = await apiFetch(`/printer/jobs/${encodeURIComponent(jobId)}/overview`);
        if (!aliveRef.current) return;
        if (r) setOverview(r);
        if (r?.shipStationLabelUrl) {
          setPhase("ready");
        } else if (r?.shipStationError) {
          setErrorMsg(r.shipStationError);
          setPhase("error");
        }
      } catch { /* will retry */ }
    }, 3000);

    return () => clearInterval(id);
  }, [jobId, phase]);

  // ── Label actions ────────────────────────────────────────────────────────────
  const rawLabelUrl = overview?.shipStationLabelUrl ?? null;
  // "generated" is a sentinel meaning ShipStation created the label but returned no PDF URL
  const labelUrl = rawLabelUrl && rawLabelUrl !== "generated" ? rawLabelUrl : null;
  const hasPreview = Boolean(labelUrl);

  const handlePrint = () => {
    if (!labelUrl) return;
    window.open(labelUrl, "_blank");
  };

  const handleDownload = () => {
    if (!labelUrl) return;
    const a = document.createElement("a");
    a.href = labelUrl;
    a.download = `shipping-label-${displayId}.pdf`;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await apiFetch(`/printer/orders/${encodeURIComponent(jobId)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "Order Shipped" }),
      });
      toast.success("Order marked as shipped");
      onShipped();
    } catch (e: any) {
      toast.error(e?.message || "Failed to update status");
      setConfirming(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <Modal isOpen onClose={onClose} title={`Shipping Label — ${displayId}`} className="max-w-2xl">
      {/* TRIGGERING */}
      {phase === "triggering" && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <SpaceLoader />
          <div className="text-sm font-semibold text-gray-800">Initiating label generation…</div>
        </div>
      )}

      {/* GENERATING */}
      {phase === "generating" && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <SpaceLoader size={28} layout="inline" />
          <div className="text-sm font-semibold text-gray-800">Generating shipping label…</div>
          <div className="text-xs text-gray-500 max-w-xs">
            ShipStation is creating your label. This usually takes under 10 seconds.
          </div>
        </div>
      )}

      {/* ERROR */}
      {phase === "error" && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <div className="text-sm font-semibold text-gray-900">Label generation failed</div>
          <div className="text-xs text-gray-500 max-w-sm leading-relaxed">{errorMsg}</div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => {
                setErrorMsg("");
                setPhase("triggering");
                setAttempt((n) => n + 1);
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Retry
            </button>
            <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors">
              Close
            </button>
          </div>
        </div>
      )}

      {/* TIMEOUT */}
      {phase === "timeout" && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="text-sm font-semibold text-gray-900">Taking longer than expected</div>
          <div className="text-xs text-gray-500 max-w-xs leading-relaxed">
            The label is still being generated. This may indicate ShipStation is not configured or is experiencing delays.
            Check the order details page to see the label once it's ready.
          </div>
          <button onClick={onClose} className="mt-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors">
            Close
          </button>
        </div>
      )}

      {/* READY */}
      {phase === "ready" && rawLabelUrl && (
        <div className="flex flex-col gap-4 pb-2">
          {/* Ready badge */}
          <div className="flex items-center gap-2 text-green-700 text-sm font-semibold">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Shipping label ready
          </div>

          {/* PDF preview — only when a real URL is available */}
          {hasPreview && (
            <div className="rounded-xl overflow-hidden border border-gray-200 bg-gray-50" style={{ height: 340 }}>
              <iframe
                src={labelUrl!}
                title="Shipping Label Preview"
                className="w-full h-full"
                style={{ border: "none" }}
              />
            </div>
          )}

          {/* Ship-to + tracking */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 space-y-1 text-xs">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Ship To</div>
              <div className="text-gray-900 font-medium">{overview?.customer?.name}</div>
              {overview?.shippingAddress && (
                <div className="text-gray-500 leading-relaxed">
                  {overview.shippingAddress.street}<br />
                  {overview.shippingAddress.city}, {overview.shippingAddress.state} {overview.shippingAddress.postalCode}
                </div>
              )}
            </div>

            {overview?.trackingNumber && (
              <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 space-y-1 text-xs">
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Tracking</div>
                <div className="text-sm font-mono font-semibold text-gray-900">{overview.trackingNumber}</div>
                {overview.carrier && <div className="text-gray-500">{overview.carrier.toUpperCase()}</div>}
                {overview.trackingUrl && (
                  <a href={overview.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    Track Package →
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Print / Download / Reprint — only when PDF is available */}
          {hasPreview && (
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handlePrint}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print Label
            </button>
            <button
              onClick={handleDownload}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reprint
            </button>
          </div>
          )}

          {/* Confirm shipped */}
          <button
            disabled={confirming}
            onClick={() => void handleConfirm()}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-60"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {confirming ? "Confirming…" : "Confirm — Package Ready for Pickup"}
          </button>

          <div className="text-[11px] text-gray-500 text-center leading-relaxed">
            Attach the label to the package, then confirm. The customer will be notified when the carrier scans it.
          </div>
        </div>
      )}
    </Modal>
  );
};
