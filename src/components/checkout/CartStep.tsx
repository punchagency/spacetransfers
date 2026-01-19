import React from "react";
import { RiDeleteBin5Line } from "react-icons/ri";
import { MdOutlineRemoveShoppingCart } from "react-icons/md";
interface CartItem {
  id: number;
  name: string;
  size: string;
  color: string;
  design: string;
  print: string;
  price: number;
  quantity: number;
  type?: string;
  image?: string;
  items?: any[];
  copies?: number;
  widthIn?: number;
  heightIn?: number;
}

interface CartStepProps {
  cartItems: CartItem[];
  updateQuantity: (id: number, change: number) => void;
  removeItem: (id: number) => void;
}

export default function CartStep({ cartItems, updateQuantity, removeItem }: CartStepProps) {
  const renderItemImage = (item: CartItem) => {
    if (item.type === 'gangsheet') {
      console.log('Gang sheet item:', item);
      console.log('Items array:', item.items);
      console.log('Items length:', item.items?.length);
      if (item.items && item.items.length > 0) {
        console.log('First item:', item.items[0]);
        console.log('First item URL:', item.items[0]?.url);
      }
      return (
        <div className="w-24 h-24 bg-gray-100 rounded border border-gray-200 flex-shrink-0 overflow-hidden">
          {item.image && item.image !== '/placeholder-gangsheet.png' ? (
            <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
          ) : item.items && item.items.length > 0 ? (
            <div className="w-full h-full bg-[#E9F2F1] flex items-center justify-center p-1">
              <div className="w-full h-full bg-white rounded shadow-sm flex items-center justify-center overflow-hidden">
                <div className="grid gap-0.5 p-0.5" style={{
                  gridTemplateColumns: `repeat(${Math.min(3, Math.ceil(Math.sqrt(item.items.length)))}, 1fr)`,
                }}>
                  {item.items.map((subItem: any, idx: number) => {
                    console.log(`Rendering item ${idx}:`, subItem, 'URL:', subItem?.url);
                    return (
                      <div key={idx} className="relative aspect-square">
                        <img
                          src={subItem.url}
                          alt=""
                          className="w-full h-full object-contain"
                          onError={(e) => console.error('Image failed to load:', subItem.url, e)}
                          onLoad={() => console.log('Image loaded successfully:', subItem.url)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-4xl flex items-center justify-center">📋</div>
          )}
        </div>
      );
    }
    return (
      <div className="w-24 h-24 bg-gray-100 rounded border border-gray-200 flex items-center justify-center flex-shrink-0">
        {item.image ? (
          <img src={item.image} alt={item.name} className="w-full h-full object-cover rounded" />
        ) : (
          <div className="text-4xl">👨🚀</div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-gray-900 mb-4">Cart ({cartItems.length})</h3>

      {cartItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4">
          <div className="w-32 h-32 mb-0 opacity-40">
            <MdOutlineRemoveShoppingCart size={100} />
          </div>
          <h4 className="text-lg font-semibold text-gray-900 mb-2">Your cart is empty</h4>
          <p className="text-sm text-gray-500 text-center max-w-xs mb-6">
            Start creating your gang sheet by dropping images onto the artboard
          </p>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>💡</span>
            <span>Tip: Drag and drop multiple images to get started</span>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {cartItems.map(item => (
            <div key={item.id} className="flex gap-4 pb-6 border-b border-gray-200 last:border-0">
              {renderItemImage(item)}
              <div className="flex-1">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-semibold text-gray-900">{item.name}</h4>
                    <div className="text-sm text-gray-600 mt-1">
                      Size: {item.type === 'gangsheet' && item.widthIn && item.heightIn
                        ? `${item.widthIn.toFixed(1)}" × ${item.heightIn.toFixed(1)}"`
                        : item.size}
                    </div>
                    <div className="text-sm text-gray-600">Color: {item.color}</div>
                    <div className="text-sm text-gray-600">Design: {item.design}</div>
                    <div className="text-sm text-gray-600">Print: {item.print}</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-right">${item.price}</div>
                    <div className="flex flex-col items-end gap-2 mt-2">
                      <div className="flex items-center border border-gray-300 rounded overflow-hidden">
                        <button
                          onClick={() => updateQuantity(item.id, -1)}
                          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-50 border-r border-gray-300"
                        >
                          −
                        </button>
                        <span className="w-12 text-center">{item.quantity || item.copies || 1}</span>
                        <button
                          onClick={() => updateQuantity(item.id, 1)}
                          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-50 border-l border-gray-300"
                        >
                          +
                        </button>
                      </div>
                      <button
                        onClick={() => removeItem(item.id)}
                        className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700"
                      >
                        <RiDeleteBin5Line className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
