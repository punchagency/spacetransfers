import toast from "react-hot-toast";
import { MdCheckCircle } from "react-icons/md";

/**
 * Confirmation that a sheet is in the cart, with the one thing worth doing next.
 *
 * It offered "Start a new sheet" too, which right after adding is a step nobody
 * is ready for — that choice now lives in the cart, where starting another sheet
 * is a deliberate act. Carrying on editing needs no button at all: the cart line
 * follows the board.
 */
export const showCartAddedToast = ({
  onViewCart,
  sheetName,
}: {
  onViewCart: () => void;
  sheetName?: string | null;
}) => {
  toast.custom(
    (t) => (
      <div
        className={`pointer-events-auto w-[330px] rounded-xl border border-gray-200 bg-white p-3 shadow-lg transition-all duration-200 ${
          t.visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
        }`}
        role="status"
      >
        <div className="flex items-start gap-2">
          <MdCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-gray-900">
              {sheetName ? `“${sheetName}” is in your cart` : "Sheet added to your cart"}
            </p>
            <p className="mt-0.5 text-[12px] leading-[17px] text-gray-600">
              It's saved to your sheets too. Changes you make to it update your cart — for a different sheet, use Start a new sheet.
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            toast.dismiss(t.id);
            onViewCart();
          }}
          className="mt-2.5 w-full rounded-lg bg-black py-1.5 text-[12px] font-semibold text-white hover:bg-gray-900"
        >
          View cart
        </button>
      </div>
    ),
    // At the bottom: at the top it sat over the image toolbar for seven seconds.
    { duration: 7000, id: "cart-add", position: "bottom-center" },
  );
};
