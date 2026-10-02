import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { HiOutlineLockClosed } from "react-icons/hi";
import { FiEye, FiEyeOff } from "react-icons/fi";
import { BsArrowRight } from "react-icons/bs";
import { FaCheck } from "react-icons/fa";
import toast from "react-hot-toast";
import { AuthBanner } from "../components/auth/AuthBanner";
import { apiFetch } from "../utils/api";
import { LEGAL_DOCUMENTS, buildLegalAcceptancePayload } from "../utils/legal";

/**
 * Where an invitation lands.
 *
 * An admin adding a partner does not set a password for them — the server mints
 * a single-use token and emails this link. Without this page the invitation was
 * a dead end: the link resolved to the sign-in form, which ignored the token, so
 * an invited partner had no way in and no way to find out why.
 *
 * It also serves the ordinary forgotten-password flow, which posts to the same
 * endpoint with the same shape.
 */

/** Mirrors the server, which rejects anything shorter with a 400. */
const MIN_LENGTH = 8;

const SetPasswordPage = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  // `inviteToken` for a new partner, `resetToken` for a forgotten password.
  // Same server-side token, two names depending on which email produced it.
  const token = params.get("inviteToken") || params.get("resetToken") || "";
  const isInvite = Boolean(params.get("inviteToken"));

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [contentResponsibilityAccepted, setContentResponsibilityAccepted] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;
  const consentGiven = !isInvite || (termsAccepted && contentResponsibilityAccepted);
  const canSubmit =
    password.length >= MIN_LENGTH &&
    password === confirm &&
    consentGiven &&
    !saving &&
    Boolean(token);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      await apiFetch("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          token,
          newPassword: password,
          // Sent only when this screen collected it. The server ignores it for
          // an account that already has a record, and requires it for one that
          // does not — so the decision does not rest on the client.
          ...(isInvite
            ? {
                legalAcceptance: buildLegalAcceptancePayload(
                  termsAccepted,
                  contentResponsibilityAccepted,
                ),
              }
            : {}),
        }),
      });
      /*
       * Deliberately not signed in automatically. The endpoint returns a
       * message, not a session, and inventing one here would mean a second
       * source of truth for how a session begins. Signing in proves the
       * password works, which is the point of setting it.
       */
      toast.success("Password set. Please sign in.");
      navigate("/auth", { replace: true });
    } catch (error: any) {
      // The server says "Invalid or expired reset token" for both a bad token
      // and one past its 7 days; surfaced as-is rather than guessed at.
      toast.error(error?.message || "Could not set your password");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full pl-11 pr-11 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none " +
    "focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm " +
    "placeholder:text-slate-400";

  return (
    <div className="flex h-screen w-full font-sans bg-white overflow-hidden">
      <AuthBanner isSignIn />

      <div className="flex-1 flex items-center justify-center p-6 lg:p-16 overflow-y-auto">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-bold text-slate-900">
            {isInvite ? "Welcome — set your password" : "Set a new password"}
          </h1>
          <p className="text-sm text-slate-500 mt-2">
            {isInvite
              ? "Your account has been created. Choose a password to finish setting it up, then complete your business details so work can be sent to you."
              : "Choose a new password for your account."}
          </p>

          {!token ? (
            /*
             * Reached without a token — a copy-paste that dropped the query
             * string, or someone opening the page directly. Says so plainly
             * rather than presenting a form that cannot succeed.
             */
            <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-slate-900">This link is incomplete</p>
              <p className="text-sm text-slate-600 mt-1">
                Open the link from your invitation email exactly as it was sent — the part
                after the question mark is what identifies your account.
              </p>
              <button
                onClick={() => navigate("/auth")}
                className="mt-3 text-sm font-semibold text-blue-600 hover:text-blue-700"
              >
                Go to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-8 space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-700">New password</label>
                <div className="relative mt-1.5">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <HiOutlineLockClosed className="text-slate-400 text-lg" />
                  </div>
                  <input
                    type={show ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder={`At least ${MIN_LENGTH} characters`}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    aria-label={show ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-slate-600"
                  >
                    {show ? <FiEyeOff /> : <FiEye />}
                  </button>
                </div>
                {tooShort && (
                  <p className="text-xs text-red-600 mt-1.5">
                    Must be at least {MIN_LENGTH} characters.
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700">Confirm password</label>
                <div className="relative mt-1.5">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <HiOutlineLockClosed className="text-slate-400 text-lg" />
                  </div>
                  <input
                    type={show ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    placeholder="Type it again"
                    className={inputClass}
                  />
                </div>
                {mismatch && (
                  <p className="text-xs text-red-600 mt-1.5">Both passwords must match.</p>
                )}
              </div>

              {isInvite && (
                <div className="space-y-2.5 pt-1">
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => setTermsAccepted((v) => !v)}
                      className={`mt-0.5 flex-shrink-0 h-4 w-4 rounded border transition-colors flex items-center justify-center cursor-pointer ${
                        termsAccepted ? "bg-blue-600 border-blue-600" : "bg-white border-slate-300 hover:border-blue-400"
                      }`}
                    >
                      {termsAccepted && <FaCheck className="text-white text-[9px]" />}
                    </button>
                    <label
                      onClick={() => setTermsAccepted((v) => !v)}
                      className="text-xs text-slate-500 leading-snug cursor-pointer select-none"
                    >
                      I have read and agree to the{" "}
                      <a href={LEGAL_DOCUMENTS.terms.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-600 hover:underline">{LEGAL_DOCUMENTS.terms.title}</a>{" "}
                      and{" "}
                      <a href={LEGAL_DOCUMENTS.privacy.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-600 hover:underline">{LEGAL_DOCUMENTS.privacy.title}</a>
                    </label>
                  </div>

                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => setContentResponsibilityAccepted((v) => !v)}
                      className={`mt-0.5 flex-shrink-0 h-4 w-4 rounded border transition-colors flex items-center justify-center cursor-pointer ${
                        contentResponsibilityAccepted ? "bg-blue-600 border-blue-600" : "bg-white border-slate-300 hover:border-blue-400"
                      }`}
                    >
                      {contentResponsibilityAccepted && <FaCheck className="text-white text-[9px]" />}
                    </button>
                    <label
                      onClick={() => setContentResponsibilityAccepted((v) => !v)}
                      className="text-xs text-slate-500 leading-snug cursor-pointer select-none"
                    >
                      I accept the{" "}
                      <a href={LEGAL_DOCUMENTS.contentPolicy.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-600 hover:underline">{LEGAL_DOCUMENTS.contentPolicy.title}</a>{" "}
                      and am solely responsible for the content uploaded through this account
                    </label>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className={`w-full py-3 px-4 rounded-xl text-white font-semibold shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] ${
                  canSubmit ? "bg-[#3B82F6] hover:bg-blue-600" : "bg-blue-400 cursor-not-allowed opacity-70"
                }`}
              >
                {saving ? "Setting password…" : isInvite ? "Set password" : "Update password"}
                {!saving && <BsArrowRight />}
              </button>

              <p className="text-xs text-slate-400 text-center">
                This link works once and expires seven days after it was sent.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default SetPasswordPage;
