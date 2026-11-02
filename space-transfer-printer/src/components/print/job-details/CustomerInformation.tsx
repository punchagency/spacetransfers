import { FiUser, FiMail, FiPhone, FiMapPin } from "react-icons/fi";
import { AddressCheckNote, type AddressCheck } from "./AddressCheckNote";

interface CustomerInformationProps {
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    region: string | null;
  };
  shippingAddress:
    | {
        street?: string;
        city?: string;
        state?: string;
        postalCode?: string;
        country?: string;
        check?: AddressCheck | null;
      }
    | null;
}

export const CustomerInformation = ({ customer, shippingAddress }: CustomerInformationProps) => {
  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
      <h3 className="text-base font-bold text-gray-900 mb-3">
        Customer Information
      </h3>
      <div className="space-y-3">
        <div className="flex gap-2.5">
          <div className="w-4 h-4 text-gray-500 mt-0.5">
            <FiUser className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="text-[10px] text-gray-500">Customer Name</div>
            <div className="text-xs font-medium text-gray-900">
              {customer.name}
            </div>
          </div>
        </div>
        <div className="flex gap-2.5">
          <div className="w-4 h-4 text-gray-500 mt-0.5">
            <FiMail className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="text-[10px] text-gray-500">Email</div>
            <div className="text-xs font-medium text-gray-900">
              {customer.email || "N/A"}
            </div>
          </div>
        </div>
        <div className="flex gap-2.5">
          <div className="w-4 h-4 text-gray-500 mt-0.5">
            <FiPhone className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="text-[10px] text-gray-500">Phone</div>
            <div className="text-xs font-medium text-gray-900">
              {customer.phone || "N/A"}
            </div>
          </div>
        </div>
        <div className="flex gap-2.5">
          <div className="w-4 h-4 text-gray-500 mt-0.5">
            <FiMapPin className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="text-[10px] text-gray-500">Shipping Address</div>
            <div className="text-xs font-medium text-gray-900">
              {shippingAddress ? (
                <>
                  <div>{shippingAddress.street || "N/A"}</div>
                  <div>
                    {(shippingAddress.city || "N/A")}, {(shippingAddress.state || "N/A")}{" "}
                    {shippingAddress.postalCode || ""}
                  </div>
                  <div>{shippingAddress.country || "N/A"}</div>
                  <AddressCheckNote check={shippingAddress.check} />
                </>
              ) : (
                "N/A"
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center">
        <span className="text-[10px] text-gray-500">Region</span>
        <span className="text-[10px] font-medium bg-gray-100 px-2 py-0.5 rounded text-gray-600">
          {customer.region || "N/A"}
        </span>
      </div>
    </div>
  );
};
