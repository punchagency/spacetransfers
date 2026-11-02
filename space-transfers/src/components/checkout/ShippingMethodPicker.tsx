import { MdOutlineLocalShipping } from "react-icons/md";
import type { ShippingMethod } from "../../lib/utils/checkoutQuote";

interface ShippingOption {
  /** What shipping costs for this method — the live quote once there is one. */
  price: number;
  /** The carrier service, e.g. "USPS Ground Advantage", when quoted live. */
  service?: string | null;
}

interface ShippingMethodPickerProps {
  shipping: ShippingMethod;
  setShipping: (method: ShippingMethod) => void;
  standard: ShippingOption;
  express: ShippingOption;
  /** The rush production fee's rate and what it comes to on this cart. */
  rushSurchargePct: number;
  rushSurcharge: number;
  /** True until the address is in and the server has priced it. */
  estimated: boolean;
}

/**
 * Standard or Express (an urgent order), chosen on the Checkout step.
 *
 * It sat on the Payment step, after the address, with prices written into the
 * markup ($8.99 / $24.99) whatever the admin had set or the carrier quoted —
 * and the rush fee Express adds was never mentioned before the total moved.
 */
export default function ShippingMethodPicker({
  shipping,
  setShipping,
  standard,
  express,
  rushSurchargePct,
  rushSurcharge,
  estimated,
}: ShippingMethodPickerProps) {
  const option = (
    method: ShippingMethod,
    icon: string,
    title: string,
    blurb: string,
    eta: string,
    { price, service }: ShippingOption,
    extra?: string,
  ) => (
    <label
      className={`border-2 rounded-lg p-4 flex gap-3 cursor-pointer ${
        shipping === method ? "border-blue-600 bg-blue-50" : "border-gray-200"
      }`}
    >
      <input
        type="radio"
        name="shipping-method"
        checked={shipping === method}
        onChange={() => setShipping(method)}
        className="h-4 w-4 mt-1"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <img src={icon} alt="" className="h-5 w-5" />
          <div className="font-normal">{title}</div>
        </div>
        <div className="text-sm text-gray-600">{blurb}</div>
        <div className="text-xs text-gray-500 mt-1">
          {eta}
          {service ? ` · ${service}` : ""}
        </div>
        {extra ? <div className="text-xs text-amber-700 mt-1">{extra}</div> : null}
      </div>
      <div className="font-semibold text-right whitespace-nowrap">
        ${price.toFixed(2)}
        {estimated ? <div className="text-[10px] font-normal text-gray-500">estimate</div> : null}
      </div>
    </label>
  );

  return (
    <div className="bg-white rounded-lg border mb-5 border-gray-200 p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <MdOutlineLocalShipping className="w-5 h-5 text-blue-600" />
        <h3 className="text-base font-semibold">Shipping Method</h3>
      </div>

      <div className="space-y-3">
        {option(
          "standard",
          "/box.svg",
          "Standard Shipping",
          "Reliable delivery with tracking",
          "Estimated delivery: 5-7 business days",
          standard,
        )}
        {option(
          "express",
          "/Icon.svg",
          "Express Shipping",
          // Express moves the job to the front of the partner's queue as well
          // as shipping faster, which is what the rush fee pays for.
          "Urgent order: jumps the print queue, then ships on a faster service",
          "Estimated delivery: 2-3 business days",
          express,
          rushSurchargePct > 0
            ? `Adds a ${rushSurchargePct}% rush production fee${rushSurcharge > 0 ? ` (+$${rushSurcharge.toFixed(2)})` : ""}`
            : undefined,
        )}
      </div>

      <div className="mt-4 border-t border-gray-200 pt-4">
        <h4 className="text-sm font-medium text-gray-800 mb-2">Shipping Information</h4>
        <div className="text-xs text-gray-600 space-y-1">
          <p>• All orders include a tracking number</p>
          <p>• Shipping times are estimates and may vary</p>
          <p>• DTF transfers take 1-2 business days to produce</p>
          <p>• We ship within the United States only</p>
        </div>
      </div>
    </div>
  );
}
