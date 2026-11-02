import { useEffect, useRef, useState } from "react";
import { getToken } from "../utils/auth";
import { useSearchParams, useNavigate } from "react-router-dom";
import { FiCheckCircle, FiAlertCircle, FiLoader } from "react-icons/fi";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

type State = "verifying" | "success" | "error";

const VerifyEmailPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<State>("verifying");
  const [message, setMessage] = useState("");
  const [countdown, setCountdown] = useState(5);

  // Guard against React StrictMode double-invocation: the ref persists through
  // the simulated unmount/remount so the fetch fires exactly once.
  const fetchedRef = useRef(false);

  useEffect(() => {
    // The ref persists across StrictMode's simulated unmount/remount on the same
    // component instance, so this guard fires the fetch exactly once.
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const token = searchParams.get("token");
    if (!token) {
      setState("error");
      setMessage("Missing verification token.");
      return;
    }

    // No AbortController here — aborting the request on StrictMode cleanup would
    // cancel the only legitimate fetch and leave the UI stuck on "Verifying…".
    fetch(`${API_BASE}/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setState("success");
          setMessage(data.message || "Email verified successfully.");
        } else {
          setState("error");
          setMessage(data.message || "Invalid or expired verification link.");
        }
      })
      .catch(() => {
        setState("error");
        setMessage("Could not reach the server. Please try again.");
      });
  }, []);

  // Auto-redirect to profile on success
  useEffect(() => {
    if (state !== "success") return;
    if (countdown <= 0) {
      const isLoggedIn = Boolean(getToken());
      navigate(isLoggedIn ? "/profile?emailVerified=1" : "/auth", { replace: true });
      return;
    }
    const id = setTimeout(() => setCountdown((c) => c - 1), 1_000);
    return () => clearTimeout(id);
  }, [state, countdown, navigate]);

  const goNow = () => {
    const isLoggedIn = Boolean(getToken());
    navigate(isLoggedIn ? "/profile?emailVerified=1" : "/auth", { replace: true });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 max-w-md w-full text-center">
        <div className="mb-6 flex justify-center">
          {state === "verifying" && (
            <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center">
              <FiLoader className="w-7 h-7 text-blue-600 animate-spin" />
            </div>
          )}
          {state === "success" && (
            <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center">
              <FiCheckCircle className="w-7 h-7 text-emerald-600" />
            </div>
          )}
          {state === "error" && (
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
              <FiAlertCircle className="w-7 h-7 text-red-600" />
            </div>
          )}
        </div>

        <h1 className="text-xl font-bold text-gray-900 mb-2">
          {state === "verifying" && "Verifying your email…"}
          {state === "success" && "Email Verified!"}
          {state === "error" && "Verification Failed"}
        </h1>

        <p className="text-sm text-gray-500 mb-2">
          {state === "verifying" ? "Please wait a moment." : message}
        </p>

        {state === "success" && (
          <p className="text-xs text-gray-500 mb-6">
            Redirecting to your profile in {countdown}s…
          </p>
        )}

        {state === "error" && <div className="mb-6" />}

        {state !== "verifying" && (
          <button
            onClick={goNow}
            className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
          >
            {state === "success" ? "Go to Profile Now" : "Back to Dashboard"}
          </button>
        )}
      </div>
    </div>
  );
};

export default VerifyEmailPage;
