import { useState } from "react";
import toast from "react-hot-toast";
import { apiFetch } from "../../lib/utils/api";

interface YourDataProps {
  email: string;
  /** Accounts that sign in with Google confirm with their email; the server asks for a password if one exists. */
  signsInWithGoogle: boolean;
  /** A linked account is closed by its main account holder, not from here. */
  isLinkedAccount?: boolean;
  /** Called once the account is closed, to sign out. */
  onClosed: () => void;
}

/** A copy of everything held about the account, and closing it. */
export default function YourData({ email, signsInWithGoogle, isLinkedAccount = false, onClosed }: YourDataProps) {
  const [downloading, setDownloading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [askPassword, setAskPassword] = useState(!signsInWithGoogle);
  const [password, setPassword] = useState("");
  const [typedEmail, setTypedEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const data = await apiFetch("/customer/account/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `space-transfers-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Your data has been downloaded.");
    } catch (err: any) {
      toast.error(err?.message || "Your data couldn't be downloaded. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const closeAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (askPassword && !password) return setError("Enter your current password.");
    if (!askPassword && typedEmail.trim().toLowerCase() !== email.toLowerCase()) return setError("Type your email address exactly to confirm.");
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/customer/account/delete", { method: "POST", body: JSON.stringify(askPassword ? { password } : { email: typedEmail.trim() }) });
      toast.success("Your account has been closed.", { duration: 6000 });
      setClosing(false);
      onClosed();
    } catch (err: any) {
      if (/current password/i.test(String(err?.message))) setAskPassword(true);
      setError(err?.message || "Your account couldn't be closed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" data-your-data>
      <div>
        <h3 className="text-base font-bold text-gray-900">Your data</h3>
        <p className="mt-1 text-sm text-gray-500">
          {isLinkedAccount
            ? "Download a copy of everything we hold about this account. It's a linked account, so the main account holder can remove it."
            : "Download a copy of everything we hold about your account, or close it."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => void download()}
          disabled={downloading}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          {downloading ? "Preparing…" : "Download my data"}
        </button>
        {!isLinkedAccount && (
          <button
            onClick={() => {
              setError(null);
              setClosing(true);
            }}
            className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Close my account
          </button>
        )}
      </div>

      {closing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={closeAccount} role="dialog" aria-modal="true" aria-label="Close your account" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">Close your account?</h3>
            <div className="mt-2 space-y-2 text-sm text-gray-600">
              <p>This can't be undone. These are removed:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>your sign-in, saved sheets and cart</li>
                <li>artwork you uploaded that isn't part of an order</li>
                <li>your sign-in history and passkeys</li>
              </ul>
              <p>Past orders are kept, with the details they were shipped with, because we need them for our records. You can download a copy of your data first.</p>
            </div>
            {askPassword ? (
              <>
                <label htmlFor="close-account-password" className="mt-4 block text-sm font-medium text-gray-700">
                  Current password
                </label>
                <input
                  id="close-account-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
                />
              </>
            ) : (
              <>
                <label htmlFor="close-account-email" className="mt-4 block text-sm font-medium text-gray-700">
                  Type <span className="font-semibold">{email}</span> to confirm
                </label>
                <input
                  id="close-account-email"
                  type="email"
                  autoComplete="off"
                  value={typedEmail}
                  onChange={(e) => {
                    setTypedEmail(e.target.value);
                    setError(null);
                  }}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
                />
              </>
            )}
            {error && (
              <p role="alert" className="mt-2 text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row">
              <button type="button" onClick={() => setClosing(false)} disabled={busy} className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50">
                Keep my account
              </button>
              <button type="submit" disabled={busy} className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                {busy ? "Closing…" : "Close account"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
