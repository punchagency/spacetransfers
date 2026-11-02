import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiAlertTriangle, FiChevronRight } from "react-icons/fi";
import { apiFetch } from "../../utils/api";
import type { OpenJobIssue } from "../../utils/jobIssues";

/**
 * Every order Space Transfers has a question about, whatever its status. A
 * problem is usually reported after the job has shipped, when it is no longer
 * among the active jobs, so the list alone would not show it.
 */
export function OpenIssuesBanner() {
  const navigate = useNavigate();
  const [issues, setIssues] = useState<OpenJobIssue[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      apiFetch("/printer/issues")
        .then((data) => {
          if (alive) setIssues(Array.isArray(data?.issues) ? data.issues : []);
        })
        .catch(() => {});
    load();
    const id = window.setInterval(load, 30000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  if (issues.length === 0) return null;
  const waiting = issues.filter((i) => i.awaitingReply).length;

  return (
    <section aria-label="Orders with a reported problem" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <FiAlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-gray-900">
            {issues.length === 1 ? "1 order has a reported problem" : `${issues.length} orders have a reported problem`}
          </h2>
          <p className="text-sm text-gray-600">
            {waiting > 0
              ? `Space Transfers is waiting for your reply on ${waiting === 1 ? "1 of them" : `${waiting} of them`}.`
              : "You have replied to each. Space Transfers is dealing with them."}
          </p>
          <ul className="mt-3 space-y-2">
            {issues.map((issue) => (
              <li key={issue.id}>
                <button
                  onClick={() => navigate(`/orders/${issue.orderId}`)}
                  className="flex w-full items-center gap-3 rounded-xl border border-amber-200 bg-white px-3.5 py-2.5 text-left hover:border-amber-300"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-gray-900">{issue.displayId}</span>
                      <span className="text-sm text-gray-700">{issue.typeLabel}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          issue.awaitingReply ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {issue.awaitingReply ? "Reply needed" : "Replied"}
                      </span>
                    </span>
                    {issue.lastMessage && <span className="mt-0.5 block truncate text-sm text-gray-500">{issue.lastMessage}</span>}
                  </span>
                  <FiChevronRight className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
