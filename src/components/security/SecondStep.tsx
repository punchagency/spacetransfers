import { useEffect, useRef, useState } from "react";
import {
  completeSecondStepWithCode,
  completeSecondStepWithPasskey,
  passkeyErrorMessage,
  passkeysSupported,
  type SecondStepChallenge,
} from "../../lib/utils/passkeys";

interface SecondStepProps {
  challenge: SecondStepChallenge;
  /** Called with the signed-in response once the step passes. */
  onSignedIn: (response: any) => void;
  onCancel: () => void;
}

/** The second step of sign-in: the passkey, or a recovery code when it isn't to hand. */
export function SecondStep({ challenge, onSignedIn, onCancel }: SecondStepProps) {
  const [mode, setMode] = useState<"passkey" | "code">(passkeysSupported() ? "passkey" : "code");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const started = useRef(false);

  const usePasskey = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await completeSecondStepWithPasskey(challenge));
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // The prompt opens by itself the first time: the person has just asked to sign in.
  useEffect(() => {
    if (started.current || mode !== "passkey") return;
    started.current = true;
    void usePasskey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await completeSecondStepWithCode(challenge, code));
    } catch (err: any) {
      setError(err?.message || "That code didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 text-left" data-second-step>
      <div className="space-y-1.5 text-center">
        <h2 className="text-2xl font-bold text-slate-900">One more step</h2>
        <p className="text-sm text-slate-500">
          {mode === "passkey"
            ? "Confirm it's you with your passkey: your fingerprint, face or device PIN."
            : "Enter one of the recovery codes you saved when you set your passkey up. Each works once."}
        </p>
      </div>

      {mode === "passkey" ? (
        <button
          type="button"
          onClick={() => void usePasskey()}
          disabled={busy}
          className="w-full rounded-lg bg-[#2563EB] px-4 py-3.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-400"
        >
          {busy ? "Waiting for your passkey…" : "Use passkey"}
        </button>
      ) : (
        <form onSubmit={useCode} className="space-y-3">
          <label htmlFor="recovery-code" className="block text-xs font-bold text-slate-900">
            Recovery code
          </label>
          <input
            id="recovery-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="XXXXX-XXXXX"
            className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 font-mono text-sm tracking-wider focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="w-full rounded-lg bg-[#2563EB] px-4 py-3.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300"
          >
            {busy ? "Checking…" : "Sign in with code"}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between text-sm">
        <button type="button" onClick={onCancel} className="font-medium text-slate-500 hover:text-slate-700">
          Back to sign in
        </button>
        {mode === "passkey" ? (
          <button type="button" onClick={() => { setMode("code"); setError(null); }} className="font-medium text-blue-600 hover:underline">
            Use a recovery code
          </button>
        ) : (
          passkeysSupported() && (
            <button type="button" onClick={() => { setMode("passkey"); setError(null); }} className="font-medium text-blue-600 hover:underline">
              Use passkey instead
            </button>
          )
        )}
      </div>
    </div>
  );
}
