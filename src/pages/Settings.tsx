import { useState, useEffect } from "react";
import SettingsHeader from "../components/settings/SettingsHeader";
import { PasskeyManager } from "../components/security/PasskeyManager";
import { getUser } from "../utils/auth";
import NotificationsSection from "../components/settings/NotificationsSection";
import PayoutSettingsSection from "../components/settings/PayoutSettingsSection";
import { apiFetch } from "../utils/api";
import { SpaceLoader } from "../components/common/SpaceLoader";

const Settings = () => {
  const [settingsData, setSettingsData] = useState<any>(null);
  const [payoutStatus, setPayoutStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  /*
   * Each section's load failure, kept apart. They were turned into "no data"
   * (`.catch(() => null)`), so a failed load showed the notification switches
   * at their defaults — which a partner could then save over their real
   * preferences — and the payout section misread an unknown status.
   */
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch("/printer/settings").then(
        (v) => { setSettingsError(null); return v; },
        (e: any) => { setSettingsError(e?.message || "Your notification settings couldn't be loaded."); return null; },
      ),
      apiFetch("/payouts/printer/connect/status").then(
        (v) => { setPayoutError(null); return v; },
        (e: any) => { setPayoutError(e?.message || "Your payout status couldn't be loaded."); return null; },
      ),
    ]).then(([settings, payout]) => {
      setSettingsData(settings);
      setPayoutStatus(payout);
      setLoading(false);
    });
  }, [reloadKey]);

  const loadFailed = (title: string, message: string) => (
    <div role="alert" className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center gap-2 text-center">
      <p className="text-gray-900 font-semibold">{title}</p>
      <p className="text-gray-500 text-sm max-w-md">{message}</p>
      <button
        onClick={() => setReloadKey((k) => k + 1)}
        className="mt-2 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800"
      >
        Try again
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      <SettingsHeader />

      {loading ? (
        <div className="flex items-center justify-center min-h-[400px]">
          <SpaceLoader />
        </div>
      ) : (
        <div className="space-y-8">
          <div id="notifications">
            {settingsError ? (
              loadFailed("Your notification settings couldn't be loaded", settingsError)
            ) : (
              <NotificationsSection
                initialPrefs={settingsData?.notifications?.email ?? null}
              />
            )}
          </div>

          <div id="security" className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
            <PasskeyManager account={String(getUser()?.email || "")} />
          </div>

          <div id="payout-settings">
            {payoutError ? (
              loadFailed("Your payout status couldn't be loaded", payoutError)
            ) : (
              <PayoutSettingsSection initialStatus={payoutStatus} />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
