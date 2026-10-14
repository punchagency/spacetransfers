import React, { useEffect, useRef, useState } from "react";
import { MdClose, MdEmail, MdLock, MdPerson, MdVisibility, MdVisibilityOff } from "react-icons/md";
import { apiFetch } from "../../lib/utils/api";
import { setToken } from "../../lib/utils/auth";
import { needsSecondStep, type SecondStepChallenge } from "../../lib/utils/passkeys";
import { SecondStep } from "../security/SecondStep";
import LegalAcceptance from "./LegalAcceptance";
import LegalDocumentModal from "./LegalDocumentModal";
import { buildLegalAcceptancePayload } from "../../lib/legal/documents";
import type { LegalContent } from "../../lib/legal/content";
import toast from "react-hot-toast";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (user: any) => void;
  onSubAccountCreated?: (user: any) => void;
  initialView?: "login" | "register";
  isSubAccountCreation?: boolean;
  resetToken?: string | null;
  resetEmail?: string | null;
}

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) || "";

/**
 * Mirrors the server's rule in `auth.service` — 8 characters, checked on
 * register, sub-account creation and reset. The form enforced nothing, so a
 * short password cost a round trip to learn what the field could have said.
 */
const MIN_PASSWORD_LENGTH = 8;

export default function AuthModal({
  isOpen,
  onClose,
  onAuthSuccess,
  onSubAccountCreated,
  initialView = "login",
  isSubAccountCreation = false,
  resetToken,
  resetEmail,
}: AuthModalProps) {
  const [mode, setMode] = useState<"auth" | "forgot" | "reset">("auth");
  const [view, setView] = useState<"login" | "register">(
    isSubAccountCreation ? "register" : initialView
  );
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
  });
  /*
   * Confirm password, on the two views that set one: sign-up and reset. A
   * mistyped password on either is unrecoverable without the email flow — and
   * email delivery is not working — so catching it here is the difference
   * between a typo and a locked-out account.
   */
  const [confirmPassword, setConfirmPassword] = useState("");
  const [activeResetToken, setActiveResetToken] = useState<string | null>(null);
  const [secondStep, setSecondStep] = useState<SecondStepChallenge | null>(null);

  // Legal acknowledgements. Never pre-selected, and reset whenever the user
  // leaves the register view so a stale tick can't carry across.
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [contentResponsibilityAccepted, setContentResponsibilityAccepted] = useState(false);
  // Errors appear only after a submit attempt, so an untouched form isn't
  // pre-emptively shouting at the user.
  const [showLegalErrors, setShowLegalErrors] = useState(false);
  // Legal documents replace the sign-up dialog while they are being read.
  // Keeping this state here (rather than inside LegalAcceptance) prevents two
  // modal backdrops from being visible at once.
  const [activeLegalDocument, setActiveLegalDocument] = useState<LegalContent | null>(null);
  const googleBtnContainerRef = useRef<HTMLDivElement>(null);
  // Stable ref so GIS callback always calls the latest handler
  const credentialHandlerRef = useRef<((r: { credential: string }) => void) | null>(null);

  // Load GIS script once globally
  useEffect(() => {
    if (document.getElementById("gsi-script")) return;
    const script = document.createElement("script");
    script.id = "gsi-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    setView(isSubAccountCreation ? "register" : initialView);
    if (resetToken) {
      setMode("reset");
      setView("login");
      setActiveResetToken(resetToken);
    } else {
      setMode("auth");
      setActiveResetToken(null);
    }
    // Consent must be given afresh each time the sign-up form is presented.
    setTermsAccepted(false);
    setContentResponsibilityAccepted(false);
    setShowLegalErrors(false);
    setActiveLegalDocument(null);
    setLoading(false);
    setGoogleLoading(false);
    setShowPassword(false);
    setError(null);
    setFormData({
      name: "",
      email: resetEmail || "",
      password: "",
    });
    setConfirmPassword("");
  }, [isOpen, initialView, isSubAccountCreation, resetToken, resetEmail]);

  /**
   * The store is the customer app, and only customer accounts belong in it.
   *
   * The admin and printer apps have always refused a session of the wrong kind;
   * this one accepted whatever came back. A partner or admin signing in here got
   * a board they could use but never save — every `/customer/*` route refuses
   * their token — which read as "saving is broken" rather than "wrong app".
   */
  const isCustomerAccount = (user: any) =>
    String(user?.role || "").toUpperCase() === "CUSTOMER";

  const WRONG_APP_MESSAGE =
    "That's not a customer account. Printers and admins have their own apps — sign in with your customer account to build gang sheets.";

  const handleGoogleCredential = async (response: { credential: string }) => {
    setGoogleLoading(true);
    setError(null);
    try {
      const result = await apiFetch("/auth/google", {
        method: "POST",
        body: JSON.stringify({
          credential: response.credential,
          // Only sent from the sign-up view. The server ignores it for an
          // existing account and requires it when the sign-in creates one.
          ...(requiresLegalAcceptance
            ? {
                legalAcceptance: buildLegalAcceptancePayload(
                  termsAccepted,
                  contentResponsibilityAccepted,
                ),
              }
            : {}),
        }),
      });
      // An account with a passkey has one more step, however it signed in.
      if (needsSecondStep(result)) {
        setSecondStep(result);
        return;
      }
      if (!isCustomerAccount(result.user)) {
        setError(WRONG_APP_MESSAGE);
        return;
      }
      if (result.token) setToken(result.token);
      toast.success(result.isNew ? "Account created with Google!" : "Welcome back!");
      onAuthSuccess(result.user);
      onClose();
    } catch (err: any) {
      // Google is one button for both sign-in and sign-up, so we can't know the
      // account is new until the server tells us. When it does, move the user to
      // the sign-up view where the acknowledgements are shown, rather than
      // leaving them stuck on an error they have no control to resolve.
      if (err?.data?.code === "LEGAL_ACCEPTANCE_REQUIRED") {
        setView("register");
        setShowLegalErrors(true);
        setError(
          "Almost there — please accept the agreements below, then continue with Google again.",
        );
        return;
      }
      setError(err.message || "Google sign-in failed. Please try again.");
    } finally {
      setGoogleLoading(false);
    }
  };
  // Keep ref pointing to the latest handler so GIS never calls a stale closure
  credentialHandlerRef.current = handleGoogleCredential;

  // Initialize GIS and render the official Google button into the container
  useEffect(() => {
    if (!isOpen || !GOOGLE_CLIENT_ID) return;
    const showGoogle = mode === "auth" && !isSubAccountCreation;
    if (!showGoogle) return;

    let timerId: ReturnType<typeof setTimeout>;

    const tryRender = () => {
      const goog = (window as any).google;
      if (!goog?.accounts?.id) {
        timerId = setTimeout(tryRender, 300);
        return;
      }
      const container = googleBtnContainerRef.current;
      if (!container) return;

      goog.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (r: any) => credentialHandlerRef.current?.(r),
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      const w = container.getBoundingClientRect().width || 320;
      goog.accounts.id.renderButton(container, {
        type: "standard",
        shape: "rectangular",
        theme: "outline",
        text: view === "login" ? "signin_with" : "signup_with",
        size: "large",
        width: Math.max(200, Math.min(Math.floor(w), 400)),
        logo_alignment: "left",
      });
    };

    // Delay slightly so the modal DOM is fully laid out before measuring width
    timerId = setTimeout(tryRender, 150);
    return () => clearTimeout(timerId);
  }, [isOpen, mode, isSubAccountCreation, view]);

  // Gate applies to genuine self-registration only. Sub-accounts are created by
  // an account holder who already accepted these terms at their own sign-up,
  // and the server records no separate acceptance for them.
  const requiresLegalAcceptance = mode === "auth" && view === "register" && !isSubAccountCreation;
  const legalComplete = termsAccepted && contentResponsibilityAccepted;
  const legalBlocked = requiresLegalAcceptance && !legalComplete;

  // Both views where a NEW password is being chosen.
  const settingNewPassword = mode === "reset" || (mode === "auth" && view === "register");
  const passwordTooShort =
    settingNewPassword && formData.password.length > 0 && formData.password.length < MIN_PASSWORD_LENGTH;
  const passwordsDiffer =
    settingNewPassword && confirmPassword.length > 0 && formData.password !== confirmPassword;
  const passwordBlocked =
    settingNewPassword &&
    (formData.password.length < MIN_PASSWORD_LENGTH || formData.password !== confirmPassword);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Re-checked here rather than relying on the disabled button alone: form
    // submission can still be triggered by Enter in some browser/AT
    // combinations, and this is the last client-side line before the request.
    if (legalBlocked) {
      setShowLegalErrors(true);
      setError("Please accept both required agreements to create your account.");
      return;
    }

    /*
     * Checked here as well as on the button: Enter still submits a form in some
     * browser and assistive-technology combinations, so the disabled state is
     * not the last line of defence.
     */
    if (settingNewPassword) {
      if (formData.password.length < MIN_PASSWORD_LENGTH) {
        setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        return;
      }
      if (formData.password !== confirmPassword) {
        setError("The two passwords do not match.");
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      if (mode === "forgot") {
        const response = await apiFetch("/auth/forgot-password", {
          method: "POST",
          body: JSON.stringify({ email: formData.email }),
        });

        toast.success(response?.message || "If an account exists, a reset link has been sent");
        setMode("auth");
        setView("login");
        return;
      }

      if (mode === "reset") {
        if (!activeResetToken) {
          setError("Reset token is missing. Please use the link from your email.");
          return;
        }
        const response = await apiFetch("/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({ token: activeResetToken, newPassword: formData.password }),
        });

        toast.success(response?.message || "Password reset successfully");
        setActiveResetToken(null);
        setMode("auth");
        setView("login");
        setFormData({ name: "", email: formData.email, password: "" });
        setConfirmPassword("");
        return;
      }

      let endpoint = view === "login" ? "/auth/login" : "/auth/register";
      if (isSubAccountCreation && view === "register") {
        endpoint = "/auth/sub-accounts";
      }

      const payload = view === "login"
        ? {
            email: formData.email,
            password: formData.password,
            /*
             * Says which of this address's accounts we mean. One email can now
             * hold a customer, a partner and an admin account independently, so
             * signing in without naming a role would be ambiguous for anyone
             * who has more than one.
             */
            role: "CUSTOMER",
          }
        : {
            ...formData,
            /*
             * Upper case, matching the server's enum. This was "customer",
             * which matched nothing — registration fell through to its CUSTOMER
             * default and produced the right account by accident. Now that the
             * role decides which account an address may hold, relying on that
             * accident is not safe.
             */
            role: "CUSTOMER",
            // Sub-account creation goes to a different endpoint that neither
            // expects nor records this.
            ...(requiresLegalAcceptance
              ? {
                  legalAcceptance: buildLegalAcceptancePayload(
                    termsAccepted,
                    contentResponsibilityAccepted,
                  ),
                }
              : {}),
          };

      const response = await apiFetch(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (isSubAccountCreation) {
        toast.success("Account created successfully!");
        onSubAccountCreated?.(response.user);
        onClose();
        return;
      }

      if (needsSecondStep(response)) {
        setSecondStep(response);
        return;
      }

      if (!isCustomerAccount(response.user)) {
        setError(WRONG_APP_MESSAGE);
        return;
      }

      if (response.token) {
        setToken(response.token);
      }

      toast.success(view === "login" ? "Welcome back!" : "Account created successfully!");
      onAuthSuccess(response.user);
      onClose();
    } catch (err: any) {
      const errorMessage = err.message || "An error occurred during authentication";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  if (!isOpen) return null;

  // Do not leave the sign-up modal mounted behind the legal reader. Closing
  // the reader only clears this selection, which restores the same form and
  // preserves everything the customer has already entered.
  if (activeLegalDocument) {
    return (
      <LegalDocumentModal
        doc={activeLegalDocument}
        onClose={() => setActiveLegalDocument(null)}
      />
    );
  }

  /*
   * Requires the client ID. Without it the GIS effect returns early and renders
   * nothing, but this stayed true — leaving a 44px blank where the button should
   * be, with nothing explaining the gap.
   */
  const showGoogleOption = mode === "auth" && !isSubAccountCreation && Boolean(GOOGLE_CLIENT_ID);

  const finishSecondStep = (result: any) => {
    setSecondStep(null);
    if (!isCustomerAccount(result.user)) {
      setError(WRONG_APP_MESSAGE);
      return;
    }
    if (result.token) setToken(result.token);
    if (typeof result.recoveryCodesLeft === "number") {
      toast(`Signed in with a recovery code. ${result.recoveryCodesLeft} left.`, { duration: 8000 });
    } else {
      toast.success("Welcome back!");
    }
    onAuthSuccess(result.user);
    onClose();
  };

  if (secondStep) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-xs p-4">
        <div role="dialog" aria-modal="true" aria-label="Confirm it's you" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
          <SecondStep challenge={secondStep} onSignedIn={finishSecondStep} onCancel={() => setSecondStep(null)} />
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-xs p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-2xl bg-white shadow-2xl p-5"
      >
        {/* Header */}
        <div className="relative mb-4">
          <h2 className="text-xl font-bold text-gray-900">
            {mode === "reset"
              ? "Reset Password"
              : mode === "forgot"
                ? "Forgot Password"
                : isSubAccountCreation
                  ? "Add Sub-Account"
                  : view === "login"
                    ? "Welcome Back"
                    : "Create Account"}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {mode === "reset"
              ? "Set a new password for your account"
              : mode === "forgot"
                ? "We will email you a password reset link"
                : isSubAccountCreation
                  ? "Enter details to create a linked sub-account"
                  : view === "login"
                    ? "Sign in to access your designs"
                    : "Join us to start creating your gang sheets"}
          </p>
          <button
            onClick={onClose}
            className="absolute -right-2 -top-2 p-2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        {/* Google Sign-In */}
        {showGoogleOption && (
          <div className="mb-3">
            {/* Google renders its official button into this container */}
            <div
              className={`w-full flex items-center justify-center min-h-[44px] transition-opacity duration-150 ${
                googleLoading || legalBlocked ? "opacity-40 pointer-events-none" : ""
              }`}
              aria-disabled={legalBlocked}
            >
              <div ref={googleBtnContainerRef} className="w-full" />
            </div>
            {legalBlocked && (
              <p className="mt-1.5 text-center text-[11px] text-gray-500">
                Accept the required agreements below to continue with Google.
              </p>
            )}
            {googleLoading && (
              <div className="w-full flex items-center justify-center gap-2 py-2 text-xs text-gray-500">
                <svg className="animate-spin h-4 w-4 text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Signing in with Google...
              </div>
            )}
            <div className="relative mt-3 mb-0.5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-3 text-xs text-gray-400">or continue with email</span>
              </div>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="p-3 text-xs text-red-500 bg-red-50 border border-red-100 rounded-xl">
              {error}
            </div>
          )}
          {mode === "reset" && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                  New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                    <MdLock size={18} />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    /* Tells a password manager this is a new secret, so it
                       offers to generate and save one. Without it the browser
                       treats the field as unremarkable text. */
                    autoComplete="new-password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-10 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showPassword ? (
                      <MdVisibilityOff size={20} />
                    ) : (
                      <MdVisibility size={20} />
                    )}
                  </button>
                </div>
                {passwordTooShort && (
                  <p className="mt-1 text-[11px] text-red-500">
                    Must be at least {MIN_PASSWORD_LENGTH} characters.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                  Confirm Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                    <MdLock size={18} />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    name="confirmPassword"
                    required
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-10 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  />
                </div>
                {passwordsDiffer && (
                  <p className="mt-1 text-[11px] text-red-500">The two passwords do not match.</p>
                )}
              </div>
            </>
          )}
          {mode === "auth" && view === "register" && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Full Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                  <MdPerson size={18} />
                </div>
                <input
                  type="text"
                  name="name"
                  required
                  autoComplete="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="John Doe"
                  className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
              Email Address
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                <MdEmail size={18} />
              </div>
              <input
                type="email"
                name="email"
                required
                /* "username" is what a password manager pairs with the password
                   field to save a credential. */
                autoComplete="username"
                value={formData.email}
                onChange={handleChange}
                placeholder="name@example.com"
                className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
            </div>
          </div>

          {mode === "auth" && (
            <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
              Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                <MdLock size={18} />
              </div>
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                required
                minLength={view === "register" ? MIN_PASSWORD_LENGTH : undefined}
                /*
                 * "new-password" on sign-up is what makes a browser offer to
                 * generate a strong one; "current-password" on sign-in is what
                 * makes it fill the saved one. Neither was set, so it did
                 * neither — the same gap we closed on the partner form.
                 */
                autoComplete={view === "register" ? "new-password" : "current-password"}
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                className="w-full pl-10 pr-10 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showPassword ? (
                  <MdVisibilityOff size={20} />
                ) : (
                  <MdVisibility size={20} />
                )}
              </button>
            </div>
            {passwordTooShort && (
              <p className="mt-1 text-[11px] text-red-500">
                Must be at least {MIN_PASSWORD_LENGTH} characters.
              </p>
            )}
            </div>
          )}

          {mode === "auth" && view === "register" && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Confirm Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                  <MdLock size={18} />
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  name="confirmPassword"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
              </div>
              {passwordsDiffer && (
                <p className="mt-1 text-[11px] text-red-500">The two passwords do not match.</p>
              )}
            </div>
          )}

          {view === "login" && mode === "auth" && (
            <div className="flex justify-end">
              <button
                type="button"
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
                onClick={() => setMode("forgot")}
              >
                Forgot password?
              </button>
            </div>
          )}

          {requiresLegalAcceptance && (
            <LegalAcceptance
              termsAccepted={termsAccepted}
              contentResponsibilityAccepted={contentResponsibilityAccepted}
              onTermsChange={(v) => {
                setTermsAccepted(v);
                if (v) setError(null);
              }}
              onContentResponsibilityChange={(v) => {
                setContentResponsibilityAccepted(v);
                if (v) setError(null);
              }}
              showErrors={showLegalErrors}
              disabled={loading || googleLoading}
              onOpenDocument={setActiveLegalDocument}
            />
          )}

          <button
            type="submit"
            disabled={loading || legalBlocked || passwordBlocked}
            // Kept focusable and announced rather than hidden: a disabled
            // control the user cannot reach gives no clue why they are stuck.
            aria-disabled={loading || legalBlocked || passwordBlocked}
            aria-describedby={legalBlocked ? "submit-blocked-reason" : undefined}
            className={`w-full py-2.5 bg-slate-900 text-white rounded-xl font-semibold text-sm transform active:scale-[0.98] transition-all shadow-lg shadow-slate-900/10 mt-1 ${
              loading || legalBlocked || passwordBlocked ? "opacity-50 cursor-not-allowed" : "hover:bg-slate-800"
            }`}
          >
            {loading
              ? "Please wait..."
              : mode === "forgot"
                ? "Send Reset Link"
                : mode === "reset"
                  ? "Reset Password"
                  : view === "login"
                    ? "Sign In"
                    : "Create Account"}
          </button>
          {legalBlocked && (
            <p id="submit-blocked-reason" className="text-center text-[11px] text-gray-500">
              Accept both agreements above to create your account.
            </p>
          )}
        </form>

        {/* Footer */}
        {mode !== "auth" ? (
          <div className="mt-5 pt-4 border-t border-gray-100 text-center">
            <button
              type="button"
              onClick={() => {
                setMode("auth");
                setView("login");
                setError(null);
                setFormData({ name: "", email: "", password: "" });
                setConfirmPassword("");
              }}
              className="text-sm font-bold text-blue-600 hover:text-blue-700"
            >
              Back to Sign In
            </button>
          </div>
        ) : !isSubAccountCreation && (
          <div className="mt-5 pt-4 border-t border-gray-100 text-center">
            <p className="text-sm text-gray-600">
              {view === "login"
                ? "Don't have an account?"
                : "Already have an account?"}{" "}
              <button
                onClick={() => {
                  // Clear validation state on the way across; the ticks
                  // themselves persist so a user who already read the terms
                  // isn't made to re-tick after glancing at the sign-in form.
                  setShowLegalErrors(false);
                  setError(null);
                  setView(view === "login" ? "register" : "login");
                  // Cleared on the way across: a password typed under one set of
                  // rules should not sit in a field governed by another.
                  setFormData((f) => ({ ...f, password: "" }));
                  setConfirmPassword("");
                  setError(null);
                }}
                className="font-bold text-blue-600 hover:text-blue-700"
              >
                {view === "login" ? "Sign Up" : "Log In"}
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
