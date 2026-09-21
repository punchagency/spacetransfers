import { useState, useEffect } from "react";
import { MdClose, MdLogout, MdPersonAddAlt } from "react-icons/md";
import { BsBoxSeam } from "react-icons/bs";
import { apiFetch } from "../../lib/utils/api";
import { setToken } from "../../lib/utils/auth";
import toast from "react-hot-toast";

interface AccountSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenOrderHistory: () => void;
  onViewOrderDetails: () => void;
  user: any;
  onSignOut: () => void;
  onAuthSuccess: (user: any) => void;
  onAddAccount: () => void;
}

export default function AccountSettingsModal({
  isOpen,
  onClose,
  onOpenOrderHistory,
  onViewOrderDetails,
  user,
  onSignOut,
  onAuthSuccess,
  onAddAccount,
}: AccountSettingsModalProps) {
  const [subAccounts, setSubAccounts] = useState<any[]>([]);
  const [isFetchingSubAccounts, setIsFetchingSubAccounts] = useState(false);
  const [switchingAccountId, setSwitchingAccountId] = useState<string | null>(null);
  const [subAccountsError, setSubAccountsError] = useState<string | null>(null);
  const avatarBgClasses = [
    "bg-red-600",
    "bg-orange-600",
    "bg-amber-600",
    "bg-yellow-600",
    "bg-lime-600",
    "bg-green-600",
    "bg-emerald-600",
    "bg-teal-600",
    "bg-cyan-600", 
    "bg-sky-600",
    "bg-blue-600",
    "bg-indigo-600",
    "bg-violet-600",
    "bg-purple-600",
    "bg-fuchsia-600",
    "bg-pink-600",
    "bg-rose-600",
  ] as const;

  const getAvatarBgClass = (name?: string) => {
    const first = (name || "").trim().charAt(0).toUpperCase();
    const idx = first >= "A" && first <= "Z" ? first.charCodeAt(0) - 65 : 0;
    return avatarBgClasses[idx % avatarBgClasses.length];
  };

  useEffect(() => {
    if (isOpen && user) {
      fetchSubAccounts();
    }
  }, [isOpen, user]);

  const fetchSubAccounts = async () => {
    try {
      setIsFetchingSubAccounts(true);
      setSubAccountsError(null);
      const data = await apiFetch("/auth/sub-accounts");
      setSubAccounts(data);
    } catch (error) {
      setSubAccountsError("Failed to load sub accounts");
      setSubAccounts([]);
    } finally {
      setIsFetchingSubAccounts(false);
    }
  };

  const handleSwitchAccount = async (targetUserId: string) => {
    try {
      setSwitchingAccountId(targetUserId);
      setSubAccountsError(null);
      const response = await apiFetch("/auth/switch-account", {
        method: "POST",
        body: JSON.stringify({ targetUserId }),
      });

      if (response.token) {
        setToken(response.token);
      }
      
      onAuthSuccess(response.user);
      toast.success(response?.message || `Switched to ${response.user?.name || "account"}'s account`);
      onClose();
    } catch (error: any) {
      setSubAccountsError(error?.message || "Failed to switch account");
    } finally {
      setSwitchingAccountId(null);
    }
  };

  if (!isOpen) return null;

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .toUpperCase()
    : "??";

  const linkedMainAccount = subAccounts.find((a) => a?.isSubAccount === false);
  const linkedSubAccounts = subAccounts.filter((a) => a?.isSubAccount === true);
  const totalLinkedCount = 1 + linkedSubAccounts.length;
  const canAddAccount = totalLinkedCount < 5;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-xs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm mx-4 max-h-[90dvh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        {/* Header — sticks so the close button stays reachable while scrolling */}
        <div className="sticky top-0 z-10 bg-white px-5 pt-5 pb-2">
          <h2 className="text-lg font-semibold text-gray-900">
            Account Settings
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Manage your account and subscription
          </p>
          <button
            onClick={onClose}
            className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        {/* Current Account */}
        <div className="mt-5 flex items-center gap-4 px-5">
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user?.name || ""}
              referrerPolicy="no-referrer"
              className="h-12 w-12 rounded-full object-cover ring-2 ring-gray-100 flex-shrink-0"
            />
          ) : (
            <div className={`flex h-12 w-12 items-center justify-center rounded-full ${getAvatarBgClass(user?.name)} text-white font-medium uppercase flex-shrink-0`}>
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <p className="font-medium text-gray-900 truncate">{user?.name || "Guest"}</p>
            <p className="text-sm text-gray-500 truncate">{user?.email || "No email provided"}</p>
            {user?.isGoogleAccount && (
              <p className="text-xs text-gray-400 mt-0.5">Connected with Google</p>
            )}
          </div>
        </div>

        <div className="my-4 border-t border-gray-200" />

        <div className="px-5 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-500">Linked Accounts</p>
            <button
              type="button"
              onClick={fetchSubAccounts}
              disabled={isFetchingSubAccounts}
              className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-50"
            >
              Refresh
            </button>
          </div>

          {subAccountsError && (
            <div className="mb-2 text-xs text-red-600">{subAccountsError}</div>
          )}

          {isFetchingSubAccounts ? (
            <div className="text-xs text-gray-500">Loading...</div>
          ) : subAccounts.length === 0 ? (
            <div className="text-xs text-gray-500">No linked accounts yet</div>
          ) : (
            <div className="space-y-2">
              {linkedMainAccount && (
                <div
                  className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-colors ${
                    linkedMainAccount.id === user?.id
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-blue-300 hover:bg-gray-50 cursor-pointer"
                  }`}
                  onClick={() => {
                    if (switchingAccountId === linkedMainAccount.id) return;
                    if (linkedMainAccount.id === user?.id) return;
                    handleSwitchAccount(linkedMainAccount.id);
                  }}
                >
                  <div className="flex items-center gap-3">
                    {linkedMainAccount.avatarUrl ? (
                      <img
                        src={linkedMainAccount.avatarUrl}
                        alt={linkedMainAccount.name || ""}
                        referrerPolicy="no-referrer"
                        className="h-10 w-10 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className={`flex h-10 w-10 items-center justify-center rounded-full ${getAvatarBgClass(linkedMainAccount.name)} text-white text-sm font-medium uppercase flex-shrink-0`}>
                        {linkedMainAccount.name?.[0] || "?"}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {linkedMainAccount.name}
                      </p>
                      <p className="text-xs text-gray-500">{linkedMainAccount.email}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={Boolean(switchingAccountId === linkedMainAccount.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSwitchAccount(linkedMainAccount.id);
                    }}
                    className="text-sm font-medium text-blue-600 hover:underline disabled:opacity-50"
                  >
                    {switchingAccountId === linkedMainAccount.id
                      ? "Switching..."
                      : linkedMainAccount.id === user?.id
                        ? "Current"
                        : "Main"}
                  </button>
                </div>
              )}

              {linkedSubAccounts.map((account) => {
                const isSwitching = switchingAccountId === account.id;
                const isCurrent = account.id === user?.id;

                return (
                  <div
                    key={account.id}
                    className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-colors ${
                      isCurrent
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-blue-300 hover:bg-gray-50 cursor-pointer"
                    }`}
                    onClick={() => {
                      if (isSwitching || isCurrent) return;
                      handleSwitchAccount(account.id);
                    }}
                  >
                    <div className="flex items-center gap-3">
                      {account.avatarUrl ? (
                        <img
                          src={account.avatarUrl}
                          alt={account.name || ""}
                          referrerPolicy="no-referrer"
                          className="h-10 w-10 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${getAvatarBgClass(account.name)} text-white text-sm font-medium uppercase flex-shrink-0`}>
                          {account.name?.[0] || "?"}
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {account.name}
                        </p>
                        <p className="text-xs text-gray-500">{account.email}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={Boolean(isSwitching)}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSwitchAccount(account.id);
                      }}
                      className="text-sm font-medium text-blue-600 hover:underline disabled:opacity-50"
                    >
                      {isSwitching ? "Switching..." : isCurrent ? "Current" : "Switch"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Order History */}
        <div className="mt-4 px-10 ">
          <button
            onClick={() => {
              onClose();
              onOpenOrderHistory();
            }}
            className="flex items-start gap-3 w-full text-left hover:bg-gray-50 rounded-lg p-2 -m-2"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100">
              <BsBoxSeam className="h-3.5 w-3.5 text-gray-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">Order History</p>
              <p className="text-xs text-gray-500">
                View past orders and invoices
              </p>
            </div>
          </button>
        </div>

        <div className="my-4 border-t border-gray-200" />

        {/* Actions */}
        <div className="space-y-5 px-5 pb-5">
          {canAddAccount && (
            <button 
              onClick={onAddAccount}
              className="flex items-center gap-2 text-sm font-medium text-blue-600"
            >
              <MdPersonAddAlt className="h-5 w-5" />
              Add Account
            </button>
          )}
          <button 
            onClick={onSignOut}
            className="flex items-center gap-2 text-sm font-medium text-red-600"
          >
            <MdLogout className="h-5 w-5" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
