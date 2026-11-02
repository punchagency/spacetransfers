import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { apiFetch } from "../utils/api";

/**
 * Where the reset link in an admin's email lands. The new password signs out
 * every device; the passkey is still asked for at the next sign-in.
 */
export const ResetPasswordPage = () => {
  const [params] = useSearchParams();
  const token = params.get("resetToken") || "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, newPassword: password }) });
      toast.success("Password changed. Sign in with it and your passkey.", { duration: 7000 });
      navigate("/auth", { replace: true });
    } catch (err: any) {
      setError(err?.message || "The password couldn't be changed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold text-slate-900">Choose a new password</h1>
        {!token ? (
          <>
            <p className="mt-2 text-sm text-slate-500">This link is incomplete. Request a new one from the sign-in page.</p>
            <Link to="/auth" className="mt-6 inline-block text-sm font-semibold text-blue-600 hover:underline">
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <p className="text-sm text-slate-500">Every device signed in to this account will be signed out.</p>
            <div className="space-y-1.5">
              <label htmlFor="new-password" className="block text-xs font-bold text-slate-900">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                className="w-full rounded-lg border border-slate-200 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="confirm-password" className="block text-xs font-bold text-slate-900">
                Type it again
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => { setConfirm(e.target.value); setError(null); }}
                className="w-full rounded-lg border border-slate-200 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
                {error}{" "}
                {/expired|invalid/i.test(error) && (
                  <Link to="/auth?forgot=1" className="font-semibold underline">
                    Request a new link
                  </Link>
                )}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-[#2563EB] px-4 py-3.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-400"
            >
              {busy ? "Saving…" : "Change password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
