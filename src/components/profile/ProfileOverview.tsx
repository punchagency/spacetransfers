import { useState, useEffect, useCallback } from "react";
import {
  FiCheckCircle,
  FiMail,
  FiAlertCircle,
  FiSend,
  FiRefreshCw,
} from "react-icons/fi";
import { PrinterProfile } from "../../types/profile";
import { apiFetch } from "../../utils/api";
import { formatDate } from "../../utils/datetime";
import { toast } from "react-hot-toast";

interface ProfileOverviewProps {
  profile: PrinterProfile;
  onUpdate: () => void;
}

export const ProfileOverview = ({ profile, onUpdate }: ProfileOverviewProps) => {
  const { verificationStatus, businessAddress } = profile;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">
            Personal Information
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="text-xs font-semibold text-gray-500">Full Name</div>
            <div className="mt-1 text-sm font-medium text-gray-900">
              {profile.name}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500">
              Email Address
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900">
                {profile.email}
              </span>
              {verificationStatus?.email ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-[11px] font-semibold text-emerald-700 border border-emerald-100">
                  <FiCheckCircle className="w-3 h-3" />
                  Verified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-[11px] font-semibold text-amber-700 border border-amber-100">
                  <FiAlertCircle className="w-3 h-3" />
                  Not Verified
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500">
              Phone Number
            </div>
            <div className="mt-1 text-sm font-medium text-gray-900">
              {profile.phone || "N/A"}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">Address</h3>
          {businessAddress?.verified && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-[11px] font-semibold text-emerald-700 border border-emerald-100">
              <FiCheckCircle className="w-3 h-3" />
              Verified
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          <div>
            <div className="text-xs font-semibold text-gray-500">
              Street Address
            </div>
            <div className="mt-1 text-sm font-medium text-gray-900">
              {businessAddress?.street || "N/A"}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500">City</div>
            <div className="mt-1 text-sm font-medium text-gray-900">
              {businessAddress?.city || "N/A"}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500">State</div>
            <div className="mt-1 text-sm font-medium text-gray-900">
              {businessAddress?.state || "N/A"}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500">Zip Code</div>
            <div className="mt-1 text-sm font-medium text-gray-900">
              {businessAddress?.postalCode || "N/A"}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500">Country</div>
            <div className="mt-1 text-sm font-medium text-gray-900">
              {businessAddress?.country || "N/A"}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">
            Verification Status
          </h3>
        </div>
        <div className="space-y-3">
          <EmailVerificationItem
            email={profile.email}
            isVerified={verificationStatus?.email || false}
            onVerified={onUpdate}
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">
            Performance Overview
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-4 rounded-xl bg-gray-50 border border-gray-100">
            <div className="text-xs font-semibold text-gray-500 uppercase">Completion Rate</div>
            <div className="mt-2 flex items-end gap-1">
              <span className="text-2xl font-bold text-gray-900">{profile.performance?.completionRate || 0}%</span>
              <span className="text-xs text-emerald-600 font-medium mb-1">Target 95%+</span>
            </div>
          </div>
          <div className="p-4 rounded-xl bg-gray-50 border border-gray-100">
            <div className="text-xs font-semibold text-gray-500 uppercase">Avg. Response Time</div>
            <div className="mt-2 flex items-end gap-1">
              <span className="text-2xl font-bold text-gray-900">
                {(profile.performance?.responseTime || 0) < 60
                  ? `${profile.performance?.responseTime || 0}m`
                  : `${Math.round((profile.performance?.responseTime || 0) / 60)}h`}
              </span>
              <span className="text-xs text-emerald-600 font-medium mb-1">Top 10%</span>
            </div>
          </div>
        </div>
      </div>

      {profile?.badges?.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-900">
              Badges & Achievements
            </h3>
          </div>
          <div className="flex flex-wrap gap-4">
            {profile.badges.map((badge, index) => (
              <div key={index} className="flex items-center gap-3 px-4 py-2 rounded-xl bg-blue-50 border border-blue-100 text-blue-700">
                <span className="text-lg">{badge.icon}</span>
                <div>
                  <div className="text-sm font-bold">{badge.name}</div>
                  <div className="text-[10px] opacity-75">Earned {formatDate(badge.dateEarned)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Email Verification Item ──────────────────────────────────────────────────

type SendState = "idle" | "sending" | "sent" | "error";

interface EmailVerificationItemProps {
  email: string;
  isVerified: boolean;
  onVerified?: () => void;
}

const COOLDOWN_SECS = 60;

const EmailVerificationItem = ({ email, isVerified }: EmailVerificationItemProps) => {
  const [sendState, setSendState] = useState<SendState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [cooldown, setCooldown] = useState(0);

  // Tick down the resend cooldown
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1_000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const sendVerification = useCallback(async () => {
    setSendState("sending");
    setErrorMsg("");
    try {
      await apiFetch("/printer/profile/verify-email", { method: "POST" });
      setSendState("sent");
      setCooldown(COOLDOWN_SECS);
      toast.success("Verification email sent — check your inbox");
    } catch (err: any) {
      const msg = err.message || "Failed to send verification email";
      // Server returns retryAfterSecs when rate-limited
      const match = msg.match(/(\d+)s/);
      if (match) {
        setCooldown(parseInt(match[1], 10));
        setSendState("sent");
      } else {
        setSendState("error");
        setErrorMsg(msg);
      }
      toast.error(msg);
    }
  }, []);

  if (isVerified) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-gray-100 px-4 py-4 bg-gray-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-100 text-emerald-600">
            <FiMail size={20} />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900">Email Verification</div>
            <div className="text-xs text-gray-500">{email}</div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-50 text-[11px] font-semibold text-emerald-700 border border-emerald-100">
          <FiCheckCircle className="w-3 h-3" />
          Verified
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-100 px-4 py-4 bg-amber-50/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-amber-100 text-amber-600">
            <FiMail size={20} />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900">Email Verification</div>
            <div className="text-xs text-gray-500">{email}</div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-50 text-[11px] font-semibold text-amber-700 border border-amber-100">
          <FiAlertCircle className="w-3 h-3" />
          Not Verified
        </span>
      </div>

      <div className="mt-4 pt-3 border-t border-amber-100">
        {sendState === "idle" && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">Verify your email to unlock full account features.</p>
            <button
              onClick={sendVerification}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              <FiSend className="w-3 h-3" />
              Send Verification Email
            </button>
          </div>
        )}

        {sendState === "sending" && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <FiRefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" />
            Sending verification email…
          </div>
        )}

        {sendState === "sent" && (
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1.5 text-xs text-emerald-700">
              <FiCheckCircle className="w-3.5 h-3.5" />
              <span>Verification email sent to <strong>{email}</strong>. Check your inbox.</span>
            </div>
            <button
              onClick={sendVerification}
              disabled={cooldown > 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-gray-100 hover:bg-gray-200 text-gray-700"
            >
              <FiRefreshCw className="w-3 h-3" />
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend Email"}
            </button>
          </div>
        )}

        {sendState === "error" && (
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1.5 text-xs text-red-600">
              <FiAlertCircle className="w-3.5 h-3.5" />
              {errorMsg}
            </div>
            <button
              onClick={sendVerification}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              <FiSend className="w-3 h-3" />
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
