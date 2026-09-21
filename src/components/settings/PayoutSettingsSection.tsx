import { useEffect, useState } from "react";
import {
  FiCreditCard,
  FiExternalLink,
  FiCheckCircle,
  FiAlertCircle,
  FiCalendar,
  FiInfo,
} from "react-icons/fi";
import { apiFetch } from "../../utils/api";
import toast from "react-hot-toast";

interface StripeStatus {
  connected: boolean;
  onboarded: boolean;
  payoutsEnabled: boolean;
  accountId: string | null;
  /**
   * Whether the platform's payment provider is set up at all — distinct from
   * whether *this partner* has connected. Absent on older responses, so it is
   * treated as configured unless the server explicitly says otherwise.
   */
  configured?: boolean;
  details: {
    email: string | null;
    country: string | null;
    defaultCurrency: string | null;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
  } | null;
}

const PayoutSettingsSection = ({ initialStatus }: { initialStatus: StripeStatus | null }) => {
  const [status, setStatus] = useState<StripeStatus | null>(initialStatus);
  const [connecting, setConnecting] = useState(false);

  // Only false when the server says so outright.
  const platformReady = status?.configured !== false;

  const fetchStatus = async () => {
    try {
      const data = await apiFetch("/payouts/printer/connect/status");
      setStatus(data);
    } catch {
      // silently fail
    }
  };

  useEffect(() => {
    // Check for Stripe redirect result in URL params
    const params = new URLSearchParams(window.location.search);
    if (params.get("stripe") === "success") {
      toast.success("Stripe account connected successfully!");
      fetchStatus();
      // Clean up URL
      const url = new URL(window.location.href);
      url.searchParams.delete("stripe");
      window.history.replaceState({}, "", url.toString());
    } else if (params.get("stripe") === "refresh") {
      toast("Continue your Stripe onboarding to receive payouts.", { icon: "ℹ️" });
    }
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const data = await apiFetch("/payouts/printer/connect", { method: "POST" });
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to start Stripe onboarding");
      setConnecting(false);
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
          <FiCreditCard className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Payout Settings
          </h2>
          <p className="text-xs text-gray-500">
            Stripe Connect (test mode) — bank transfers only
          </p>
        </div>
        {!platformReady && (
          <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-gray-600 bg-gray-100 px-2.5 py-1 rounded-full border border-gray-200">
            <FiInfo className="w-3.5 h-3.5" />
            Coming soon
          </span>
        )}
        {platformReady && status?.onboarded && (
          <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-50 px-2.5 py-1 rounded-full border border-green-200">
            <FiCheckCircle className="w-3.5 h-3.5" />
            Connected
          </span>
        )}
        {platformReady && status && !status.onboarded && (
          <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-orange-700 bg-orange-50 px-2.5 py-1 rounded-full border border-orange-200">
            <FiAlertCircle className="w-3.5 h-3.5" />
            Not connected
          </span>
        )}
      </div>

      <div className="space-y-4">
          {/* Connected info */}
          {status?.onboarded && status.details && (
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Connected Account
              </p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-500 text-xs">Account Email</span>
                  <p className="font-medium text-gray-900">{status.details.email || "—"}</p>
                </div>
                <div>
                  <span className="text-gray-500 text-xs">Country</span>
                  <p className="font-medium text-gray-900 uppercase">{status.details.country || "—"}</p>
                </div>
                <div>
                  <span className="text-gray-500 text-xs">Currency</span>
                  <p className="font-medium text-gray-900 uppercase">{status.details.defaultCurrency || "usd"}</p>
                </div>
                <div>
                  <span className="text-gray-500 text-xs">Payout Status</span>
                  <p className={`font-medium ${status.payoutsEnabled ? "text-green-600" : "text-red-600"}`}>
                    {status.payoutsEnabled ? "Enabled" : "Disabled by admin"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/*
            The button is not offered while the platform's payment provider is
            unconfigured. Pressing it used to reach Stripe with a placeholder
            key, come back 401, and sign the partner out of a perfectly valid
            session. Saying so plainly beats a control that punishes the press.
          */}
          {!platformReady ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 leading-relaxed">
              <span className="font-semibold text-gray-900">Payouts aren&rsquo;t open yet.</span> Our
              payment provider is still being set up. You&rsquo;ll be able to link your bank account
              here as soon as it is — nothing is needed from you until then, and your earnings are
              still being tracked in the meantime.
            </div>
          ) : (
            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-60 text-sm"
            >
              {connecting ? (
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <FiExternalLink className="w-4 h-4" />
              )}
              {status?.onboarded ? "Update Stripe Account Details" : "Connect Stripe Account"}
            </button>
          )}

          {/* Payout schedule info */}
          <div className="pt-3 border-t border-dashed border-gray-200">
            <div className="flex items-start gap-2 text-xs text-gray-500">
              <FiCalendar className="w-3.5 h-3.5 mt-0.5 text-blue-500 flex-shrink-0" />
              <span>
                {platformReady
                  ? "Payouts are processed automatically every Friday via Stripe Connect (test mode). Bank transfers typically arrive within 1–3 business days."
                  : "Once payouts open, they run automatically every Friday and bank transfers typically arrive within 1–3 business days."}
              </span>
            </div>
            <div className="flex items-start gap-2 text-xs text-gray-500 mt-2">
              <FiInfo className="w-3.5 h-3.5 mt-0.5 text-gray-400 flex-shrink-0" />
              <span>
                Only Stripe Connect (bank transfer) is supported. Manual payout requests are not available —
                all payouts are fully automated.
              </span>
            </div>
          </div>
        </div>
    </section>
  );
};

export default PayoutSettingsSection;
