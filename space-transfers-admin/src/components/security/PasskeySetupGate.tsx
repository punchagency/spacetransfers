import { FiShield } from "react-icons/fi";
import { clearAuth, getUser, updateStoredUser } from "../../utils/auth";
import { PasskeyManager } from "./PasskeyManager";

/**
 * Where an admin without a passkey lands, whatever page they asked for. The
 * console holds pricing, payouts and refunds, so it does not open on a
 * password alone; the server refuses them too, so this screen is the only way on.
 */
export function PasskeySetupGate() {
  const user = getUser();
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] p-4">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-5 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50">
            <FiShield className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Set up a passkey to continue</h1>
            <p className="mt-1 text-sm text-gray-500">
              Admin accounts need a second step at sign-in. It takes a few seconds and uses this device's fingerprint,
              face or PIN. You'll get recovery codes in case you ever lose it.
            </p>
          </div>
        </div>
        <PasskeyManager
          account={String(user?.email || "")}
          onChanged={(hasPasskey) => {
            if (hasPasskey) updateStoredUser({ mustEnrollPasskey: false, hasPasskey: true });
          }}
        />
        <button onClick={() => clearAuth()} className="mt-6 text-sm font-medium text-gray-500 hover:text-gray-700">
          Sign out
        </button>
      </div>
    </div>
  );
}
