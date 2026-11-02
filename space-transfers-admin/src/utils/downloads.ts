import { getApiBaseUrl } from "./api";
import { getToken } from "./auth";

/**
 * Authenticated file downloads.
 *
 * `apiFetch` parses every response as JSON, so it cannot be used for a PDF —
 * which is part of why the Download Invoice button was never wired up. This
 * fetches the bytes with the same credentials, then hands them to the browser.
 *
 * Token and base URL come from the existing helpers rather than being read
 * again here. Reading `localStorage` directly is what broke the first attempt:
 * this app stores the token under `admin_token`, not `token`, so the header
 * went out empty and the server answered "Authentication required".
 */

const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: revoking synchronously can cancel the download
  // in some browsers before it has read the object.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Reads the server's filename, falling back to one built from the order number. */
const filenameFrom = (disposition: string | null, fallback: string): string => {
  const match = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return match?.[1] ? decodeURIComponent(match[1]) : fallback;
};

export const downloadOrderInvoice = async (
  orderId: string,
  orderNumber?: string,
): Promise<void> => {
  const token = getToken();
  const response = await fetch(
    `${getApiBaseUrl()}/admin/orders/${encodeURIComponent(orderId)}/invoice`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );

  if (!response.ok) {
    // The error body is JSON even though the success body is a PDF.
    let message = `Invoice download failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.message) message = body.message;
    } catch {
      /* keep the status-code message */
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  saveBlob(
    blob,
    filenameFrom(
      response.headers.get("Content-Disposition"),
      `invoice-${orderNumber || orderId}.pdf`,
    ),
  );
};

/** Downloads the payouts list as a CSV, with the same filters as the screen. */
export const downloadPayoutsCsv = async (status: string): Promise<void> => {
  const token = getToken();
  const response = await fetch(
    `${getApiBaseUrl()}/payouts/admin/export?status=${encodeURIComponent(status)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (!response.ok) throw new Error(`Export failed (${response.status})`);
  saveBlob(await response.blob(), `payouts-${new Date().toISOString().slice(0, 10)}.csv`);
};
