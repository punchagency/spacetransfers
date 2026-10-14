import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  addPasskey,
  fetchPasskeys,
  passkeyErrorMessage,
  passkeysSupported,
  recoveryCodesFile,
  regenerateRecoveryCodes,
  removePasskey,
  suggestPasskeyName,
  type PasskeySummary,
} from "../../utils/passkeys";

interface PasskeyManagerProps {
  /** The account's email, for the heading of the saved recovery codes. */
  account: string;
  /** False for an account that signs in with Google and has no password to confirm with. */
  hasPassword?: boolean;
  /** Called whenever the list changes, with whether the account now has a passkey. */
  onChanged?: (hasPasskey: boolean) => void;
}

const day = (value: string | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "never";

/** Shown once: the codes, a way to keep them, and an acknowledgement before they go. */
function RecoveryCodesDialog({ codes, account, onDone }: { codes: string[]; account: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = recoveryCodesFile(codes, account);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Recovery codes copied");
    } catch {
      toast.error("Couldn't copy. Select the codes and copy them yourself.");
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "space-transfers-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" aria-label="Save your recovery codes" className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-bold text-gray-900">Save your recovery codes</h3>
        <p className="mt-1 text-sm text-gray-600">
          If you lose the device your passkey is on, one of these signs you in. Each works once. This is the only time
          they are shown, so keep them somewhere safe that isn't this device.
        </p>
        <ul className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-4 font-mono text-sm tracking-wider text-gray-900" data-recovery-codes>
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <button onClick={() => void copy()} className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Copy
          </button>
          <button onClick={download} className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Download
          </button>
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>I've saved these codes somewhere safe.</span>
        </label>
        <button
          onClick={onDone}
          disabled={!saved}
          className="mt-4 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/** Asks for the password before something that weakens the account. */
function ConfirmWithPassword({
  title,
  body,
  confirmLabel,
  needsPassword,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  needsPassword: boolean;
  onConfirm: (password: string) => Promise<void>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An account that signs in with Google may still have a password; the server says so.
  const [askPassword, setAskPassword] = useState(needsPassword);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (askPassword && !password) return setError("Enter your current password to confirm.");
    setBusy(true);
    setError(null);
    try {
      await onConfirm(password);
      onClose();
    } catch (err: any) {
      if (/current password/i.test(String(err?.message))) setAskPassword(true);
      setError(err?.message || "That didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-bold text-gray-900">{title}</h3>
        <p className="mt-1 text-sm text-gray-600">{body}</p>
        {askPassword && (
          <>
            <label htmlFor="passkey-confirm-password" className="mt-4 block text-sm font-medium text-gray-700">
              Current password
            </label>
            <input
              id="passkey-confirm-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null); }}
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
          <button type="button" onClick={onClose} disabled={busy} className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

/** An account's passkeys: add one, remove one, and renew the recovery codes. */
export function PasskeyManager({ account, hasPassword = true, onChanged }: PasskeyManagerProps) {
  const [summary, setSummary] = useState<PasskeySummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState(() => suggestPasskeyName(typeof navigator === "undefined" ? "" : navigator.userAgent));
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [renewing, setRenewing] = useState(false);
  const supported = passkeysSupported();

  const apply = (next: PasskeySummary) => {
    setSummary(next);
    // New codes are shown once. Whoever is listening is told only after they
    // have been acknowledged, so nothing can move on and take the codes with it.
    if (next.recoveryCodes?.length) setCodes(next.recoveryCodes);
    else onChanged?.(next.passkeys.length > 0);
  };

  useEffect(() => {
    fetchPasskeys()
      .then(setSummary)
      .catch((err) => setLoadError(err?.message || "Your passkeys couldn't be loaded."));
  }, []);

  const add = async () => {
    if (adding) return;
    setAdding(true);
    setError(null);
    try {
      apply(await addPasskey(name.trim()));
      toast.success("Passkey added");
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setAdding(false);
    }
  };

  if (loadError) return <p className="text-sm text-red-600">{loadError}</p>;
  if (!summary) return <p className="text-sm text-gray-500">Loading your passkeys…</p>;

  const count = summary.passkeys.length;

  return (
    <div className="space-y-4" data-passkey-manager>
      <div>
        <h3 className="text-base font-bold text-gray-900">Passkeys</h3>
        <p className="mt-1 text-sm text-gray-500">
          A passkey is a second step after your password: your fingerprint, face or device PIN, which only works on
          this site and can't be phished or guessed.
          {summary.required ? " Admin accounts must have one." : count === 0 ? " It's optional, and we recommend it." : ""}
        </p>
      </div>

      {count > 0 && (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
          {summary.passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{p.name}</p>
                <p className="text-xs text-gray-500">
                  Added {day(p.createdAt)} · last used {day(p.lastUsedAt)}
                  {p.synced ? " · synced across your devices" : " · this device only"}
                </p>
              </div>
              <button
                onClick={() => setRemoving({ id: p.id, name: p.name })}
                disabled={summary.required && count === 1}
                title={summary.required && count === 1 ? "Add another passkey before removing this one" : undefined}
                className="shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {supported ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="new-passkey-name" className="block text-sm font-medium text-gray-700">
              {count === 0 ? "Name for this passkey" : "Add another, for a second device"}
            </label>
            <input
              id="new-passkey-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            onClick={() => void add()}
            disabled={adding}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300"
          >
            {adding ? "Waiting for your device…" : count === 0 ? "Set up a passkey" : "Add passkey"}
          </button>
        </div>
      ) : (
        <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          This browser can't create a passkey. Use a current version of Chrome, Safari, Edge or Firefox.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {count > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gray-50 px-4 py-3">
          <p className="text-sm text-gray-700">
            <span className="font-medium">{summary.recoveryCodesLeft} recovery codes left.</span>{" "}
            <span className="text-gray-500">They sign you in if you can't use your passkey.</span>
          </p>
          <button onClick={() => setRenewing(true)} className="text-sm font-medium text-blue-600 hover:underline">
            Get new codes
          </button>
        </div>
      )}

      {codes && (
        <RecoveryCodesDialog
          codes={codes}
          account={account}
          onDone={() => {
            setCodes(null);
            onChanged?.(count > 0);
          }}
        />
      )}
      {removing && (
        <ConfirmWithPassword
          title={`Remove "${removing.name}"?`}
          body={
            count === 1
              ? "This is your only passkey. Without one, your account is protected by your password alone."
              : "You won't be able to sign in with this passkey any more."
          }
          confirmLabel="Remove passkey"
          needsPassword={hasPassword}
          onConfirm={async (password) => {
            apply(await removePasskey(removing.id, password));
            toast.success("Passkey removed");
          }}
          onClose={() => setRemoving(null)}
        />
      )}
      {renewing && (
        <ConfirmWithPassword
          title="Get new recovery codes?"
          body="Your current codes stop working and ten new ones are made."
          confirmLabel="Make new codes"
          needsPassword={hasPassword}
          onConfirm={async (password) => apply(await regenerateRecoveryCodes(password))}
          onClose={() => setRenewing(false)}
        />
      )}
    </div>
  );
}
