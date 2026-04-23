import { useState } from "react";
import { FiX, FiPlus, FiTrash2, FiChevronDown } from "react-icons/fi";
import type { PricingEditorModalProps, Fee } from "../../types/partners";

export const PricingEditorModal = ({
  isOpen,
  onClose,
  onSave,
  initialData,
}: PricingEditorModalProps) => {
  const [basePrintPrice, setBasePrintPrice] = useState(
    initialData.basePrintPrice,
  );
  const [baseShippingPrice, setBaseShippingPrice] = useState(
    initialData.baseShippingPrice,
  );
  const [extraFees, setExtraFees] = useState<Fee[]>(initialData.extraFees);
  const [markupType, setMarkupType] = useState(initialData.markupType);
  const [markupAmount, setMarkupAmount] = useState(initialData.markupAmount);

  if (!isOpen) return null;

  const addFee = () => {
    setExtraFees([...extraFees, { id: Date.now(), name: "", value: "0" }]);
  };

  const removeFee = (id: number) => {
    setExtraFees(extraFees.filter((f) => f.id !== id));
  };

  const updateFee = (index: number, field: "name" | "value", value: string) => {
    const newFees = [...extraFees];
    newFees[index] = { ...newFees[index], [field]: value };
    setExtraFees(newFees);
  };

  const customerPrice =
    (parseFloat(basePrintPrice) || 0) + (parseFloat(markupAmount) || 0);
  const profit = parseFloat(markupAmount) || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
      {/* Blur Overlay */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[95vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-xl font-bold text-gray-900">Pricing Editor</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600"
          >
            <FiX className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-8 py-6 space-y-8 overflow-y-auto">
          {/* Base Prices */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-gray-900">Base Prices</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500">
                  Base Print Price
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                    $
                  </span>
                  <input
                    type="text"
                    value={basePrintPrice}
                    onChange={(e) => setBasePrintPrice(e.target.value)}
                    className="w-full pl-8 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl text-sm font-medium text-gray-900 focus:bg-white focus:border-blue-500 transition-all outline-none"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500">
                  Base Shipping Price
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                    $
                  </span>
                  <input
                    type="text"
                    value={baseShippingPrice}
                    onChange={(e) => setBaseShippingPrice(e.target.value)}
                    className="w-full pl-8 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl text-sm font-medium text-gray-900 focus:bg-white focus:border-blue-500 transition-all outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Extra Service Fees */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">
                Extra Service Fees
              </h3>
              <button
                onClick={addFee}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 transition-colors"
              >
                <FiPlus className="w-3.5 h-3.5" />
                Add Fee
              </button>
            </div>
            <div className="space-y-3">
              {extraFees.map((fee, index) => (
                <div key={fee.id} className="flex gap-3">
                  <input
                    type="text"
                    value={fee.name}
                    placeholder="Fee name"
                    onChange={(e) => updateFee(index, "name", e.target.value)}
                    className="flex-1 px-4 py-3 bg-gray-50 border border-transparent rounded-xl text-sm font-medium text-gray-900 focus:bg-white focus:border-blue-500 transition-all outline-none"
                  />
                  <div className="relative w-28">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                      $
                    </span>
                    <input
                      type="text"
                      value={fee.value}
                      onChange={(e) =>
                        updateFee(index, "value", e.target.value)
                      }
                      className="w-full pl-8 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl text-sm font-medium text-gray-900 focus:bg-white focus:border-blue-500 transition-all outline-none"
                    />
                  </div>
                  <button
                    onClick={() => removeFee(fee.id)}
                    className="p-3 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <FiTrash2 className="w-4.5 h-4.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Platform Markup Card */}
          <div className="bg-gray-50/50 rounded-2xl p-6 space-y-6">
            <h3 className="text-sm font-bold text-gray-900">Platform Markup</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500">
                  Markup Type
                </label>
                <div className="relative">
                  <select
                    value={markupType}
                    onChange={(e) => setMarkupType(e.target.value)}
                    className="w-full px-4 py-3 bg-white border border-transparent rounded-lg text-sm font-medium text-gray-900 focus:border-blue-500 transition-all outline-none appearance-none cursor-pointer"
                  >
                    <option>Fixed Amount</option>
                    <option>Percentage</option>
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                    <FiChevronDown />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500">
                  Markup Amount
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                    $
                  </span>
                  <input
                    type="text"
                    value={markupAmount}
                    onChange={(e) => setMarkupAmount(e.target.value)}
                    className="w-full pl-8 pr-4 py-3 bg-white border border-transparent rounded-lg text-sm font-medium text-gray-900 focus:border-blue-500 transition-all outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Customer Price Preview Box */}
            <div className="bg-white border border-blue-100 rounded-xl p-5 space-y-1 shadow-sm">
              <p className="text-xs font-medium text-gray-500">
                Customer Price Preview
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-blue-600">
                  ${customerPrice.toFixed(2)}
                </span>
              </div>
              <p className="text-[13px] text-gray-400 font-medium">
                Your profit:{" "}
                <span className="text-green-500 font-bold">
                  ${profit.toFixed(2)}
                </span>{" "}
                per unit
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-4 shrink-0 bg-gray-50/20">
          <button
            onClick={onClose}
            className="px-6 py-2.5 text-sm font-bold text-gray-600 hover:text-gray-900 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() =>
              onSave({
                basePrintPrice,
                baseShippingPrice,
                extraFees,
                markupType,
                markupAmount,
              })
            }
            className="px-8 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};
