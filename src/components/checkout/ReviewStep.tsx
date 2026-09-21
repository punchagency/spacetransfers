import { MdOutlineLocalShipping, MdOutlineLocationOn, MdOutlinePayment } from "react-icons/md";

interface ReviewStepProps {
  formData: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  shipping: "standard" | "express";
  payment: "card";
}

export default function ReviewStep({ formData, shipping, payment }: ReviewStepProps) {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <MdOutlineLocationOn className="text-blue-600" />
          Shipping Address
        </h3>
        <div className="text-sm text-gray-600 space-y-1">
          <p className="font-medium text-gray-900">{formData.firstName} {formData.lastName}</p>
          <p>{formData.street}</p>
          <p>{formData.city}, {formData.state} {formData.postalCode}</p>
          <p>{formData.country || "US"}</p>
          <p className="mt-2">{formData.email}</p>
          <p>{formData.phone}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <MdOutlineLocalShipping className="text-blue-600" />
            Shipping Method
          </h3>
          <div className="text-sm text-gray-600">
            <p className="font-medium text-gray-900 capitalize">{shipping} Shipping</p>
            <p className="mt-1">
              {shipping === "standard" 
                ? "Estimated delivery: 5-7 business days" 
                : "Estimated delivery: 2-3 business days"}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <MdOutlinePayment className="text-blue-600" />
            Payment Method
          </h3>
          <div className="text-sm text-gray-600">
            <p className="font-medium text-gray-900">Credit / Debit Card</p>
            <p className="mt-1">Payment will be processed securely</p>
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-800 flex items-center gap-2">
          <span>💡</span>
          Please review your information above before placing your order. You can go back to any step to make changes.
        </p>
      </div>
    </div>
  );
}
