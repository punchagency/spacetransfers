import { useEffect, useRef, useState } from "react";
import { MdArrowBack, MdCheckCircle, MdClose, MdOutlineReportProblem, MdSend } from "react-icons/md";
import toast from "react-hot-toast";
import { apiFetch } from "../../lib/utils/api";
import {
  ISSUE_OPTIONS,
  MAX_ISSUE_TEXT,
  reportFormError,
  resolutionSummary,
  type IssuePhoto,
  type IssueType,
  type OrderIssue,
} from "../../lib/utils/orderIssues";
import { PhotoPicker, PhotoStrip, PhotoTray } from "./IssuePhotos";

interface OrderIssueModalProps {
  /** The order to report on, or null when closed. */
  order: { orderId: string; number: string } | null;
  onClose: () => void;
  /** The order's reports changed, so the list behind should show it. */
  onChanged: () => void;
}

const when = (value: string) =>
  new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Bubble({ mine, name, body, at, photos }: { mine: boolean; name: string; body: string; at: string; photos?: IssuePhoto[] }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${mine ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900"}`}>
        {body && <p className="whitespace-pre-wrap break-words">{body}</p>}
        <PhotoStrip photos={photos} onDark={mine} />
        <p className={`mt-1 text-[11px] ${mine ? "text-blue-100" : "text-gray-500"}`}>
          {name} · {when(at)}
        </p>
      </div>
    </div>
  );
}

function Report({ issue, onReplied }: { issue: OrderIssue; onReplied: (issue: OrderIssue) => void }) {
  const [reply, setReply] = useState("");
  const [photos, setPhotos] = useState<IssuePhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const resolved = issue.status === "RESOLVED";
  const canSend = (reply.trim() !== "" || photos.length > 0) && !uploading && !sending;

  const send = async () => {
    const body = reply.trim();
    if (!canSend) return;
    setSending(true);
    try {
      const data = await apiFetch(`/customer/issues/${issue.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body, attachments: photos }),
      });
      setReply("");
      setPhotos([]);
      onReplied(data.issue);
      toast.success(resolved ? "Report reopened. We'll take another look." : "Message sent");
    } catch (err: any) {
      toast.error(err.message || "Your message couldn't be sent. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{issue.typeLabel}</p>
          <p className="text-xs text-gray-500">Reported {when(issue.createdAt)}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            resolved ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800"
          }`}
        >
          {resolved ? "Resolved" : "We're on it"}
        </span>
      </div>

      <div className="space-y-2.5 px-4 py-3">
        {(issue.description || Boolean(issue.attachments?.length)) && (
          <Bubble mine name="You" body={issue.description} at={issue.createdAt} photos={issue.attachments} />
        )}
        {issue.messages.map((m) => (
          <Bubble
            key={m.id}
            mine={m.author === "CUSTOMER"}
            name={m.author === "CUSTOMER" ? "You" : "Space Transfers"}
            body={m.body}
            at={m.at}
            photos={m.attachments}
          />
        ))}
        {!issue.description && !issue.attachments?.length && issue.messages.length === 0 && !resolved && (
          <p className="text-sm text-gray-500">Our team has your report and will reply here and by email.</p>
        )}
        {issue.resolution && (
          <div className="flex gap-2.5 rounded-xl bg-green-50 px-3.5 py-3 text-sm text-green-900">
            <MdCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
            <p className="min-w-0 font-semibold">{resolutionSummary(issue.resolution)}</p>
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 px-4 py-3">
        <label className="sr-only" htmlFor={`issue-reply-${issue.id}`}>
          {resolved ? "Reply to reopen this report" : "Add a message"}
        </label>
        {(photos.length > 0 || uploading) && (
          <div className="mb-2">
            <PhotoTray photos={photos} uploading={uploading} onRemove={(url) => setPhotos((p) => p.filter((x) => x.url !== url))} />
          </div>
        )}
        <div className="flex items-end gap-2">
          <PhotoPicker variant="icon" photos={photos} onChange={setPhotos} onBusy={setUploading} />
          <textarea
            id={`issue-reply-${issue.id}`}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            maxLength={MAX_ISSUE_TEXT}
            rows={2}
            placeholder={resolved ? "Still not right? Reply to reopen this report." : "Add a message"}
            className="min-h-[44px] flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <button
            onClick={send}
            disabled={!canSend}
            className="flex h-[44px] shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            <MdSend className="h-4 w-4" /> {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OrderIssueModal({ order, onClose, onChanged }: OrderIssueModalProps) {
  const [issues, setIssues] = useState<OrderIssue[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [type, setType] = useState<IssueType | null>(null);
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<IssuePhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // A settled report shows its history; the form for a new one opens on request.
  const [startingNew, setStartingNew] = useState(false);
  const changed = useRef(false);
  const orderId = order?.orderId ?? null;

  const load = async (id: string) => {
    setLoadError(null);
    try {
      const data = await apiFetch(`/customer/orders/${id}/issues`);
      setIssues(data.issues || []);
    } catch (err: any) {
      setLoadError(err.message || "Your reports couldn't be loaded.");
    }
  };

  useEffect(() => {
    if (!orderId) return;
    setIssues(null);
    setType(null);
    setDescription("");
    setPhotos([]);
    setFormError(null);
    setStartingNew(false);
    // Opening the reports marks any reply as read, which the list should show.
    changed.current = true;
    void load(orderId);
  }, [orderId]);

  if (!order) return null;

  const close = () => {
    if (submitting) return;
    if (changed.current) onChanged();
    changed.current = false;
    onClose();
  };

  const submit = async () => {
    const error = uploading ? "Wait for the photos to finish uploading." : reportFormError(type, description);
    setFormError(error);
    if (error || submitting) return;
    setSubmitting(true);
    try {
      const data = await apiFetch(`/customer/orders/${order.orderId}/issues`, {
        method: "POST",
        body: JSON.stringify({ type, description: description.trim(), attachments: photos }),
      });
      setIssues((prev) => [data.issue, ...(prev || [])]);
      setStartingNew(false);
      setType(null);
      setDescription("");
      setPhotos([]);
      toast.success("Report sent. We'll get back to you.");
    } catch (err: any) {
      setFormError(err.message || "Your report couldn't be sent. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const replaceIssue = (next: OrderIssue) => setIssues((prev) => (prev || []).map((i) => (i.id === next.id ? next : i)));

  const hasOpen = Boolean(issues?.some((i) => i.status === "OPEN"));
  const showForm = issues !== null && !hasOpen && (issues.length === 0 || startingNew);

  return (
    <div
      onClick={(e) => {
        // Rendered inside Order History, whose own backdrop closes on a click.
        e.stopPropagation();
        close();
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-xs px-3 py-4 sm:p-0">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Report a problem with order ${order.number}`}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-gray-100 px-4 py-4 sm:px-6">
          <div className="flex items-start gap-3">
            <button onClick={close} aria-label="Back" className="mt-1 text-gray-500 hover:text-gray-700">
              <MdArrowBack className="h-5 w-5" />
            </button>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50">
              <MdOutlineReportProblem className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">{showForm ? "Report a problem" : "Your report"}</h2>
              <p className="text-sm text-gray-500">Order {order.number}</p>
            </div>
          </div>
          <button onClick={close} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
          {loadError ? (
            <div className="py-8 text-center">
              <p className="text-sm text-red-500">{loadError}</p>
              <button onClick={() => void load(order.orderId)} className="mt-3 text-sm text-blue-600 hover:underline">
                Try again
              </button>
            </div>
          ) : issues === null ? (
            <div className="flex justify-center py-10">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
          ) : (
            <>
              {showForm && (
                <div>
                  <p className="text-sm font-medium text-gray-900">What went wrong?</p>
                  <div role="radiogroup" aria-label="What went wrong?" className="mt-2 space-y-2">
                    {ISSUE_OPTIONS.map((option) => {
                      const selected = type === option.type;
                      return (
                        <button
                          key={option.type}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => {
                            setType(option.type);
                            setFormError(null);
                          }}
                          className={`flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                            selected ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500" : "border-gray-200 bg-white hover:border-gray-300"
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                              selected ? "border-blue-600" : "border-gray-300"
                            }`}
                          >
                            {selected && <span className="h-2 w-2 rounded-full bg-blue-600" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-gray-900">{option.label}</span>
                            <span className="block text-xs text-gray-500">{option.hint}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <label htmlFor="issue-details" className="mt-4 block text-sm font-medium text-gray-900">
                    Details{" "}
                    <span className="font-normal text-gray-500">{type === "OTHER" ? "(required)" : "(optional)"}</span>
                  </label>
                  <textarea
                    id="issue-details"
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      setFormError(null);
                    }}
                    maxLength={MAX_ISSUE_TEXT}
                    rows={4}
                    placeholder="Tell us what happened so we can put it right."
                    className="mt-1.5 w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                  <p className="mt-4 text-sm font-medium text-gray-900">
                    Photos <span className="font-normal text-gray-500">(optional, up to 4)</span>
                  </p>
                  <p className="text-xs text-gray-500">A photo of the damage or the print helps us put it right faster.</p>
                  <div className="mt-2 space-y-2">
                    <PhotoTray photos={photos} uploading={uploading} onRemove={(url) => setPhotos((p) => p.filter((x) => x.url !== url))} />
                    <PhotoPicker photos={photos} onChange={setPhotos} onBusy={setUploading} />
                  </div>
                  {formError && (
                    <p role="alert" className="mt-2 text-sm text-red-600">
                      {formError}
                    </p>
                  )}
                </div>
              )}

              {issues.map((issue) => (
                <Report key={issue.id} issue={issue} onReplied={replaceIssue} />
              ))}

              {!showForm && !hasOpen && (
                <button onClick={() => setStartingNew(true)} className="text-sm font-medium text-blue-600 hover:underline">
                  Report a different problem
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-4 py-4 sm:px-6">
          <button onClick={close} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            {showForm ? "Cancel" : "Close"}
          </button>
          {showForm && (
            <button
              onClick={submit}
              disabled={submitting || uploading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300"
            >
              {submitting ? "Sending…" : uploading ? "Uploading photo…" : "Send report"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
