import { useState } from "react";
import toast from "react-hot-toast";
import { MdClose, MdShoppingCart } from "react-icons/md";

const HIDE_KEY = "hideCartUpdateNotice";

/** Long enough to read the notice and reach the checkbox. */
const NOTICE_DURATION_MS = 9000;

export const cartUpdateNoticeHidden = (): boolean => {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
};

export const setCartUpdateNoticeHidden = (hidden: boolean) => {
  try {
    if (hidden) localStorage.setItem(HIDE_KEY, "1");
    else localStorage.removeItem(HIDE_KEY);
  } catch {
    /* storage unavailable: the notice keeps showing */
  }
};

export const cartUpdateNoticeText = (sheetName?: string | null) => ({
  title: sheetName ? `“${sheetName}” is in your cart` : "This sheet is in your cart",
  body: "Changes you make here update it in your cart. For a separate sheet, use Start a new sheet.",
});

const CartUpdateNoticeCard = ({
  visible,
  sheetName,
  onDismiss,
}: {
  visible: boolean;
  sheetName?: string | null;
  onDismiss: () => void;
}) => {
  const [hidden, setHidden] = useState(false);
  const { title, body } = cartUpdateNoticeText(sheetName);
  return (
    <div
      className={`pointer-events-auto w-[330px] max-w-[calc(100vw-32px)] rounded-xl border border-gray-200 bg-white p-3 shadow-lg transition-all duration-200 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
      }`}
      role="status"
    >
      <div className="flex items-start gap-2">
        <MdShoppingCart className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-gray-900">{title}</p>
          <p className="mt-0.5 text-[12px] leading-[17px] text-gray-600">{body}</p>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center text-gray-400 hover:text-gray-600"
        >
          <MdClose className="h-4 w-4" />
        </button>
      </div>
      <label className="mt-2.5 flex cursor-pointer select-none items-center gap-2 border-t border-gray-100 pt-2.5">
        <input
          type="checkbox"
          checked={hidden}
          onChange={(e) => {
            setHidden(e.target.checked);
            setCartUpdateNoticeHidden(e.target.checked);
          }}
          className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="text-[12px] text-gray-700">Don't show this again</span>
      </label>
    </div>
  );
};

/**
 * Tells the customer that the sheet they are changing is the one in their cart.
 * The checkbox saves as it is ticked, so the choice holds even if the notice
 * times out first. Returns whether it was shown.
 */
export const showCartUpdateNotice = (sheetName?: string | null): boolean => {
  if (cartUpdateNoticeHidden()) return false;
  toast.custom(
    (t) => <CartUpdateNoticeCard visible={t.visible} sheetName={sheetName} onDismiss={() => toast.dismiss(t.id)} />,
    { duration: NOTICE_DURATION_MS, id: "cart-update", position: "bottom-center" },
  );
  return true;
};
