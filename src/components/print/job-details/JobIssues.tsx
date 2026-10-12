import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { apiFetch } from "../../../utils/api";
import { formatDateTime } from "../../../utils/datetime";
import { awaitingPartnerReply, type JobIssue } from "../../../utils/jobIssues";

function IssueThread({ issue, onReplied }: { issue: JobIssue; onReplied: () => void }) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const waiting = awaitingPartnerReply(issue);

  const send = async () => {
    const body = reply.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await apiFetch(`/printer/issues/${encodeURIComponent(issue.id)}/messages`, { method: "POST", body: JSON.stringify({ body }) });
      setReply("");
      toast.success("Reply sent to Space Transfers");
      onReplied();
    } catch (e: any) {
      toast.error(e?.message || "Your reply couldn't be sent. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <p className="text-sm font-semibold text-gray-900">Customer reported: {issue.typeLabel}</p>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            issue.status === "RESOLVED" ? "bg-green-100 text-green-700" : waiting ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
          }`}
        >
          {issue.status === "RESOLVED" ? "Resolved" : waiting ? "Reply needed" : "Open"}
        </span>
      </div>
      <div className="space-y-2 px-4 py-3">
        {issue.messages.map((m) => {
          const mine = m.author === "PARTNER";
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${mine ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900"}`}>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`mt-1 text-[11px] ${mine ? "text-blue-100" : "text-gray-500"}`}>
                  {mine ? "You" : "Space Transfers"} · {formatDateTime(m.at)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-gray-100 px-4 py-3">
        <label htmlFor={`job-issue-reply-${issue.id}`} className="sr-only">
          Reply to Space Transfers
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id={`job-issue-reply-${issue.id}`}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Reply to Space Transfers"
            className="min-h-[44px] flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={() => void send()}
            disabled={!reply.trim() || sending}
            className="h-[44px] shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-gray-500">Only Space Transfers sees your reply. The customer does not.</p>
      </div>
    </div>
  );
}

/** Questions from Space Transfers about a problem on this job. Renders nothing when there are none. */
export function JobIssues({ orderId }: { orderId: string }) {
  const [issues, setIssues] = useState<JobIssue[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch(`/printer/orders/${encodeURIComponent(orderId)}/issues`);
      setIssues(data?.issues || []);
    } catch {
      // Tried again on the next poll.
    }
  }, [orderId]);

  useEffect(() => {
    setIssues([]);
    void load();
    const id = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(id);
  }, [load]);

  if (issues.length === 0) return null;

  return (
    <div className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-base font-semibold text-gray-900">Space Transfers has a question about this order</h2>
      <p className="mt-0.5 text-sm text-gray-500">The customer reported a problem. Please answer so it can be put right.</p>
      <div className="mt-4 space-y-4">
        {issues.map((issue) => (
          <IssueThread key={issue.id} issue={issue} onReplied={() => void load()} />
        ))}
      </div>
    </div>
  );
}
