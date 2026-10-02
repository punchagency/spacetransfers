import { useState, useEffect, useCallback } from "react";
import {
  FiCheckCircle,
  FiMail,
  FiAlertCircle,
  FiSend,
  FiRefreshCw,
  FiEdit2,
  FiCheck,
  FiX,
} from "react-icons/fi";
import { PrinterProfile } from "../../types/profile";
import { apiFetch } from "../../utils/api";
import { isValidPhone } from "../../utils/validators";
import { toast } from "react-hot-toast";

interface ProfileOverviewProps {
  profile: PrinterProfile;
  onUpdate: () => void;
}

const inputClass = (invalid: boolean) =>
  `w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors ${
    invalid ? "border-red-300 focus:border-red-400" : "border-gray-200 focus:border-blue-500"
  }`;

export const ProfileOverview = ({ profile, onUpdate }: ProfileOverviewProps) => {
  const { verificationStatus, businessAddress } = profile;

  /*
   * This whole tab was read-only. The server has always accepted `name`,
   * `phone` and `businessAddress` on PATCH /printer/profile — there was simply
   * no way to reach it, so a partner who moved premises or changed their number
   * had to ask an admin. Address matters most: it sets the region that decides
   * which orders can be routed to them, and the origin printed on their labels.
   *
   * Email is deliberately not editable. Changing it would silently invalidate a
   * completed verification, and there is no re-verification flow behind it.
   */
  const [editingPersonal, setEditingPersonal] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [saving, setSaving] = useState(false);

  const [personal, setPersonal] = useState({ name: profile.name || "", phone: profile.phone === "N/A" ? "" : profile.phone || "" });
  const [address, setAddress] = useState({
    street: businessAddress?.street || "",
    city: businessAddress?.city || "",
    state: businessAddress?.state || "",
    postalCode: businessAddress?.postalCode || "",
    country: businessAddress?.country || "",
  });
  const [errors, setErrors] = useState<{ name?: string; phone?: string; street?: string; city?: string; state?: string; postalCode?: string }>({});

  // Re-seed from the server whenever a fetch lands, but never mid-edit.
  useEffect(() => {
    if (!editingPersonal) {
      setPersonal({ name: profile.name || "", phone: profile.phone === "N/A" ? "" : profile.phone || "" });
    }
  }, [profile.name, profile.phone, editingPersonal]);

  useEffect(() => {
    if (!editingAddress) {
      setAddress({
        street: businessAddress?.street || "",
        city: businessAddress?.city || "",
        state: businessAddress?.state || "",
        postalCode: businessAddress?.postalCode || "",
        country: businessAddress?.country || "",
      });
    }
  }, [businessAddress, editingAddress]);

  const savePersonal = async () => {
    const next: typeof errors = {};
    if (!personal.name.trim()) next.name = "Required";
    // The same rule the server enforces, so the error arrives before the request.
    if (personal.phone.trim() && !isValidPhone(personal.phone)) next.phone = "Enter a valid phone number";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    try {
      await apiFetch("/printer/profile", {
        method: "PATCH",
        body: JSON.stringify({ name: personal.name.trim(), phone: personal.phone.trim() }),
      });
      toast.success("Personal information updated");
      setEditingPersonal(false);
      onUpdate();
    } catch (error: any) {
      toast.error(error.message || "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const saveAddress = async () => {
    const next: typeof errors = {};
    if (!address.street.trim()) next.street = "Required";
    if (!address.city.trim()) next.city = "Required";
    if (!address.state.trim()) next.state = "Required";
    if (!address.postalCode.trim()) next.postalCode = "Required";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    try {
      await apiFetch("/printer/profile", {
        method: "PATCH",
        body: JSON.stringify({
          businessAddress: {
            street: address.street.trim(),
            city: address.city.trim(),
            state: address.state.trim().toUpperCase(),
            postalCode: address.postalCode.trim(),
            country: address.country.trim() || "US",
          },
        }),
      });
      /*
       * The server re-geocodes and reassigns the region on save, so the partner
       * is told what that did rather than finding out from their job feed.
       */
      toast.success("Address updated — your service region has been recalculated");
      setEditingAddress(false);
      onUpdate();
    } catch (error: any) {
      toast.error(error.message || "Failed to update address");
    } finally {
      setSaving(false);
    }
  };

  const EditControls = ({ editing, onEdit, onCancel, onSave }: {
    editing: boolean; onEdit: () => void; onCancel: () => void; onSave: () => void;
  }) =>
    !editing ? (
      <button
        onClick={onEdit}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
      >
        <FiEdit2 className="w-4 h-4" /> Edit
      </button>
    ) : (
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setErrors({}); onCancel(); }}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
        >
          <FiX className="w-4 h-4" /> Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
        >
          <FiCheck className="w-4 h-4" /> {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">
            Personal Information
          </h3>
          <EditControls
            editing={editingPersonal}
            onEdit={() => setEditingPersonal(true)}
            onCancel={() => setEditingPersonal(false)}
            onSave={savePersonal}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="text-xs font-semibold text-gray-500">Full Name</div>
            {editingPersonal ? (
              <>
                <input
                  value={personal.name}
                  onChange={(e) => setPersonal({ ...personal, name: e.target.value })}
                  className={`mt-1 ${inputClass(Boolean(errors.name))}`}
                />
                {errors.name && <p className="mt-1 text-[11px] text-red-600">{errors.name}</p>}
              </>
            ) : (
              <div className="mt-1 text-sm font-medium text-gray-900">{profile.name}</div>
            )}
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
            {editingPersonal ? (
              <>
                <input
                  value={personal.phone}
                  onChange={(e) => setPersonal({ ...personal, phone: e.target.value })}
                  placeholder="+1 (555) 010-2233"
                  className={`mt-1 ${inputClass(Boolean(errors.phone))}`}
                />
                {errors.phone ? (
                  <p className="mt-1 text-[11px] text-red-600">{errors.phone}</p>
                ) : (
                  <p className="mt-1 text-[11px] text-gray-400">
                    Printed on the shipping labels for your jobs
                  </p>
                )}
              </>
            ) : (
              <div className="mt-1 text-sm font-medium text-gray-900">{profile.phone || "N/A"}</div>
            )}
          </div>
        </div>
        {editingPersonal && (
          <p className="mt-4 text-[11px] text-gray-400">
            Your email address cannot be changed here — it identifies your account and is
            already verified against it.
          </p>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">Address</h3>
            {businessAddress?.verified && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-[11px] font-semibold text-emerald-700 border border-emerald-100">
                <FiCheckCircle className="w-3 h-3" />
                Verified
              </span>
            )}
          </div>
          <EditControls
            editing={editingAddress}
            onEdit={() => setEditingAddress(true)}
            onCancel={() => setEditingAddress(false)}
            onSave={saveAddress}
          />
        </div>
        {editingAddress && (
          <p className="mb-4 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
            This is where you print from. Changing it recalculates the service region you
            are matched against, so it changes which orders can be routed to you — and it is
            the origin address on your shipping labels. Your admin is notified.
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          <div>
            <div className="text-xs font-semibold text-gray-500">Street Address</div>
            {editingAddress ? (
              <>
                <input
                  value={address.street}
                  onChange={(e) => setAddress({ ...address, street: e.target.value })}
                  className={`mt-1 ${inputClass(Boolean(errors.street as string | undefined))}`}
                />
                {errors.street && <p className="mt-1 text-[11px] text-red-600">{errors.street}</p>}
              </>
            ) : (
              <div className="mt-1 text-sm font-medium text-gray-900">
                {businessAddress?.street || "N/A"}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500">City</div>
            {editingAddress ? (
              <>
                <input
                  value={address.city}
                  onChange={(e) => setAddress({ ...address, city: e.target.value })}
                  className={`mt-1 ${inputClass(Boolean(errors.city as string | undefined))}`}
                />
                {errors.city && <p className="mt-1 text-[11px] text-red-600">{errors.city}</p>}
              </>
            ) : (
              <div className="mt-1 text-sm font-medium text-gray-900">
                {businessAddress?.city || "N/A"}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500">State</div>
            {editingAddress ? (
              <>
                <input
                  value={address.state}
                  onChange={(e) => setAddress({ ...address, state: e.target.value })}
                  className={`mt-1 ${inputClass(Boolean(errors.state as string | undefined))}`}
                />
                {errors.state && <p className="mt-1 text-[11px] text-red-600">{errors.state}</p>}
              </>
            ) : (
              <div className="mt-1 text-sm font-medium text-gray-900">
                {businessAddress?.state || "N/A"}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500">Zip Code</div>
            {editingAddress ? (
              <>
                <input
                  value={address.postalCode}
                  onChange={(e) => setAddress({ ...address, postalCode: e.target.value })}
                  className={`mt-1 ${inputClass(Boolean(errors.postalCode as string | undefined))}`}
                />
                {errors.postalCode && <p className="mt-1 text-[11px] text-red-600">{errors.postalCode}</p>}
              </>
            ) : (
              <div className="mt-1 text-sm font-medium text-gray-900">
                {businessAddress?.postalCode || "N/A"}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500">Country</div>
            {editingAddress ? (
              <>
                <input
                  value={address.country}
                  onChange={(e) => setAddress({ ...address, country: e.target.value })}
                  placeholder="US"
                  className={`mt-1 ${inputClass(false)}`}
                />
              </>
            ) : (
              <div className="mt-1 text-sm font-medium text-gray-900">
                {businessAddress?.country || "N/A"}
              </div>
            )}
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
        {/*
          Both tiles read a stored object the server never wrote, so both were
          always zero — and the zeros were dressed as achievements: "Target
          95%+" beside 0%, and "Top 10%" beside 0m. These are computed from this
          partner's own shipped jobs now, and say "no data yet" when there is
          nothing to measure rather than showing a zero that reads as a failing
          grade. Same two figures the admin sees for this partner.
        */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-4 rounded-xl bg-gray-50 border border-gray-100">
            <div className="text-xs font-semibold text-gray-500 uppercase">Avg. Production Time</div>
            <div className="mt-2">
              {typeof profile.performance?.averageProductionHours === "number" ? (
                <span className="text-2xl font-bold text-gray-900">
                  {profile.performance.averageProductionHours < 24
                    ? `${profile.performance.averageProductionHours} hrs`
                    : `${(profile.performance.averageProductionHours / 24).toFixed(1)} days`}
                </span>
              ) : (
                <span className="text-sm font-medium text-gray-400">No shipped jobs yet</span>
              )}
            </div>
            <div className="mt-1 text-[11px] text-gray-400">
              From when a job is assigned to when you ship it
            </div>
          </div>
          <div className="p-4 rounded-xl bg-gray-50 border border-gray-100">
            <div className="text-xs font-semibold text-gray-500 uppercase">On-Time Delivery</div>
            <div className="mt-2">
              {typeof profile.performance?.onTimeDeliveryRate === "number" ? (
                <span
                  className={`text-2xl font-bold ${profile.performance.onTimeDeliveryRate >= 90 ? "text-gray-900" : "text-amber-600"}`}
                >
                  {profile.performance.onTimeDeliveryRate}%
                </span>
              ) : (
                <span className="text-sm font-medium text-gray-400">No shipped jobs yet</span>
              )}
            </div>
            <div className="mt-1 text-[11px] text-gray-400">
              {profile.performance?.sampleSize
                ? `Across ${profile.performance.sampleSize} shipped job${profile.performance.sampleSize === 1 ? "" : "s"}`
                : "Shipped by the deadline you were given"}
            </div>
          </div>
        </div>
      </div>

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
