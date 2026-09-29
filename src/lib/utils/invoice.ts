import { getApiBaseUrl } from "./api";
import { clearAuth, getToken } from "./auth";

/**
 * Downloads an order's invoice PDF. Shared by Order history and Order details,
 * which each carried their own copy.
 *
 * Two fixes over those copies: the file is named after the order number the
 * customer knows (`invoice-DTF-0274.pdf`, not the database id), and the file's
 * URL is released after the download has started rather than straight after
 * `click()`, which cancelled it in Safari and on iOS.
 */
export const downloadInvoice = async (orderId: string, displayId?: string | null): Promise<void> => {
  const token = getToken();
  const response = await fetch(`${getApiBaseUrl()}/customer/orders/${orderId}/invoice`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    // A blob download bypasses `apiFetch`, so the session check has to be made
    // here too — otherwise an expired token reads as a broken invoice.
    if (response.status === 401) {
      clearAuth();
      throw new Error("Your session has expired. Please sign in again.");
    }
    let message = "The invoice couldn't be downloaded. Please try again.";
    try {
      message = (await response.json())?.message || message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `invoice-${displayId || orderId}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
};
