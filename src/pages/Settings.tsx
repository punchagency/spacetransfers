import { useState, useEffect } from "react";
import SettingsHeader from "../components/settings/SettingsHeader";
import BusinessHoursSection from "../components/settings/BusinessHoursSection";
import JobCapacitySection from "../components/settings/JobCapacitySection";
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
          <div id="business-hours">
            <BusinessHoursSection initialData={settingsData} />
          </div>

          <div id="job-capacity">
            <JobCapacitySection autoAcceptInitial={settingsData?.jobCapacity?.autoAccept !== false} />
          </div>

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
