import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { FiAlertTriangle, FiDownload } from "react-icons/fi";
import { DashboardLayout } from "../components/layout/DashboardLayout";
import { Toggle } from "../components/common/Toggle";
import { apiFetch } from "../utils/api";
import { currency } from "../utils/formatters";
import { downloadPayoutsCsv } from "../utils/downloads";
import { payoutActions, payoutStatusLabel, payoutStatusStyle, type PayoutAction } from "../utils/payouts";

/*
 * Partner payouts. A payout gathers a partner's shipped, unpaid jobs. Nothing
 * is paid automatically: an admin approves it, then pays it, and paying moves
 * real money through Stripe Connect.
 */

type Stats = {
  counts: { pendingReview: number; approved: number; processing: number; paid: number; rejected: number; failed: number };
  amounts: { totalPaid: number; totalPending: number };
};

type PartnerRow = {
  printerId: string;
  name: string;
  companyName?: string;
  email: string;
  stripeConnected: boolean;
  stripeOnboarded: boolean;
  payoutsEnabled: boolean;
  totalPaid: number;
  pendingPayouts: number;
  failedPayouts: number;
  eligibleAmount: number;
  eligibleJobs: number;
};

type PayoutRow = {
  _id: string;
  amount: number;
  status: string;
  createdAt: string;
  processedAt?: string | null;
  failureReason?: string | null;
  rejectionReason?: string | null;
  /** Set once the money has reached the partner's Stripe balance. */
  stripeTransferId?: string | null;
  orderIds?: string[];
  printerId?: { _id: string; name?: string; companyName?: string; email?: string } | null;
};

type PayoutDetail = {
  payout: {
    id: string;
    status: string;
    amount: number;
    printer: { name: string; email: string } | null;
    createdByName?: string | null;
    statusHistory: Array<{ status: string; at: string; changedByName?: string | null; note?: string | null }>;
  };
  jobs: Array<{ orderId: string; displayId?: string | null; customerName?: string | null; completedAt?: string | null; amount: number }>;
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "pending_review", label: "Awaiting review" },
  { key: "approved", label: "Approved" },
  { key: "paid", label: "Paid" },
  { key: "failed", label: "Failed" },
  { key: "rejected", label: "Rejected" },
];

const ACTION_LABEL: Record<PayoutAction, string> = {
  approve: "Approve",
  reject: "Reject",
  pay: "Pay now",
  retry: "Try payment again",
};

const dateOf = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

const partnerName = (p?: PayoutRow["printerId"]) => p?.companyName || p?.name || "Unknown partner";

export const Payouts = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<PayoutDetail | null>(null);
  // A step waiting for confirmation: paying moves money, rejecting needs a reason.
  const [confirm, setConfirm] = useState<{ action: PayoutAction; payout: PayoutRow } | null>(null);
  const [reason, setReason] = useState("");

  const load = async (status = filter) => {
    try {
      setLoadError(null);
      const [s, p, list] = await Promise.all([
        apiFetch("/payouts/admin/stats"),
        apiFetch("/payouts/admin/printers"),
        apiFetch(`/payouts/admin/list?limit=100&status=${encodeURIComponent(status)}`),
      ]);
      setStats(s);
      setPartners(Array.isArray(p?.printers) ? p.printers : []);
      setPayouts(Array.isArray(list?.payouts) ? list.payouts : []);
    } catch (e: any) {
      setLoadError(e?.message || "Payouts could not be loaded");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const run = async (key: string, work: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await work();
      toast.success(done);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "That didn't work. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const createPayout = (p: PartnerRow) =>
    run(
      `create-${p.printerId}`,
      () => apiFetch("/payouts/admin/create", { method: "POST", body: JSON.stringify({ printerId: p.printerId }) }),
      `Payout created for ${p.companyName || p.name}. It's waiting for review.`,
    );

  const togglePayouts = (p: PartnerRow, enabled: boolean) =>
    run(
      `toggle-${p.printerId}`,
      () => apiFetch(`/payouts/admin/printers/${p.printerId}/toggle`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
      enabled ? "Payouts switched on for this partner" : "Payouts paused for this partner",
    );

  const openDetail = async (id: string) => {
    try {
      setDetail(await apiFetch(`/payouts/admin/${id}/jobs`));
    } catch (e: any) {
      toast.error(e?.message || "The payout couldn't be opened");
    }
  };

  const perform = async () => {
    if (!confirm) return;
    const { action, payout } = confirm;
    const id = payout._id;
    const calls: Record<PayoutAction, () => Promise<unknown>> = {
      approve: () => apiFetch(`/payouts/admin/${id}/approve`, { method: "POST", body: "{}" }),
      reject: () => apiFetch(`/payouts/admin/${id}/reject`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) }),
      pay: () => apiFetch(`/payouts/admin/${id}/process`, { method: "POST", body: "{}" }),
      retry: () => apiFetch(`/payouts/admin/retry/${id}`, { method: "POST", body: "{}" }),
    };
    const done: Record<PayoutAction, string> = {
      approve: "Payout approved. It can now be paid.",
      reject: "Payout rejected. Its jobs can go into a new payout.",
      pay: "Payment sent to Stripe",
      retry: "Payment sent to Stripe",
    };
    setBusy(`act-${id}`);
    try {
      const res: any = await calls[action]();
      // A payment can be accepted by the API and still fail at Stripe.
      if ((action === "pay" || action === "retry") && res?.payout?.status === "failed") {
        toast.error(res.payout.failureReason || "Stripe refused the payment, with no reason given.", { duration: 9000 });
      } else {
        toast.success(done[action]);
      }
      setConfirm(null);
      setReason("");
      setDetail(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "That didn't work. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  // Paying needs the partner's Stripe account; say so before the click, not after.
  const confirmPartner = confirm ? partners.find((x) => x.printerId === confirm.payout.printerId?._id) : undefined;
  const paying = confirm?.action === "pay" || confirm?.action === "retry";
  const cannotPay = paying && confirmPartner ? !confirmPartner.stripeOnboarded || !confirmPartner.payoutsEnabled : false;

  const cards = stats
    ? [
        { label: "Awaiting review", value: String(stats.counts.pendingReview), note: "Payouts to approve or reject" },
        { label: "Approved, not paid", value: String(stats.counts.approved), note: "Ready for Pay now" },
        { label: "Still to pay", value: currency(stats.amounts.totalPending), note: "In review, approved or paying" },
        { label: "Paid to partners", value: currency(stats.amounts.totalPaid), note: `${stats.counts.paid} payout${stats.counts.paid === 1 ? "" : "s"}` },
      ]
    : [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-bold text-gray-900">Payouts</h1>
            <p className="text-gray-500">Pay print partners for the jobs they've shipped</p>
          </div>
          <button
            onClick={() => downloadPayoutsCsv(filter).catch((e) => toast.error(e?.message || "Export failed"))}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <FiDownload className="h-4 w-4" /> Export CSV
          </button>
        </div>

        {loadError ? (
          <div className="rounded-xl border border-red-200 bg-white p-8 text-center">
            <FiAlertTriangle className="mx-auto h-6 w-6 text-red-500" />
            <p className="mt-2 font-medium text-gray-900">Payouts couldn't be loaded</p>
            <p className="text-sm text-gray-500">{loadError}</p>
            <button onClick={() => void load()} className="mt-3 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800">
              Try again
            </button>
          </div>
        ) : loading ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">Loading payouts…</div>
        ) : (
          <>
            {stats && stats.counts.failed > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800">
                {stats.counts.failed} payout{stats.counts.failed === 1 ? "" : "s"} failed at Stripe. Open the Failed tab to try again.
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {cards.map((c) => (
                <div key={c.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{c.label}</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900 tabular-nums">{c.value}</p>
                  <p className="mt-1 text-xs text-gray-500">{c.note}</p>
                </div>
              ))}
            </div>

            <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-5 py-4">
                <h2 className="font-semibold text-gray-900">Partners</h2>
                <p className="text-sm text-gray-500">
                  A partner's shipped jobs that aren't in a payout yet are ready to pay. Creating a payout puts them up for review.
                </p>
              </div>
              {partners.length === 0 ? (
                <p className="p-6 text-sm text-gray-500">No print partners yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">Partner</th>
                        <th className="px-5 py-3 font-medium">Stripe</th>
                        <th className="px-5 py-3 font-medium">Ready to pay</th>
                        <th className="px-5 py-3 font-medium">Paid so far</th>
                        <th className="px-5 py-3 font-medium">Payouts on</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {partners.map((p) => (
                        <tr key={p.printerId}>
                          <td className="px-5 py-3">
                            <div className="font-medium text-gray-900">{p.companyName || p.name}</div>
                            <div className="text-xs text-gray-500">{p.email}</div>
                          </td>
                          <td className="px-5 py-3">
                            <span className={p.stripeOnboarded ? "text-green-700" : "text-amber-700"}>
                              {p.stripeOnboarded ? "Connected" : p.stripeConnected ? "Setup not finished" : "Not connected"}
                            </span>
                          </td>
                          <td className="px-5 py-3 tabular-nums">
                            <span className="font-medium text-gray-900">{currency(p.eligibleAmount)}</span>
                            <span className="text-gray-500"> · {p.eligibleJobs} job{p.eligibleJobs === 1 ? "" : "s"}</span>
                          </td>
                          <td className="px-5 py-3 tabular-nums text-gray-700">{currency(p.totalPaid)}</td>
                          <td className="px-5 py-3">
                            <Toggle label={`Payouts for ${p.name || "this partner"}`} enabled={p.payoutsEnabled} setEnabled={(next) => void togglePayouts(p, next)} />
                          </td>
                          <td className="px-5 py-3 text-right">
                            <button
                              onClick={() => void createPayout(p)}
                              disabled={busy !== null || p.eligibleJobs === 0}
                              title={p.eligibleJobs === 0 ? "No shipped, unpaid jobs" : undefined}
                              className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                            >
                              {busy === `create-${p.printerId}` ? "Creating…" : "Create payout"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
                <h2 className="font-semibold text-gray-900">Payouts</h2>
                <div className="flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-white p-1">
                  {FILTERS.map((f) => (
                    <button
                      key={f.key}
                      onClick={() => setFilter(f.key)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === f.key ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"}`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              {payouts.length === 0 ? (
                <p className="p-6 text-sm text-gray-500">
                  {filter === "all" ? "No payouts yet. Create one from a partner with jobs ready to pay." : "No payouts with this status."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">Partner</th>
                        <th className="px-5 py-3 font-medium">Amount</th>
                        <th className="px-5 py-3 font-medium">Jobs</th>
                        <th className="px-5 py-3 font-medium">Status</th>
                        <th className="px-5 py-3 font-medium">Created</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {payouts.map((p) => (
                        <tr key={p._id}>
                          <td className="px-5 py-3 font-medium text-gray-900">{partnerName(p.printerId)}</td>
                          <td className="px-5 py-3 font-semibold tabular-nums text-gray-900">{currency(p.amount)}</td>
                          <td className="px-5 py-3 text-gray-700">{p.orderIds?.length ?? 0}</td>
                          <td className="px-5 py-3">
                            <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${payoutStatusStyle(p.status)}`}>
                              {payoutStatusLabel(p.status)}
                            </span>
                            {p.status === "failed" && p.failureReason ? (
                              <div className="mt-1 max-w-[220px] text-xs text-red-600">{p.failureReason}</div>
                            ) : null}
                          </td>
                          <td className="px-5 py-3 text-gray-500">{dateOf(p.createdAt)}</td>
                          <td className="px-5 py-3">
                            <div className="flex flex-wrap justify-end gap-2">
                              <button onClick={() => void openDetail(p._id)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                                View jobs
                              </button>
                              {payoutActions(p.status, Boolean(p.stripeTransferId)).map((a) => (
                                <button
                                  key={a}
                                  onClick={() => setConfirm({ action: a, payout: p })}
                                  disabled={busy !== null}
                                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${
                                    a === "reject" ? "border border-red-200 text-red-700 hover:bg-red-50" : "bg-blue-600 text-white hover:bg-blue-700"
                                  }`}
                                >
                                  {ACTION_LABEL[a]}
                                </button>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{detail.payout.printer?.name || "Payout"}</h3>
                <p className="text-sm text-gray-500">
                  {currency(detail.payout.amount)} · {payoutStatusLabel(detail.payout.status)}
                </p>
              </div>
              <button onClick={() => setDetail(null)} className="text-sm text-gray-500 hover:text-gray-700">Close</button>
            </div>
            <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">Jobs in this payout</h4>
            <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-100 text-sm">
              {detail.jobs.map((j) => (
                <li key={j.orderId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>
                    <span className="font-medium text-gray-900">{j.displayId || j.orderId.slice(-6)}</span>
                    <span className="text-gray-500"> · {j.customerName || "Customer"} · shipped {dateOf(j.completedAt)}</span>
                  </span>
                  <span className="font-medium tabular-nums text-gray-900">{currency(j.amount)}</span>
                </li>
              ))}
            </ul>
            <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">History</h4>
            <ul className="mt-2 space-y-1.5 text-sm text-gray-700">
              {detail.payout.statusHistory.map((h, i) => (
                <li key={i}>
                  <span className="font-medium">{payoutStatusLabel(h.status)}</span>
                  <span className="text-gray-500">
                    {" "}· {dateOf(h.at)}
                    {h.changedByName ? ` · ${h.changedByName}` : ""}
                    {h.note ? ` · ${h.note}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">
              {confirm.action === "approve" && `Approve ${currency(confirm.payout.amount)} for ${partnerName(confirm.payout.printerId)}?`}
              {confirm.action === "reject" && `Reject this ${currency(confirm.payout.amount)} payout?`}
              {confirm.action === "pay" && `Pay ${currency(confirm.payout.amount)} to ${partnerName(confirm.payout.printerId)}?`}
              {confirm.action === "retry" &&
                (confirm.payout.stripeTransferId
                  ? `Send ${currency(confirm.payout.amount)} to ${partnerName(confirm.payout.printerId)}'s bank again?`
                  : `Try paying ${currency(confirm.payout.amount)} to ${partnerName(confirm.payout.printerId)} again?`)}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {confirm.action === "approve" && "Approving doesn't send any money. Use Pay now afterwards to send it."}
              {confirm.action === "reject" && "The payout is closed and its jobs become ready to pay again."}
              {confirm.action === "retry" && confirm.payout.stripeTransferId
                ? "The money is already in their Stripe balance. This only sends it on to their bank, so nothing is paid twice."
                : (confirm.action === "pay" || confirm.action === "retry") &&
                  "This sends the money to the partner's Stripe account now. It can't be undone from here."}
            </p>
            {cannotPay && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {confirmPartner && !confirmPartner.payoutsEnabled
                  ? "Payouts are paused for this partner. Switch them back on to pay."
                  : "This partner hasn't finished connecting their Stripe account, so they can't be paid yet. They connect it from Settings in the printer portal."}
              </p>
            )}
            {confirm.action === "reject" && (
              <>
                <label htmlFor="payout-reject-reason" className="mt-4 block text-sm font-medium text-gray-700">Reason</label>
                <textarea
                  id="payout-reject-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="Why is this payout being rejected?"
                />
              </>
            )}
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row">
              <button
                onClick={() => { setConfirm(null); setReason(""); }}
                disabled={busy !== null}
                className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void perform()}
                disabled={busy !== null || cannotPay || (confirm.action === "reject" && !reason.trim())}
                className={`flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60 ${
                  confirm.action === "reject" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {busy ? "Working…" : ACTION_LABEL[confirm.action]}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};
