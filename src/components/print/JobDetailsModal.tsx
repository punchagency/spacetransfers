import { useEffect, useState } from "react";
import { Modal } from "../common/Modal";
import { DownloadGangsheetModal } from "./DownloadGangsheetModal";
import { DownloadAssetsModal } from "./DownloadAssetsModal";
import { PrintLabelModal } from "./PrintLabelModal";
import type { PrintJob } from "../../types/printQueue";
import { StatusTimeline } from "./job-details/StatusTimeline";
import { PrintSpecifications } from "./job-details/PrintSpecifications";
import { ProductionNotes } from "./job-details/ProductionNotes";
import { QuickActions } from "./job-details/QuickActions";
import { CustomerInformation } from "./job-details/CustomerInformation";
import { OrderDetails } from "./job-details/OrderDetails";
import { apiFetch } from "../../utils/api";
import toast from "react-hot-toast";
import { SpaceLoader } from "../common/SpaceLoader";

interface JobDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: PrintJob | null;
  onJobUpdated?: () => void;
}

export const JobDetailsModal = ({
  isOpen,
  onClose,
  job,
  onJobUpdated,
}: JobDetailsModalProps) => {
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
  const [isAssetsModalOpen, setIsAssetsModalOpen] = useState(false);
  const [isPrintLabelModalOpen, setIsPrintLabelModalOpen] = useState(false);
  const [overview, setOverview] = useState<any | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!isOpen || !job?.id) {
      setOverview(null);
      setLoadingOverview(false);
      return;
    }
    setLoadingOverview(true);
    apiFetch(`/printer/jobs/${encodeURIComponent(job.id)}/overview`)
      .then((r) => setOverview(r || null))
      .catch(() => setOverview(null))
      .finally(() => setLoadingOverview(false));
  }, [isOpen, job?.id]);

  if (!job) return null;

  if (isDownloadModalOpen) {
    return (
      <DownloadGangsheetModal
        isOpen={true}
        onClose={() => setIsDownloadModalOpen(false)}
        job={job}
      />
    );
  }

  if (isAssetsModalOpen) {
    return (
      <DownloadAssetsModal
        isOpen={true}
        onClose={() => setIsAssetsModalOpen(false)}
        job={job}
      />
    );
  }

  if (isPrintLabelModalOpen) {
    return (
      <PrintLabelModal
        isOpen={true}
        onClose={() => setIsPrintLabelModalOpen(false)}
        job={job}
      />
    );
  }

  const headerContent = (
    <div>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gray-100 overflow-hidden flex items-center justify-center flex-shrink-0">
          <img
            src={overview?.faceThumbnail || "/space.svg"}
            alt="thumbnail"
            className={overview?.faceThumbnail ? "w-full h-full object-cover" : "w-6 h-6 opacity-80"}
          />
        </div>
        <h2 className="text-xl font-bold text-gray-900">{job.orderId}</h2>
        {job.priority === "Urgent" && (
          <span className="bg-red-100 text-red-600 text-[10px] font-medium px-2 py-0.5 rounded">
            URGENT
          </span>
        )}
      </div>
      <p className="text-xs text-gray-500 mt-0.5">{job.customer}</p>
    </div>
  );

  const updateStatus = async (nextStatus: string, successMessage: string) => {
    if (!job?.id) return;
    setUpdating(true);
    try {
      await apiFetch(`/printer/orders/${encodeURIComponent(job.id)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      toast.success(successMessage);
      onJobUpdated?.();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Failed to update status");
    } finally {
      setUpdating(false);
    }
  };

  const primaryAction = (() => {
    if (job.status === "Pending" || job.status === "Urgent") {
      return {
        label: "Accept & Start",
        className:
          "px-4 py-2 bg-[#3C83F6] text-white text-sm font-medium rounded-lg hover:bg-[#2F74E6] transition-colors shadow-sm shadow-blue-200 disabled:opacity-60",
        onClick: () => void updateStatus("In Progress", "Job accepted and started"),
      };
    }
    if (job.status === "Processing") {
      return {
        label: "Pending Review",
        className:
          "px-4 py-2 bg-[#BB4D00] text-white text-sm font-medium rounded-lg hover:bg-[#A74400] transition-colors shadow-sm disabled:opacity-60",
        onClick: () => void updateStatus("Pending Review", "Moved back to pending review"),
      };
    }
    return {
      label: "Mark as Complete",
      className:
        "px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm shadow-blue-200 disabled:opacity-60",
      onClick: () => void updateStatus("Completed", "Marked as complete"),
    };
  })();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-[850px] bg-[#F8FAFC]"
      title={headerContent}
    >
      {loadingOverview ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10">
          <SpaceLoader label="Loading job details…" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <StatusTimeline job={job} timeline={overview?.timeline || []} />
            <PrintSpecifications
              job={job}
              itemsCount={overview?.specs?.itemsCount}
              exportDpi={600}
            />
            <ProductionNotes jobId={job.id} initialNotes={String(overview?.notes || "")} />
          </div>

          <div className="space-y-4">
            <QuickActions
              onDownloadGangsheet={() => setIsDownloadModalOpen(true)}
              onDownloadAssets={() => setIsAssetsModalOpen(true)}
              onPrintLabel={() => setIsPrintLabelModalOpen(true)}
            />
            <CustomerInformation
              customer={{
                name: String(overview?.customer?.name || job.customer),
                email: overview?.customer?.email ?? null,
                phone: overview?.customer?.phone ?? null,
                region: overview?.customer?.region ?? null,
              }}
              shippingAddress={overview?.shippingAddress ?? null}
            />
            <OrderDetails
              orderId={job.orderId}
              createdAt={overview?.createdAt ? new Date(overview.createdAt).toLocaleString() : "N/A"}
              dueDate={overview?.createdAt ? new Date(overview.createdAt).toLocaleDateString() : "N/A"}
              itemsCount={typeof overview?.specs?.itemsCount === "number" ? overview.specs.itemsCount : 0}
            />
          </div>
        </div>
      )}

      {/* Footer Actions */}
      <div className="flex justify-start gap-3 mt-6 pt-4 border-t border-gray-200">
        <button
          onClick={onClose}
          className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          Close
        </button>
        <button
          disabled={updating}
          onClick={primaryAction.onClick}
          className={primaryAction.className}
        >
          {updating ? "Updating…" : primaryAction.label}
        </button>
      </div>
    </Modal>
  );
};
