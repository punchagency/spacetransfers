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

  useEffect(() => {
    Promise.all([
      apiFetch("/printer/settings").catch(() => null),
      apiFetch("/payouts/printer/connect/status").catch(() => null),
    ]).then(([settings, payout]) => {
      setSettingsData(settings);
      setPayoutStatus(payout);
      setLoading(false);
    });
  }, []);

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
            <NotificationsSection
              initialPrefs={settingsData?.notifications?.email ?? null}
            />
          </div>

          <div id="payout-settings">
            <PayoutSettingsSection initialStatus={payoutStatus} />
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
