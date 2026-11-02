import { FiAlertTriangle } from "react-icons/fi";
import { jobIssueTag, type JobIssueFlag } from "../../utils/jobIssues";

/** Marks a job that Space Transfers has asked about. Renders nothing otherwise. */
export function JobIssueTag({ flag }: { flag: JobIssueFlag | null | undefined }) {
  const tag = jobIssueTag(flag);
  if (!tag) return null;
  return (
    <span
      title={
        tag.tone === "red"
          ? "The customer reported a problem and Space Transfers is waiting for your reply."
          : "The customer reported a problem. You have replied; Space Transfers is dealing with it."
      }
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-xl border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        tag.tone === "red" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"
      }`}
    >
      <FiAlertTriangle className="h-3 w-3" aria-hidden /> {tag.label}
    </span>
  );
}
