import {
  FiCalendar,
  FiMapPin,
  FiExternalLink,
  FiLayers,
  FiPrinter,
} from "react-icons/fi";
import { jobDue } from "../../utils/jobDue";
import type { Order } from "../../types/orders";
import { JobIssueTag } from "../common/JobIssueTag";

interface JobCardProps {
  job: Order;
  onPrimaryAction?: (id: string, status: Order["status"]) => void;
  onSecondaryAction?: (id: string) => void;
  onCancel?: (id: string) => void;
}

export const JobCard = ({ job, onPrimaryAction, onSecondaryAction, onCancel }: JobCardProps) => {
  const getStatusBadgeStyles = (status: string) => {
    switch (status) {
      case "Pending Review":
        return "bg-orange-50 text-orange-600 border border-orange-100";
      case "In Progress - Printing":
        return "bg-blue-50 text-blue-600 border border-blue-100";
      case "Print Shipping Label":
        return "bg-purple-50 text-purple-600 border border-purple-100";
      case "Order Shipped":
        return "bg-green-50 text-green-600 border border-green-100";
      case "Completed":
        return "bg-green-50 text-green-600 border border-green-100";
      case "Cancelled":
        return "bg-red-50 text-red-500 border border-red-100";
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
            className="w-full sm:w-auto px-3.5 py-2 bg-[#3C83F6] text-white rounded-2xl text-sm font-medium whitespace-nowrap hover:bg-[#2F74E6] transition-colors"
          >
            Accept & Start
          </button>
        );
      case "In Progress - Printing":
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPrimaryAction?.(job.id, job.status);
            }}
            className="w-full sm:w-auto px-3.5 py-2 bg-purple-600 text-white rounded-2xl text-sm font-medium whitespace-nowrap hover:bg-purple-700 transition-colors"
          >
            Print Shipping Label
          </button>
        );
      case "Print Shipping Label":
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPrimaryAction?.(job.id, job.status);
            }}
            className="w-full sm:w-auto px-3.5 py-2 bg-purple-600 text-white rounded-2xl text-sm font-medium whitespace-nowrap hover:bg-purple-700 transition-colors"
          >
            View Label
          </button>
        );
      case "Completed":
        return (
          // Opened nothing: the page's action handler had no case for Completed.
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSecondaryAction?.(job.id);
            }}
            className="w-full sm:w-auto px-3.5 py-2 bg-white text-gray-700 border border-gray-200 rounded-2xl text-sm font-medium whitespace-nowrap hover:bg-gray-50 transition-colors"
          >
            View Details
          </button>
        );
      case "Cancelled":
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSecondaryAction?.(job.id);
            }}
            className="w-full sm:w-auto px-3.5 py-2 bg-white text-gray-700 border border-gray-200 rounded-2xl text-sm font-medium whitespace-nowrap hover:bg-gray-50 transition-colors"
          >
            View Details
          </button>
        );
      default:
        return null;
    }
  };

  const due = jobDue(job.deadline, job.dueStage);
  const hasDue = due.at !== null;
  const isOverdue = due.overdue;
  const isDueSoon = due.soon;
  const dueText = due.at
    ? due.at.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "—";

  return (
    <div
      onClick={() => onSecondaryAction?.(job.id)}
      className={`bg-white rounded-xl p-4 sm:p-6 border transition-all cursor-pointer border-gray-200 hover:border-gray-300`}
    >
      {/*
        Switches to a single row at `xl` rather than `lg`: the row's content
        (identity + specs + status badge + action buttons) needs more room
        than the 1024–1279px range typically has, which was overflowing the
        card. Below `xl` it stays in the already-correct stacked layout.
      */}
      <div className="flex flex-col xl:flex-row gap-4 xl:gap-6 items-start xl:items-center">
        {/* Thumbnail */}
        <div className="flex items-start gap-4 min-w-0 sm:min-w-[260px] flex-shrink-0">
          <div className="relative w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0">
            <img
              src={job.thumbnail || "/space.svg"}
              alt="thumbnail"
              className={job.thumbnail ? "w-full h-full object-cover" : "w-12 h-12 opacity-80"}
            />
            {/*
              A red warning badge sat here on `job.hasWarning`. The server
              hardcoded that to `false` at its only producer, so the badge was
              unreachable — a warning affordance that could never warn. Urgency
              is carried by the Urgent flag, which is real.
            */}
          </div>

          <div className="flex flex-col items-start gap-1 pt-1">
            <span className="font-bold text-gray-900">{job.displayId || job.id}</span>
            {job.isUrgent && (
              <span className="bg-red-50 text-red-600 text-[10px] font-bold px-1.5 py-0.5 rounded-xl border border-red-100 uppercase tracking-wide">
                Urgent
              </span>
            )}
            <JobIssueTag flag={job.issue} />
            <span className="text-gray-500 text-sm font-medium">
              {job.customerName}
            </span>
          </div>
        </div>

        {/* Specs */}
        <div className="flex-1 min-w-[280px] grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 xl:gap-6 w-full">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs text-gray-500 uppercase font-medium tracking-wide whitespace-nowrap">
              <FiLayers /> {/sheets$/.test(job.sheetSize) ? "Sheets" : "Sheet size"}
            </div>
            <div className="font-medium text-gray-900 whitespace-nowrap">{job.sheetSize}</div>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs text-gray-500 uppercase font-medium tracking-wide whitespace-nowrap">
              <FiPrinter /> Film Type
            </div>
            <div className="font-medium text-gray-900 leading-tight whitespace-nowrap">
              {job.filmType}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs text-gray-500 uppercase font-medium tracking-wide whitespace-nowrap">
              <FiCalendar /> {due.label}
            </div>
            <div
              className={`font-medium whitespace-nowrap ${
                isOverdue ? "text-red-600" : isDueSoon ? "text-orange-600" : hasDue ? "text-gray-900" : "text-gray-400"
              }`}
            >
              {dueText}
              {isOverdue ? " · overdue" : ""}
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
              <FiMapPin className="w-3 h-3 flex-shrink-0" />
              {job.location}
            </div>
          </div>
        </div>

        {/* Status & Actions */}
        {/*
          Stacked into one column rather than status/action side-by-side:
          the badge and buttons together are wide enough that a side-by-side
          pair pushed the row's minimum width past what fits on a typical
          desktop viewport, forcing horizontal overflow. Stacking keeps every
          element full-size and readable while roughly halving this zone's
          footprint.
        */}
        <div className="flex flex-col items-end gap-2 min-w-[220px] flex-shrink-0">
          <span
            className={`px-3 py-1.5 rounded-2xl text-sm font-medium whitespace-nowrap ${getStatusBadgeStyles(job.status)}`}
          >
            {job.status}
          </span>
          <span className="text-xs text-gray-500 text-right max-w-[220px] leading-tight">
            {job.statusDescription}
          </span>

          <div className="flex items-center gap-2 flex-wrap justify-end mt-1">
            {renderActionButton(job.status)}
            {!["Print Shipping Label", "Order Shipped", "Completed", "Cancelled"].includes(job.status) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel?.(job.id);
                }}
                className="w-full sm:w-auto px-3.5 py-2 bg-red-600 text-white rounded-2xl text-sm font-medium whitespace-nowrap hover:bg-red-700 active:bg-red-800 transition-colors"
              >
                Cancel Job
              </button>
            )}
          </div>

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
  );
};
