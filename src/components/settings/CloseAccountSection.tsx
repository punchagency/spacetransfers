import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { apiFetch } from "../../utils/api";
import { clearAuth } from "../../utils/auth";

interface Closure {
  canClose: boolean;
  blocker: string | null;
}

/** Closing the partner's own account, once no job, report or payment is outstanding. */
export default function CloseAccountSection() {
  const navigate = useNavigate();
  const [closure, setClosure] = useState<Closure | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoadError(null);
    apiFetch("/printer/account/close")
      .then(setClosure)
      .catch((err: any) => setLoadError(err?.message || "We couldn't check whether your account can be closed."));
  };
  useEffect(load, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  const close = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!password) return setError("Enter your current password.");
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/printer/account/close", { method: "POST", body: JSON.stringify({ password }) });
      toast.success("Your account has been closed.", { duration: 6000 });
      clearAuth();
      navigate("/auth", { replace: true });
    } catch (err: any) {
      setError(err?.message || "Your account couldn't be closed. Please try again.");
      // Something may have changed since the page loaded, such as a new job.
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" data-close-account>
      <div>
        <h3 className="text-base font-bold text-gray-900">Close your account</h3>
        <p className="mt-1 text-sm text-gray-500">
          Stop working with Space Transfers. You won't receive jobs or be able to sign in. You can re-apply later with the same email.
        </p>
      </div>

      {loadError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-red-600">{loadError}</p>
          <button onClick={load} className="text-sm font-semibold text-blue-600 hover:underline">
            Try again
          </button>
        </div>
      ) : !closure ? (
        <p className="text-sm text-gray-500">Checking your account…</p>
      ) : (
        <>
          {closure.blocker && (
            <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {closure.blocker}
            </p>
          )}
          <button
            onClick={() => {
              setPassword("");
              setError(null);
              setOpen(true);
            }}
            disabled={!closure.canClose}
            className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-500 disabled:hover:bg-transparent"
          >
            Close my account
          </button>
        </>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            if (!busy) setOpen(false);
          }}
        >
          <form
            onSubmit={close}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-account-title"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
          >
            <h3 id="close-account-title" className="text-lg font-bold text-gray-900">
              Close your partner account?
            </h3>
            <div className="mt-2 space-y-2 text-sm text-gray-600">
              <p>This takes effect straight away and signs you out everywhere. These are removed:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>your password, passkeys and recovery codes</li>
                <li>your phone number, website, logo and certifications</li>
                <li>your notifications and sign-in history</li>
              </ul>
              <p>
                Your business name, email, address, completed jobs and payouts are kept, because we need them for accounting and tax.
              </p>
            </div>
            <label htmlFor="close-account-password" className="mt-4 block text-sm font-medium text-gray-700">
              Current password
            </label>
            <input
              id="close-account-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            />
            {error && (
              <p role="alert" className="mt-2 text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50"
              >
                Keep my account
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {busy ? "Closing…" : "Close my account"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
