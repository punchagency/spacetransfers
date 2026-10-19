import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../utils/api";
import { getUser } from "../../utils/auth";
import { ResetPasskeys } from "./ResetPasskeys";

interface AdminRow {
  id: string;
  name: string;
  email: string;
  status: string;
  passkeys: number;
  recoveryCodesLeft: number;
}

/** Every admin account and whether a passkey guards it, with a reset for one who is locked out. */
export function AdminPasskeyList() {
  const [admins, setAdmins] = useState<AdminRow[] | null>(null);
  const me = String(getUser()?.id || "");

  const load = useCallback(() => {
    apiFetch("/admin/security/admins")
      .then((data) => setAdmins(Array.isArray(data?.admins) ? data.admins : []))
      .catch(() => setAdmins([]));
  }, []);
  useEffect(load, [load]);

  if (!admins) return <p className="text-sm text-gray-500">Loading admin accounts…</p>;

  return (
    <div>
      <h3 className="text-base font-bold text-gray-900">Admin accounts</h3>
      <p className="mt-1 mb-4 text-sm text-gray-500">
        Every account that can open this console. One without a passkey is held at the setup screen until it has one.
      </p>
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {admins.map((admin) => (
          <li key={admin.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">
                {admin.name || admin.email}
                {admin.id === me && <span className="ml-2 text-xs font-normal text-gray-500">you</span>}
              </p>
              <p className="truncate text-xs text-gray-500">
                {admin.email}
                {admin.status && admin.status !== "Active" ? ` · ${admin.status}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  admin.passkeys > 0 ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                }`}
              >
                {admin.passkeys > 0 ? `${admin.passkeys} passkey${admin.passkeys === 1 ? "" : "s"}` : "No passkey yet"}
              </span>
              {admin.passkeys > 0 && admin.id !== me && (
                <ResetPasskeys userId={admin.id} accountLabel={admin.name || admin.email} onReset={load} />
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
