import { useState, useEffect } from "react";
import SettingsHeader from "../components/settings/SettingsHeader";
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
          {/*
            Business Hours was removed alongside Job Capacity.
            
            It set a recurring schedule that silently dropped you out of
            automatic assignment, and separately refused you permission to
            accept a job you had already been given — while that job's clock
            kept running. It was compared against the server's clock rather than
            yours, so the window was wrong for anyone outside the server's
            timezone. Pausing is how you stop taking work.
          */}
          {/*
            Job Capacity / Auto-Accept was removed. It did one thing — take you
            out of automatic assignment — which is exactly what the Paused pill
            in the top bar does, and that one tells the admin, records why, and
            syncs both portals. Two switches for one outcome meant your Settings
            page could read "Auto-Accept ON" while you were Paused and taking
            nothing. Pause is the switch now.
          */}
          <div id="notifications">
            {settingsError ? (
              loadFailed("Your notification settings couldn't be loaded", settingsError)
            ) : (
              <NotificationsSection
                initialPrefs={settingsData?.notifications?.email ?? null}
              />
            )}
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
