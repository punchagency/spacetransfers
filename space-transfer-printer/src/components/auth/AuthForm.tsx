import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { setAuth } from "../../utils/auth";
import { needsSecondStep, type SecondStepChallenge } from "../../utils/passkeys";
import { SecondStep } from "../security/SecondStep";
import { isValidPhone } from "../../utils/validators";
import { HiOutlineLocationMarker } from "react-icons/hi";
import {
  HiOutlineMail,
  HiOutlineLockClosed,
  HiOutlineEye,
  HiOutlineEyeOff,
} from "react-icons/hi";
import { BsArrowRight } from "react-icons/bs";
import type { AuthFormProps } from "../../types/auth";
import { apiFetch, getApiBaseUrl } from "../../utils/api";
import { buildLegalAcceptancePayload, fetchLegalVersions, type LegalReadTimes } from "../../utils/legal";
import { LegalAgreements } from "./LegalAgreements";
import toast from "react-hot-toast";
import { SpaceLoader } from "../common/SpaceLoader";

// ---------------------------------------------------------------------------
// Static state → region mapping (mirrors server-side getRegionFromState).
// Used for instant client-side region feedback as the user types — no API
// round-trip needed for this.
// ---------------------------------------------------------------------------
const REGION_BY_STATE: Record<string, string> = {
  WA:"West",OR:"West",CA:"West",NV:"West",ID:"West",MT:"West",WY:"West",
  UT:"West",AZ:"West",NM:"West",CO:"West",AK:"West",HI:"West",
  ND:"Midwest",SD:"Midwest",NE:"Midwest",KS:"Midwest",MN:"Midwest",
  IA:"Midwest",MO:"Midwest",WI:"Midwest",IL:"Midwest",MI:"Midwest",
  IN:"Midwest",OH:"Midwest",
  TX:"South",OK:"South",AR:"South",LA:"South",MS:"South",AL:"South",
  TN:"South",KY:"South",WV:"South",VA:"South",NC:"South",SC:"South",
  GA:"South",FL:"South",MD:"South",DC:"South",DE:"South",
  PA:"Northeast",NY:"Northeast",VT:"Northeast",ME:"Northeast",
  NH:"Northeast",MA:"Northeast",RI:"Northeast",CT:"Northeast",NJ:"Northeast",
};

/** Matches the server's minimum, so the form and the API agree. */
const MIN_PASSWORD_LENGTH = 8;

const REGION_COLORS: Record<string, string> = {
  West:      "bg-blue-50 text-blue-700 border-blue-200",
  Midwest:   "bg-amber-50 text-amber-700 border-amber-200",
  South:     "bg-green-50 text-green-700 border-green-200",
  Northeast: "bg-purple-50 text-purple-700 border-purple-200",
};

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export const AuthForm = ({ isSignIn, setIsSignIn }: AuthFormProps) => {
  const [showPassword, setShowPassword]   = useState(false);
  const [email, setEmail]                 = useState("");
  const [password, setPassword]           = useState("");
  const [fullName, setFullName]           = useState("");
  const [companyName, setCompanyName]     = useState("");
  const [phone, setPhone]                 = useState("");
  const [website, setWebsite]             = useState("");
  const [street, setStreet]               = useState("");
  const [city, setCity]                   = useState("");
  const [stateProv, setStateProv]         = useState("");
  const [postalCode, setPostalCode]       = useState("");
  const [country, setCountry]             = useState("United States");
  const [termsAccepted, setTermsAccepted] = useState(false);
  // Second acknowledgement required by the server alongside the terms. Kept
  // separate because they are distinct legal statements.
  const [contentResponsibilityAccepted, setContentResponsibilityAccepted] =
    useState(false);
  // When each document was read to the end, which its box needs before it can be ticked.
  const [legalReadAt, setLegalReadAt] = useState<LegalReadTimes>({});
  const [isLoading, setIsLoading]         = useState(false);
  const [sendingReset, setSendingReset]   = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");

  // Region detection state
  const [detectedRegion, setDetectedRegion]   = useState<string | null>(null);
  const [regionValidated, setRegionValidated] = useState(false); // true = geocode confirmed
  const [nonUSWarning, setNonUSWarning]       = useState(false);
  const [regionLoading, setRegionLoading]     = useState(false);
  const geocodeAbortRef = useRef<AbortController | null>(null);

  const navigate = useNavigate();
  const location = useLocation();
  // Page the guard intercepted before sending us here, so login lands the user
  // exactly where they were headed rather than always on the dashboard.
  const redirectTo =
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ||
    "/dashboard";

  // Debounce address fields so we don't fire on every keystroke
  const debouncedState    = useDebounce(stateProv, 400);
  const debouncedPostal   = useDebounce(postalCode, 600);
  const debouncedStreet   = useDebounce(street, 700);
  const debouncedCity     = useDebounce(city, 700);
  const debouncedCountry  = useDebounce(country, 400);

  // ── Non-US country check ──────────────────────────────────────────────────
  useEffect(() => {
    if (!debouncedCountry) { setNonUSWarning(false); return; }
    const c = debouncedCountry.trim().toLowerCase().replace(/\./g, "");
    const isUS = ["us","usa","united states","united states of america"].includes(c);
    setNonUSWarning(!isUS);
    if (!isUS) { setDetectedRegion(null); setRegionValidated(false); }
  }, [debouncedCountry]);

  // ── Region detection ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isSignIn || nonUSWarning) return;

    // Step 1: instant state-code feedback
    const stateUpper = debouncedState.trim().toUpperCase();
    const quickRegion = stateUpper.length === 2 ? REGION_BY_STATE[stateUpper] ?? null : null;
    if (quickRegion) {
      setDetectedRegion(quickRegion);
    }

    // Step 2: debounced geocode call for accuracy + validation
    // Only call when we have at least a state + postal code
    if (!debouncedState || !debouncedPostal) return;

    geocodeAbortRef.current?.abort();
    const controller = new AbortController();
    geocodeAbortRef.current = controller;

    setRegionLoading(true);
    setRegionValidated(false);

    fetch(`${getApiBaseUrl()}/geocode/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        street: debouncedStreet || undefined,
        city:   debouncedCity   || undefined,
        state:  debouncedState,
        zip:    debouncedPostal,
        country: debouncedCountry || "United States",
      }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.region) {
          setDetectedRegion(data.region);
          setRegionValidated(data.valid === true);
        }
      })
      .catch(() => { /* aborted or network error — keep quick region */ })
      .finally(() => setRegionLoading(false));

    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedState, debouncedPostal, debouncedStreet, debouncedCity, isSignIn, nonUSWarning]);

  const resetForm = () => {
    setFullName(""); setCompanyName(""); setPhone(""); setWebsite("");
    setStreet(""); setCity(""); setStateProv(""); setPostalCode("");
    setCountry("United States"); setEmail(""); setPassword(""); setConfirmPassword("");
    setTermsAccepted(false); setLegalReadAt({}); setDetectedRegion(null);
    setRegionValidated(false); setNonUSWarning(false);
    /*
     * Cleared with the rest of the form.
     *
     * Every mode toggle called `setTermsAccepted(false)` and `resetForm()` but
     * nothing reset this one, so ticking it, switching to sign-in and switching
     * back left it still ticked on a blank form. Consent that survives a reset
     * is precisely what the acceptance record exists to rule out — the user
     * would not have seen the statement they were recorded as agreeing to.
     */
    setContentResponsibilityAccepted(false);
  };

  /**
   * Starts a password reset.
   *
   * There was no way to reach this from the printer app at all: the endpoint and
   * the set-password screen both existed, but nothing linked to them, so a
   * partner who forgot their password had no route back into their account.
   */
  const handleForgotPassword = async () => {
    const address = email.trim();
    if (!address) {
      toast.error("Enter your email address first, then choose 'Forgot password'.");
      return;
    }

    setSendingReset(true);
    try {
      await apiFetch("/auth/forgot-password", {
        method: "POST",
        // Scoped, so a partner's reset never mints a token for their admin or
        // customer account instead.
        body: JSON.stringify({ email: address, role: "PRINTER" }),
      });
      /*
       * Deliberately the same message whether or not the address is registered.
       * The server answers identically for both, and saying "no such account"
       * here would turn this form into a way to test which emails exist.
       */
      toast.success("If that email has an account, a reset link is on its way.");
    } catch (error: any) {
      toast.error(error?.message || "Could not start a password reset");
    } finally {
      setSendingReset(false);
    }
  };

  const [secondStep, setSecondStep] = useState<SecondStepChallenge | null>(null);

  const finishSignIn = (response: any) => {
    if (response?.user?.role !== "PRINTER") {
      toast.error("Access denied. Printer account required.");
      setSecondStep(null);
      return;
    }
    // setAuth persists the session AND notifies the route guard, so the
    // protected area unlocks without any onLogin prop plumbing.
    setAuth(response.token, response.user);
    if (typeof response.recoveryCodesLeft === "number") {
      toast(`Signed in with a recovery code. ${response.recoveryCodesLeft} left.`, { duration: 8000 });
    } else {
      toast.success("Welcome back!");
    }
    // Return the user to the page they originally asked for (captured by
    // ProtectedRoute), falling back to the dashboard on a direct login.
    navigate(redirectTo, { replace: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      if (isSignIn) {
        const response = await apiFetch("/auth/login", {
          method: "POST",
          // Says which of this address's accounts we mean: one email can now
          // hold a partner, a customer and an admin account independently.
          body: JSON.stringify({ email, password, role: "PRINTER" }),
        });
        // The password was right; an account with a passkey has one more step.
        if (needsSecondStep(response)) {
          setSecondStep(response);
          return;
        }
        finishSignIn(response);
      } else {
        if (!fullName || !companyName || !email || !password || !phone || !street || !city || !stateProv || !postalCode || !country) {
          toast.error("Please fill in all fields");
          setIsLoading(false);
          return;
        }
        /*
         * Shape checked, not just presence — mirrors `isValidPhone` on the
         * server. Only truthiness was ever tested here, so "1" or "abc" passed
         * straight through and became a print partner's stored contact
         * number, which is the number an admin or a customer calls when a job
         * goes wrong.
         */
        if (!isValidPhone(phone)) {
          toast.error("Enter a valid phone number.");
          setIsLoading(false);
          return;
        }
        if (nonUSWarning) {
          toast.error("Only US addresses are supported at this time.");
          setIsLoading(false);
          return;
        }
        /*
         * Checked here rather than left to the server, which never sees the
         * second field: a typo in a password nobody can read back would create
         * an account whose owner cannot sign into it, and — until SendGrid is
         * configured — cannot recover it either.
         */
        if (password.length < MIN_PASSWORD_LENGTH) {
          toast.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
          setIsLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          toast.error("Both passwords must match.");
          setIsLoading(false);
          return;
        }
        if (!termsAccepted || !contentResponsibilityAccepted) {
          toast.error(
            "Please accept the Terms of Service, Privacy Policy, and content responsibility acknowledgement.",
          );
          setIsLoading(false);
          return;
        }

        // Region is auto-assigned server-side from the address — no need to send
        await apiFetch("/auth/register", {
          method: "POST",
          body: JSON.stringify({
            name: fullName,
            companyName,
            email,
            password,
            phone,
            website: website || undefined,
            address: { street, city, state: stateProv, postalCode, country },
            role: "PRINTER",
            // Required by the server, which refuses to create any account
            // without it. Omitting this block made printer signup fail with
            // "You must accept the Terms of Service…" even when the box was
            // ticked: the consent never left the browser.
            legalAcceptance: buildLegalAcceptancePayload(
              termsAccepted,
              contentResponsibilityAccepted,
              await fetchLegalVersions(),
              legalReadAt,
            ),
          }),
        });

        toast.success("Registration successful! Your account is pending approval.");
        setIsSignIn(true);
      }
    } catch (error: any) {
      toast.error(error.message || "Authentication failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full lg:w-1/2 h-full overflow-y-auto flex flex-col items-center py-8 lg:py-16 px-8 lg:px-16 bg-[#F8FAFC]">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center">
            <span className="text-2xl font-bold text-slate-900 tracking-tight">spacetransfers</span>
            <div className="relative">
              <img src="/space.svg" alt="space" className="w-[74px] h-[74px] -scale-x-100" />
            </div>
          </div>
        </div>

        <div className="text-left space-y-2">
          <h2 className="text-3xl font-bold text-slate-900">
            {isSignIn ? "Welcome Back" : "Create Account"}
          </h2>
          <p className="text-slate-500 text-sm">
            {isSignIn ? "Sign in to access your partner dashboard" : "Join our network of DTF fulfillment partners"}
          </p>
        </div>

        {/* Toggle */}
        <div className="bg-gray-100 p-1 rounded-xl flex items-center">
          <button
            onClick={() => { setIsSignIn(true); setTermsAccepted(false); setLegalReadAt({}); resetForm(); }}
            className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
              isSignIn ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-800"
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => { setIsSignIn(false); setTermsAccepted(false); setLegalReadAt({}); resetForm(); }}
            className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
              !isSignIn ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-800"
            }`}
          >
            Sign Up
          </button>
        </div>

        {secondStep && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <SecondStep
              challenge={secondStep}
              onSignedIn={finishSignIn}
              onCancel={() => {
                setSecondStep(null);
                setPassword("");
              }}
            />
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className={`space-y-5 text-left ${secondStep ? "hidden" : ""}`}>
          {!isSignIn && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 ml-1 block">Full Name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Davidson"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 ml-1 block">Business Name</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Premium DTF Solutions"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 ml-1 block">Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 123-4567"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 ml-1 block">Website (optional)</label>
                <input
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
                />
              </div>

              {/* Address section */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 ml-1 block">Street Address</label>
                <input
                  type="text"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  placeholder="123 Main St"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 ml-1 block">City</label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Los Angeles"
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 ml-1 block">State</label>
                  <input
                    type="text"
                    value={stateProv}
                    onChange={(e) => setStateProv(e.target.value)}
                    placeholder="CA"
                    maxLength={2}
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 ml-1 block">Postal Code</label>
                  <input
                    type="text"
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    placeholder="90001"
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 ml-1 block">Country</label>
                  <input
                    type="text"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    placeholder="United States"
                    className={`w-full px-4 py-3 bg-white border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400 ${
                      nonUSWarning ? "border-red-400" : "border-slate-200"
                    }`}
                  />
                </div>
              </div>

              {/* Non-US warning */}
              {nonUSWarning && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  Only US addresses are supported at this time.
                </p>
              )}

              {/* Auto-detected region badge */}
              {!nonUSWarning && detectedRegion && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${REGION_COLORS[detectedRegion] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}>
                  <HiOutlineLocationMarker className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>
                    {regionLoading
                      ? "Verifying region…"
                      : regionValidated
                        ? `Service Region: ${detectedRegion} — address verified`
                        : `Service Region: ${detectedRegion} (auto-assigned from state)`}
                  </span>
                </div>
              )}
            </>
          )}

          {/* Email */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 ml-1 block">Email Address</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <HiOutlineMail className="text-slate-400 text-lg" />
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="demo@spacetransfers.com"
                className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
              />
            </div>
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 ml-1 block">Password</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <HiOutlineLockClosed className="text-slate-400 text-lg" />
              </div>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                /*
                 * Tells the browser which field this is, which is what makes it
                 * offer a generated password on sign-up and the saved one on
                 * sign-in. Without it the confirm field — which does declare
                 * itself — got the suggestion and the real password field did
                 * not, so the offer appeared on the wrong box.
                 */
                autoComplete={isSignIn ? "current-password" : "new-password"}
                placeholder="Your password"
                className="w-full pl-11 pr-11 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-500 hover:text-slate-700 cursor-pointer"
              >
                {showPassword ? <HiOutlineEyeOff className="text-lg" /> : <HiOutlineEye className="text-lg" />}
              </button>
            </div>
            {!isSignIn && password.length > 0 && password.length < MIN_PASSWORD_LENGTH && (
              <p className="text-xs text-red-600 ml-1">
                Must be at least {MIN_PASSWORD_LENGTH} characters.
              </p>
            )}
            {isSignIn && (
              <div className="flex justify-end pt-0.5">
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={sendingReset}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sendingReset ? "Sending…" : "Forgot password?"}
                </button>
              </div>
            )}
          </div>

          {/* Confirm password — sign-up only. */}
          {!isSignIn && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 ml-1 block">Confirm password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <HiOutlineLockClosed className="text-slate-400 text-lg" />
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Type it again"
                  className="w-full pl-11 pr-11 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
                />
              </div>
              {confirmPassword.length > 0 && password !== confirmPassword && (
                <p className="text-xs text-red-600 ml-1">Both passwords must match.</p>
              )}
            </div>
          )}

          {/* Legal acknowledgements. Both are required by the server. */}
          {!isSignIn && (
            <LegalAgreements
              termsAccepted={termsAccepted}
              onTermsChange={setTermsAccepted}
              contentAccepted={contentResponsibilityAccepted}
              onContentChange={setContentResponsibilityAccepted}
              readAt={legalReadAt}
              onRead={(key) => setLegalReadAt((r) => (r[key] ? r : { ...r, [key]: new Date().toISOString() }))}
              idPrefix="signup"
            />
          )}

          {/* Submit */}
          <button
            type="submit"
            /*
             * Sign-up also waits on a password that is long enough and typed
             * the same twice. The submit handler re-checks both — this only
             * stops the button looking available before it can succeed.
             */
            disabled={
              isLoading ||
              (!isSignIn &&
                !(
                  termsAccepted &&
                  contentResponsibilityAccepted &&
                  password.length >= MIN_PASSWORD_LENGTH &&
                  password === confirmPassword
                ))
            }
            className={`w-full py-3 px-4 rounded-xl text-white font-semibold shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] ${
              isLoading ||
              (!isSignIn &&
                !(
                  termsAccepted &&
                  contentResponsibilityAccepted &&
                  password.length >= MIN_PASSWORD_LENGTH &&
                  password === confirmPassword
                ))
                ? "bg-blue-400 cursor-not-allowed opacity-70"
                : "bg-[#3B82F6] hover:bg-blue-600"
            }`}
          >
            {isLoading ? <SpaceLoader size={18} layout="inline" /> : null}
            <span>{isLoading ? "Please Wait..." : isSignIn ? "Sign In" : "Create Account"}</span>
            {!isLoading && <BsArrowRight className="text-lg" />}
          </button>
        </form>

        <div className="text-center">
          <p className="text-sm text-slate-500">
            {isSignIn ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              onClick={() => { setIsSignIn(!isSignIn); setTermsAccepted(false); setLegalReadAt({}); resetForm(); }}
              className="text-blue-600 font-medium hover:underline"
            >
              {isSignIn ? "Sign up" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};
