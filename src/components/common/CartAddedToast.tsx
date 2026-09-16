import toast from "react-hot-toast";
import { MdCheckCircle } from "react-icons/md";

/**
 * What to do next, right after a sheet goes in the cart.
 *
 * Adding used to end in a bare success toast, leaving the two things a customer
 * actually wants — see the cart, or start the next sheet — to be found on their
 * own. Carrying on editing instead is the third option and needs no button: the
 * Add button becomes "Update Cart" and the change lands on the same line.
 */
export const showCartAddedToast = ({
  onViewCart,
  onStartNewSheet,
}: {
  onViewCart: () => void;
  onStartNewSheet: () => void;
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
            <p className="text-[13px] font-semibold text-gray-900">Sheet added to your cart</p>
            <p className="mt-0.5 text-[12px] leading-[17px] text-gray-600">
              Keep editing and the cart updates with it, or start a separate sheet.
            </p>
          </div>
        </div>
        <div className="mt-2.5 flex gap-2">
          <button
            onClick={() => {
              toast.dismiss(t.id);
              onViewCart();
            }}
            className="flex-1 rounded-lg bg-black py-1.5 text-[12px] font-semibold text-white hover:bg-gray-900"
          >
            View cart
          </button>
          <button
            onClick={() => {
              toast.dismiss(t.id);
              onStartNewSheet();
            }}
            className="flex-1 rounded-lg border border-gray-300 py-1.5 text-[12px] font-semibold text-gray-800 hover:bg-gray-50"
          >
            Start a new sheet
          </button>
        </div>
      </div>
    ),
    { duration: 9000, id: "cart-add" },
  );
};
