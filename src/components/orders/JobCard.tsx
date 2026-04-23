import {
  FiCalendar,
  FiMapPin,
  FiExternalLink,
  FiLayers,
  FiPrinter,
} from "react-icons/fi";
import { BsExclamationTriangleFill } from "react-icons/bs";
import type { Order } from "../../types/orders";

interface JobCardProps {
  job: Order;
  selected: boolean;
  onToggle: (id: string) => void;
  onPrimaryAction?: (id: string, status: Order["status"]) => void;
  onSecondaryAction?: (id: string) => void;
}

export const JobCard = ({ job, selected, onToggle, onPrimaryAction, onSecondaryAction }: JobCardProps) => {
  const getStatusBadgeStyles = (status: string) => {
    switch (status) {
      case "Pending Review":
        return "bg-orange-50 text-orange-600 border border-orange-100";
      case "In Progress":
        return "bg-blue-50 text-blue-600 border border-blue-100";
      case "Ready":
        return "bg-purple-50 text-purple-600 border border-purple-100";
      case "Completed":
        return "bg-green-50 text-green-600 border border-green-100";
      default:
        return "bg-gray-50 text-gray-600 border border-gray-100";
    }
  };

  const renderActionButton = (status: string) => {
    switch (status) {
      case "Pending Review":
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPrimaryAction?.(job.id, job.status);
            }}
            className="w-full sm:w-auto px-4 py-2 bg-[#3C83F6] text-white rounded-2xl text-sm font-medium hover:bg-[#2F74E6] transition-colors"
          >
            Accept & Start
          </button>
        );
      case "In Progress":
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPrimaryAction?.(job.id, job.status);
            }}
            className="w-full sm:w-auto px-4 py-2 bg-[#BB4D00] text-white rounded-2xl text-sm font-medium hover:bg-[#A74400] transition-colors"
          >
            Pending Review
          </button>
        );
      case "Ready":
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPrimaryAction?.(job.id, job.status);
            }}
            className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white rounded-2xl text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Start Packaging
          </button>
        );
      case "Completed":
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPrimaryAction?.(job.id, job.status);
            }}
            className="w-full sm:w-auto px-4 py-2 bg-white text-gray-700 border border-gray-200 rounded-2xl text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            View Details
          </button>
        );
      default:
        return null;
    }
  };

  const isDueSoon =
    job.dueDate.includes("Today") || job.dueDate.includes("Tomorrow");

  return (
    <div
      onClick={() => onSecondaryAction?.(job.id)}
      className={`bg-white rounded-xl p-4 sm:p-6 border transition-all cursor-pointer ${selected ? "border-blue-500 ring-1 ring-blue-500" : "border-gray-200 hover:border-gray-300"}`}
    >
      <div className="flex flex-col lg:flex-row gap-6 items-start lg:items-center">
        {/* Checkbox & Thumbnail */}
        <div className="flex items-start gap-4 min-w-[280px]">
          <div className="pt-8">
            <input
              type="checkbox"
              checked={selected}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggle(job.id)}
              className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
          </div>

          <div className="relative w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0">
            <img
              src={job.thumbnail || "/space.svg"}
              alt="thumbnail"
              className={job.thumbnail ? "w-full h-full object-cover" : "w-12 h-12 opacity-80"}
            />
            {job.hasWarning && (
              <div className="absolute top-1 right-1">
                <div className="bg-red-500 text-white p-0.5 rounded-full shadow-sm">
                  <BsExclamationTriangleFill className="w-3 h-3" />
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col items-start gap-1 pt-1">
            <span className="font-bold text-gray-900">{job.displayId || job.id}</span>
            {job.isUrgent && (
              <span className="bg-red-50 text-red-600 text-[10px] font-bold px-1.5 py-0.5 rounded-xl border border-red-100 uppercase tracking-wide">
                Urgent
              </span>
            )}
            <span className="text-gray-500 text-sm font-medium">
              {job.customerName}
            </span>
          </div>
        </div>

        {/* Specs */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs text-gray-500 uppercase font-medium tracking-wide">
              <FiLayers /> Sheet size
            </div>
            <div className="font-medium text-gray-900">{job.sheetSize}</div>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs text-gray-500 uppercase font-medium tracking-wide">
              <FiPrinter /> Film Type
            </div>
            <div className="font-medium text-gray-900 max-w-[140px] leading-tight">
              {job.filmType}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs text-gray-500 uppercase font-medium tracking-wide">
              <FiCalendar /> Due Date
            </div>
            <div
              className={`font-medium ${isDueSoon ? "text-orange-600" : "text-gray-900"}`}
            >
              {job.dueDate}
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <FiMapPin className="w-3 h-3" />
              {job.location}
            </div>
          </div>
        </div>

        {/* Status & Actions */}
        <div className="flex items-start justify-end gap-6 min-w-[280px]">
          {/* Status Column */}
          <div className="flex flex-col items-center gap-2">
            <span
              className={`px-4 py-2 rounded-2xl text-sm font-medium whitespace-nowrap ${getStatusBadgeStyles(job.status)}`}
            >
              {job.status}
            </span>
            <span className="text-xs text-gray-500 text-center max-w-[150px] leading-tight">
              {job.statusDescription}
            </span>
          </div>

          {/* Action Column */}
          <div className="flex flex-col items-center gap-2">
            {renderActionButton(job.status)}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSecondaryAction?.(job.id);
              }}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 font-medium"
            >
              Details <FiExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
