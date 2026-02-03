import { MdCreditCard, MdOutlineLocalShipping } from "react-icons/md";
import { FaPaypal } from "react-icons/fa";

interface FormData {
  cardNumber: string;
  expiry: string;
  cvv: string;
  cardName: string;
}

interface PaymentStepProps {
  payment: "card" | "paypal";
  setPayment: (method: "card" | "paypal") => void;
  shipping: "standard" | "express";
  setShipping: (method: "standard" | "express") => void;
  formData: FormData;
  setFormData: (data: any) => void;
}

export default function PaymentStep({
  payment,
  setPayment,
  shipping,
  setShipping,
  formData,
  setFormData,
}: PaymentStepProps) {
  return (
    <>
      <div className="bg-white rounded-lg border mb-5 border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <MdCreditCard className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold">Payment Method</h3>
        </div>

        <div className="space-y-3">
          <label
            className={`border-2 rounded-lg p-4 flex items-center gap-3 cursor-pointer ${
              payment === "card"
                ? "border-blue-600 bg-blue-50"
                : "border-gray-200"
            }`}
          >
            <input
              type="radio"
              checked={payment === "card"}
              onChange={() => setPayment("card")}
              className="h-4 w-4"
            />
            <MdCreditCard className="h-5 w-5 text-gray-600" />
            <div className="flex-1">
              <div className="font-medium">Credit / Debit Card</div>
              <div className="text-xs text-gray-500">
                Visa, Mastercard, American Express
              </div>
            </div>
          </label>

          {payment === "card" && (
            <div className=" space-y-4 mt-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Card Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.cardNumber}
                  onChange={(e) =>
                    setFormData({ ...formData, cardNumber: e.target.value })
                  }
                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                    formData.cardNumber ? "bg-[#F3F3F5]" : "bg-white"
                  }`}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Expiry Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="MM / YY"
                    value={formData.expiry}
                    onChange={(e) =>
                      setFormData({ ...formData, expiry: e.target.value })
                    }
                    className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                      formData.expiry ? "bg-[#F3F3F5]" : "bg-white"
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    CVV <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="123"
                    value={formData.cvv}
                    onChange={(e) =>
                      setFormData({ ...formData, cvv: e.target.value })
                    }
                    className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                      formData.cvv ? "bg-[#F3F3F5]" : "bg-white"
                    }`}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Cardholder Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.cardName}
                  onChange={(e) =>
                    setFormData({ ...formData, cardName: e.target.value })
                  }
                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                    formData.cardName ? "bg-[#F3F3F5]" : "bg-white"
                  }`}
                />
              </div>
            </div>
          )}

          <label
            className={`border-2 rounded-lg p-4 flex items-center gap-3 cursor-pointer ${
              payment === "paypal"
                ? "border-blue-600 bg-blue-50"
                : "border-gray-200"
            }`}
          >
            <input
              type="radio"
              checked={payment === "paypal"}
              onChange={() => setPayment("paypal")}
              className="h-4 w-4"
            />
            <FaPaypal className="h-5 w-5 text-gray-600" />
            <div className="flex-1">
              <div className="font-medium">PayPal</div>
              <div className="text-xs text-gray-500">
                Pay securely with your PayPal account
              </div>
            </div>
          </label>

          {payment === "paypal" && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 ">
              <p className="text-sm text-gray-700 mb-4">
                You will be redirected to PayPal to complete your purchase
                securely.
              </p>
              <button className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700">
                Continue with PayPal
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-center text-gray-500 mt-4">
          By providing your payment information, you agree to our Terms of
          Service and Privacy Policy. Your payment is protected by
          industry-standard encryption.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <MdOutlineLocalShipping className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-normal">Shipping Method</h3>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4 text-sm">
          <span className="text-blue-800">Shipping to: United States</span>
          <div className="text-xs text-gray-600 mt-1">
            Costs calculated based on your region
          </div>
        </div>

        <div className="space-y-3">
          <label
            className={`border-2 rounded-lg p-4 flex gap-3 cursor-pointer ${
              shipping === "standard"
                ? "border-blue-600 bg-blue-50"
                : "border-gray-200"
            }`}
          >
            <input
              type="radio"
              checked={shipping === "standard"}
              onChange={() => setShipping("standard")}
              className="h-4 w-4 mt-1"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <img
                  src="/box.svg"
                  alt="Standard Shipping Icon"
                  className="h-5 w-5"
                />
                <div className="font-normal">Standard Shipping</div>
              </div>
              <div className="text-sm text-gray-600">
                Reliable delivery with tracking
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Estimated delivery: 5-7 business days
              </div>
            </div>
            <div className="font-semibold">$8.99</div>
          </label>

          <label
            className={`border-2 rounded-lg p-4 flex gap-3 cursor-pointer ${
              shipping === "express"
                ? "border-blue-600 bg-blue-50"
                : "border-gray-200"
            }`}
          >
            <input
              type="radio"
              checked={shipping === "express"}
              onChange={() => setShipping("express")}
              className="h-4 w-4 mt-1"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <img
                  src="/Icon.svg"
                  alt="Express Shipping Icon"
                  className="h-5 w-5"
                />
                <div className="font-normal">Express Shipping</div>
              </div>
              <div className="text-sm text-gray-600">
                Fast delivery with priority handling
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Estimated delivery: 2-3 business days
              </div>
            </div>
            <div className="font-semibold">$24.99</div>
          </label>
        </div>

        <div className="mt-4 border-t border-gray-200 pt-4">
          <h4 className="text-sm font-medium text-gray-800 mb-2">Shipping Information</h4>
          <div className="text-xs text-gray-600 space-y-1">
            <p>• All orders include tracking number</p>
            <p>• Shipping times are estimates and may vary</p>
            <p>• DTF transfers require 1-2 business days for production</p>
            <p>• International orders may be subject to customs fees</p>
          </div>
        </div>
      </div>
    </>
  );
}
