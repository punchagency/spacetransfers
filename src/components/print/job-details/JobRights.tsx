import { useState } from "react";
import toast from "react-hot-toast";
import { apiFetch } from "../../../utils/api";

export interface JobRightsInfo {
  rights?: {
    checkedAt: string;
    checks: string[];
    images: { url: string; verdict: "clear" | "approved"; approvals: { id: string; label: string; note: string; at: string | null }[]; notes: string[] }[];
  } | null;
  rightsRecheck?: { flagged: { url: string; verdict: string; findings: string[] }[] } | null;
  rightsConcern?: { status: "open" | "cleared"; note: string; at: string; resolution?: string; resolvedAt?: string } | null;
}

const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

/**
 * The rights check, for the partner: what Space Transfers cleared, anything
 * flagged since the order was placed, and the partner's own way to stop a job
 * they believe infringes someone's rights.
 */
export const JobRights = ({
  jobId,
  status,
  info,
  onChanged,
}: {
  jobId: string;
  status: string;
  info: JobRightsInfo;
  onChanged: () => void;
}) => {
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { rights, rightsRecheck, rightsConcern } = info;
  const open = rightsConcern?.status === "open";
  const finished = ["SHIPPED", "COMPLETED", "CANCELLED"].includes(String(status).toUpperCase());
  const approved = (rights?.images || []).filter((i) => i.verdict === "approved");
  const flagged = rightsRecheck?.flagged || [];

  const report = async () => {
    setBusy(true);
    try {
      await apiFetch(`/printer/jobs/${encodeURIComponent(jobId)}/rights-concern`, { method: "POST", body: JSON.stringify({ note: note.trim() }) });
      toast.success("Sent to Space Transfers. The job is on hold until they reply.");
      setWriting(false);
      setNote("");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || "Your concern couldn't be sent. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 space-y-3">
      <h3 className="text-base font-bold text-gray-900">Artwork rights</h3>

      {flagged.length > 0 && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-950">
          <p className="font-semibold">Flagged after the order was placed: don’t print it yet</p>
          <p className="mt-0.5">
            {flagged.flatMap((f) => f.findings).join(", ") || "An image"} is now held by the rights check. Space Transfers has been told and will get
            back to you.
          </p>
        </div>
      )}

      {open && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">On hold: you raised a rights concern on {day(rightsConcern?.at)}</p>
          <p className="mt-0.5">Space Transfers is reviewing it. The job can’t move on until they reply; you can still hand it back.</p>
        </div>
      )}
      {rightsConcern?.status === "cleared" && (
        <p className="text-sm text-gray-700">
          Your concern was cleared by Space Transfers on {day(rightsConcern.resolvedAt)}: {rightsConcern.resolution}
        </p>
      )}

      {rights ? (
        approved.length ? (
          <ul className="space-y-1.5 text-sm text-gray-700">
            {approved.flatMap((img) =>
              img.approvals.map((a) => (
                <li key={`${img.url}-${a.id}`}>
                  <span className="font-medium text-gray-900">{a.label}</span>: cleared by Space Transfers after review
                  {a.note ? <span className="block text-xs text-gray-500">{a.note}</span> : null}
                </li>
              )),
            )}
          </ul>
        ) : (
          <p className="text-sm text-gray-600">All artwork passed the rights check when the order was placed.</p>
        )
      ) : (
        <p className="text-sm text-gray-600">This order was placed before artwork was checked for rights.</p>
      )}

      {!finished && !open && !writing && (
        <button type="button" onClick={() => setWriting(true)} className="text-sm font-semibold text-red-700 hover:underline">
          Report a rights concern
        </button>
      )}
      {writing && (
        <div className="space-y-2">
          <label htmlFor="rights-concern" className="block text-xs text-gray-500">
            What concerns you about the artwork? The job is put on hold and Space Transfers reviews it.
          </label>
          <textarea
            id="rights-concern"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="e.g. The front design is the Nike swoosh; I can't print it without a licence."
            className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || note.trim().length < 10}
              onClick={() => void report()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:bg-gray-300"
            >
              {busy ? "Sending…" : "Put on hold and report"}
            </button>
            <button type="button" onClick={() => setWriting(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
