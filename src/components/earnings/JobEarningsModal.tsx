import { Modal } from "../common/Modal";
import { FiCheckCircle, FiClock, FiCalendar } from "react-icons/fi";
import type { EarningsJob } from "../../types/earnings";

interface JobEarningsModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: EarningsJob | null;
}

export const JobEarningsModal = ({
  isOpen,
  onClose,
  job,
}: JobEarningsModalProps) => {
  if (!job) return null;

  const getStatusBadge = () => {
    const isPaid = job.status === "Paid";
    const isPending = job.status === "Pending";
    const isScheduled = job.status === "Scheduled";

    let colorClass = "bg-gray-100 text-gray-700";
    let icon = null;

    if (isPaid) {
      colorClass = "bg-green-50 text-green-700 border border-green-100";
      icon = <FiCheckCircle className="w-3.5 h-3.5" />;
    } else if (isPending) {
      colorClass = "bg-orange-50 text-orange-700 border border-orange-100";
      icon = <FiClock className="w-3.5 h-3.5" />;
    } else if (isScheduled) {
      colorClass = "bg-purple-50 text-purple-700 border border-purple-100";
      icon = <FiCalendar className="w-3.5 h-3.5" />;
    }

    return (
      <span
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${colorClass}`}
      >
        {icon}
        {job.status}
        {job.completedAt ? ` - ${new Date(job.completedAt).toLocaleDateString()}` : ""}
      </span>
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-[600px] bg-white p-0">
      <div className="p-8 space-y-8">
        {/* Header */}
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            Job Earnings Details
          </h2>
          <p className="text-gray-500 text-sm mt-1">{job.id}</p>
        </div>

        {/* Earning Box */}
        <div className="bg-blue-50/50 rounded-2xl border border-blue-100 p-6 flex flex-col items-start gap-4">
          <div className="space-y-1">
            <h3 className="text-blue-600 font-bold text-sm">Your Earning</h3>
            <div className="flex items-center gap-4">
              <span className="text-5xl font-bold text-blue-600 tracking-tight">
                {job.earning}
              </span>
              {getStatusBadge()}
            </div>
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-2 gap-y-6 gap-x-12">
          <div>
            <h4 className="text-xs font-medium text-gray-500 mb-1.5">
              Customer
            </h4>
            <p className="text-sm font-bold text-gray-900">{job.customer}</p>
          </div>
          <div>
            <h4 className="text-xs font-medium text-gray-500 mb-1.5">
              Completed Date
            </h4>
            <p className="text-sm font-bold text-gray-900">
              {job.completedAt
                ? new Date(job.completedAt).toLocaleDateString()
                : <span className="text-gray-400 font-medium">Not completed yet</span>}
            </p>
          </div>
          <div>
            <h4 className="text-xs font-medium text-gray-500 mb-1.5">
              Job Type
            </h4>
            <p className="text-sm font-bold text-gray-900">
              {job.details.title}
            </p>
          </div>
          <div>
            <h4 className="text-xs font-medium text-gray-500 mb-1.5">
              Quantity
            </h4>
            <p className="text-sm font-bold text-gray-900">
              {job.details.sub}
            </p>
          </div>
        </div>

        {/* Financial Breakdown */}
        <div className="pt-6 border-t border-gray-100 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm font-bold text-gray-900">Your Earning</span>
            <span className="text-base font-bold text-blue-600">{job.earning}</span>
          </div>
        </div>

        {/* Footer Button */}
        <button
          onClick={onClose}
          className="w-full py-3 bg-white border border-gray-200 rounded-xl text-gray-700 font-bold text-sm hover:bg-gray-50 transition-colors shadow-sm"
        >
          Close
        </button>
      </div>
    </Modal>
  );
};
