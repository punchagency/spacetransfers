import React from "react";
import { MdShoppingCart } from "react-icons/md";

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
  tax: number;
  total: number;
  onNext: () => void;
}

export default function OrderSummary({ cartItems, step, subtotal, shippingCost, tax, total, onNext }: OrderSummaryProps) {
  const renderItemPreview = (item: CartItem) => {
    if (item.type === 'gangsheet') {
      return (
        <div className="w-20 h-20 bg-gray-100 rounded border border-gray-200 flex-shrink-0 overflow-hidden">
          {item.image && item.image !== '/placeholder-gangsheet.png' ? (
            <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
          ) : item.items && item.items.length > 0 ? (
            <div className="w-full h-full bg-[#E9F2F1] flex items-center justify-center p-0.5">
              <div className="w-full h-full bg-white rounded shadow-sm flex items-center justify-center overflow-hidden">
                <div className="grid gap-0.5 p-0.5" style={{
                  gridTemplateColumns: `repeat(${Math.min(3, Math.ceil(Math.sqrt(item.items.length)))}, 1fr)`,
                }}>
                  {item.items.slice(0, 9).map((subItem: any, idx: number) => (
                    <div key={idx} className="relative aspect-square">
                      <img src={subItem.url} alt="" className="w-full h-full object-contain" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-3xl flex items-center justify-center">📋</div>
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
    <div className="bg-white rounded-lg border border-gray-200 p-6 sticky  ">
      <div className="flex items-center gap-2 mb-4">
        <MdShoppingCart className="w-5 h-5 text-blue-600" />
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
          <span className="text-gray-600">Subtotal ({cartItems.length} items)</span>
          <span className="font-medium">${subtotal.toFixed(2)}</span>
        </div>
        {step > 1 && (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Shipping</span>
              <span className="font-medium">${shippingCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Tax (8%)</span>
              <span className="font-medium">${tax.toFixed(2)}</span>
            </div>
          </>
        )}
        <div className="flex justify-between text-lg font-semibold pt-2 border-t border-gray-200">
          <span>Total</span>
          <span>${step > 1 ? total.toFixed(2) : subtotal.toFixed(2)}</span>
        </div>
      </div>

      {step < 3 && (
        <button
          onClick={onNext}
          className="w-full mt-4 rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700"
        >
          {step === 0 ? 'Proceed to Checkout' : step === 1 ? 'Continue to Payment' : 'Place Order'}
        </button>
      )}
    </div>
  );
}
