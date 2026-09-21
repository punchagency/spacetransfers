import { MdShoppingCart } from "react-icons/md";
import GangsheetPreview from "./GangsheetPreview";

interface CartItem {
  id: number;
  name: string;
  size: string;
  quantity?: number;
  copies?: number;
  type?: string;
  image?: string;
  items?: any[];
  widthIn?: number;
  heightIn?: number;
  price?: number;
}

interface OrderSummaryProps {
  cartItems: CartItem[];
  step: number;
  subtotal: number;
  shippingCost: number;
  total: number;
  onNext: () => void;
  isSubmitting?: boolean;
  disableNext?: boolean;
  nextLabel?: string;
  /** Overrides the button's label while `isSubmitting` is true — e.g. "Finalizing artwork…" during the rare case Place Order still has an upload to wait on. Falls back to "Processing...". */
  submittingLabel?: string;
}

export default function OrderSummary({
  cartItems,
  step,
  subtotal,
  shippingCost,
  total,
  onNext,
  isSubmitting = false,
  disableNext = false,
  nextLabel,
  submittingLabel,
}: OrderSummaryProps) {
  if (!cartItems || cartItems.length === 0) return null;

  const renderItemPreview = (item: CartItem) => {
    if (item.type === 'gangsheet') {
      const hasSnapshot =
        item.image && item.image !== '/placeholder-gangsheet.png';
      return (
        <div className="bg-[#E9F2F1] rounded border border-gray-200 flex-shrink-0 flex items-center justify-center overflow-hidden">
          {hasSnapshot ? (
            <img
              src={item.image}
              alt={item.name}
              className="object-contain"
              style={{ maxWidth: 88, maxHeight: 120 }}
            />
          ) : item.items && item.items.length > 0 ? (
            <GangsheetPreview
              items={item.items}
              sheetWidthIn={item.widthIn}
              sheetHeightIn={item.heightIn}
              marginIn={(item as any).sheetMarginIn}
              spacingIn={(item as any).itemSpacingIn}
              maxWidth={88}
              maxHeight={120}
            />
          ) : (
            <div className="w-20 h-20 text-3xl flex items-center justify-center">📋</div>
          )}
        </div>
      );
    }
    return (
      <div className="w-20 h-20 bg-gray-100 rounded border border-gray-200 flex items-center justify-center">
        <div className="text-3xl">👨🚀</div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6 sticky  ">
      <div className="flex items-center gap-2 mb-4">
        <MdShoppingCart className="w-5 h-5 text-black" />
        <h3 className="text-base font-semibold">Order Summary</h3>
      </div>
      
      {step > 0 && (
        <div className="space-y-4 mb-6">
          {cartItems.map(item => (
            <div key={item.id} className="flex gap-3">
              {renderItemPreview(item)}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 text-sm">{item.name}</div>
                <div className="text-xs text-gray-600">
                  Size: {item.type === 'gangsheet' && item.widthIn && item.heightIn
                    ? `${item.widthIn.toFixed(1)}" × ${item.heightIn.toFixed(1)}"`
                    : item.size}
                </div>
                <div className="text-xs text-gray-600">
                  Qty: {item.quantity || item.copies || 1}
                </div>
                <div className="text-xs font-semibold text-gray-900 mt-1">
                  ${((item.price || 0) * (item.quantity || item.copies || 1)).toFixed(2)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-gray-200 pt-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Subtotal ({cartItems.length} {cartItems.length === 1 ? "item" : "items"})</span>
          <span className="font-medium">${subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Shipping</span>
          <span className="font-medium">${shippingCost.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-lg font-semibold pt-2 border-t border-gray-200">
          <span>Total</span>
          <span>${total.toFixed(2)}</span>
        </div>
      </div>

      {step < 4 && (
        <button
          onClick={onNext}
          disabled={isSubmitting || disableNext}
          className={`w-full mt-4 rounded-lg py-3 text-sm font-semibold text-white transition-colors ${
            isSubmitting || disableNext ? "bg-gray-400 cursor-not-allowed" : "bg-black hover:bg-gray-900"
          }`}
        >
          {isSubmitting
            ? submittingLabel || "Processing..."
            : nextLabel || (step === 0 ? 'Proceed to Checkout' : step === 1 ? 'Continue to Payment' : step === 2 ? 'Continue to Review' : 'Place Order')}
        </button>
      )}
    </div>
  );
}
