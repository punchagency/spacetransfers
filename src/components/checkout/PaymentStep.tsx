import { MdCreditCard, MdOutlineLocalShipping } from "react-icons/md";
import { FaPaypal } from "react-icons/fa";
import { CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { apiFetch } from "../../lib/utils/api";
import { useEffect, useMemo } from "react";

interface PaymentStepProps {
  payment: "card" | "paypal";
  setPayment: (method: "card" | "paypal") => void;
  shipping: "standard" | "express";
  setShipping: (method: "standard" | "express") => void;
  cartItems: any[];
  customer: { firstName: string; lastName: string; email: string; phone?: string };
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  isSubmitting: boolean;
  onCardHandlerReady: (handler: (() => Promise<{ paymentIntentId: string }>) | null) => void;
  onPaypalCaptured: (data: { paypalOrderId: string; paypalCaptureId: string }) => void;
  paypalClientId?: string;
  stripeEnabled: boolean;
}

function StripeCardSection({
  mappedItems,
  shipping,
  customer,
  shippingAddress,
  onCardHandlerReady,
}: {
  mappedItems: any[];
  shipping: "standard" | "express";
  customer: { firstName: string; lastName: string; email: string; phone?: string };
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  onCardHandlerReady: (handler: (() => Promise<{ paymentIntentId: string }>) | null) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();

  const cardHandler = useMemo(() => {
    return async () => {
      if (!stripe || !elements) {
        throw new Error("Card payments are not ready yet");
      }

      const card = elements.getElement(CardElement);
      if (!card) {
        throw new Error("Card input is missing");
      }

      const intent = await apiFetch("/customer/payments/stripe/create-intent", {
        method: "POST",
        body: JSON.stringify({
          items: mappedItems,
          shippingMethod: shipping,
        }),
      });

      const clientSecret = intent?.clientSecret;
      const paymentIntentId = intent?.paymentIntentId;
      if (!clientSecret || !paymentIntentId) {
        throw new Error("Failed to initialize card payment");
      }

      const confirm = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card,
          billing_details: {
            name: `${customer.firstName} ${customer.lastName}`.trim(),
            email: customer.email,
            phone: customer.phone,
            address: {
              line1: shippingAddress.street,
              city: shippingAddress.city,
              state: shippingAddress.state,
              postal_code: shippingAddress.postalCode,
              country: shippingAddress.country,
            },
          },
        },
      });

      if (confirm.error) {
        throw new Error(confirm.error.message || "Card payment failed");
      }

      if (confirm.paymentIntent?.status !== "succeeded") {
        throw new Error("Card payment was not completed");
      }

      return { paymentIntentId };
    };
  }, [
    customer.email,
    customer.firstName,
    customer.lastName,
    customer.phone,
    elements,
    mappedItems,
    shipping,
    shippingAddress.city,
    shippingAddress.country,
    shippingAddress.postalCode,
    shippingAddress.state,
    shippingAddress.street,
    stripe,
  ]);

  useEffect(() => {
    onCardHandlerReady(cardHandler);
    return () => onCardHandlerReady(null);
  }, [cardHandler, onCardHandlerReady]);

  return (
    <div className=" space-y-4 mt-4">
      <div className="rounded-lg border border-gray-200 bg-white px-3 py-3">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: "14px",
                color: "#111827",
                fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
                "::placeholder": { color: "#9CA3AF" },
              },
            },
          }}
        />
      </div>
      {!stripe || !elements ? (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
          Card payments are not configured yet.
        </div>
      ) : null}
    </div>
  );
}

export default function PaymentStep({
  payment,
  setPayment,
  shipping,
  setShipping,
  cartItems,
  customer,
  shippingAddress,
  isSubmitting,
  onCardHandlerReady,
  onPaypalCaptured,
  paypalClientId,
  stripeEnabled,
}: PaymentStepProps) {
  const mappedItems = cartItems.map((item) => ({
    type: item.type || "gangsheet",
    designId: item.designId || item.id?.toString(),
    name: item.name || "Gang Sheet",
    widthIn: item.widthIn || 0,
    heightIn: item.heightIn || 0,
    quantity: item.quantity || item.copies || 1,
    unitPrice: item.price || 0,
  }));

  useEffect(() => {
    if (payment !== "card") onCardHandlerReady(null);
  }, [onCardHandlerReady, payment]);

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
            stripeEnabled ? (
              <StripeCardSection
                mappedItems={mappedItems}
                shipping={shipping}
                customer={customer}
                shippingAddress={shippingAddress}
                onCardHandlerReady={onCardHandlerReady}
              />
            ) : (
              <div className="mt-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Card payments are not configured yet.
              </div>
            )
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
                Complete your payment with PayPal to place your order.
              </p>
              {paypalClientId ? (
                <PayPalScriptProvider options={{ clientId: paypalClientId, currency: "USD", intent: "capture" }}>
                  <PayPalButtons
                    style={{ layout: "vertical" }}
                    disabled={isSubmitting}
                    createOrder={async () => {
                      const result = await apiFetch("/customer/payments/paypal/create-order", {
                        method: "POST",
                        body: JSON.stringify({
                          items: mappedItems,
                          shippingMethod: shipping,
                        }),
                      });
                      const id = result?.paypalOrderId;
                      if (!id) throw new Error("Failed to create PayPal order");
                      return id;
                    }}
                    onApprove={async (data) => {
                      const captured = await apiFetch("/customer/payments/paypal/capture-order", {
                        method: "POST",
                        body: JSON.stringify({ paypalOrderId: data.orderID }),
                      });
                      if (!captured?.paypalCaptureId) {
                        throw new Error("Failed to capture PayPal payment");
                      }
                      onPaypalCaptured({
                        paypalOrderId: data.orderID,
                        paypalCaptureId: captured.paypalCaptureId,
                      });
                    }}
                  />
                </PayPalScriptProvider>
              ) : (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  PayPal is not configured yet.
                </div>
              )}
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
