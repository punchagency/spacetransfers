import { MdCreditCard, MdOutlineLocalShipping, MdCheckCircle } from "react-icons/md";
import { FaPaypal } from "react-icons/fa";
import { CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { apiFetch } from "../../lib/utils/api";
import { useEffect, useMemo, useState } from "react";
import { processFakePayment, validateCardNumber, validateExpiry, validateCVV } from "@/lib/utils/fakePayments";

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
  onCardCompleteChange?: (complete: boolean) => void;
  paypalData?: { paypalOrderId: string; paypalCaptureId: string } | null;
}

function StripeCardSection({
  mappedItems,
  shipping,
  customer,
  shippingAddress,
  onCardHandlerReady,
  onCardCompleteChange,
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
  onCardCompleteChange?: (complete: boolean) => void;
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
          onChange={(e) => {
            onCardCompleteChange?.(Boolean(e.complete));
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
  onCardCompleteChange,
  paypalData,
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
                onCardCompleteChange={onCardCompleteChange}
              />
            ) : (
              <FakeCardSection
                mappedItems={mappedItems}
                customer={customer}
                shippingAddress={shippingAddress}
                onCardHandlerReady={onCardHandlerReady}
                onCardCompleteChange={onCardCompleteChange}
              />
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
              {paypalData ? (
                <div className="flex items-center gap-3 text-green-700">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
                    <MdCheckCircle className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">PayPal Authorized</p>
                    <p className="text-xs">You can now proceed to review your order.</p>
                  </div>
                </div>
              ) : (
                <>
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
                </>
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

function FakeCardSection({
  mappedItems,
  customer,
  shippingAddress,
  onCardHandlerReady,
  onCardCompleteChange,
}: {
  mappedItems: any[];
  customer: { firstName: string; lastName: string; email: string; phone?: string };
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  onCardHandlerReady: (handler: (() => Promise<{ paymentIntentId: string }>) | null) => void;
  onCardCompleteChange?: (complete: boolean) => void;
}) {
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [name, setName] = useState(`${customer.firstName} ${customer.lastName}`.trim());
  const [errors, setErrors] = useState<{ [k: string]: string }>({});

  const amount = useMemo(() => {
    return mappedItems.reduce((sum, it) => sum + (it.unitPrice || 0) * (it.quantity || 1), 0);
  }, [mappedItems]);

  useEffect(() => {
    const valid =
      validateCardNumber(cardNumber).valid &&
      validateExpiry(expiry).valid &&
      validateCVV(cvv).valid &&
      name.trim().length > 1;
    onCardCompleteChange?.(valid);

    const next: { [k: string]: string } = {};
    if (cardNumber && !validateCardNumber(cardNumber).valid) next.cardNumber = "Enter a valid 16-digit card number";
    if (expiry && !validateExpiry(expiry).valid) next.expiry = "Use MM/YY and a future date";
    if (cvv && !validateCVV(cvv).valid) next.cvv = "3–4 digits";
    if (name && name.trim().length <= 1) next.name = "Cardholder name required";
    setErrors(next);
  }, [cardNumber, expiry, cvv, name, onCardCompleteChange]);

  useEffect(() => {
    const handler = async () => {
      const numInfo = validateCardNumber(cardNumber);
      const expInfo = validateExpiry(expiry);
      const cvvInfo = validateCVV(cvv);
      if (!numInfo.valid || !expInfo.valid || !cvvInfo.valid || name.trim().length <= 1) {
        throw new Error("Invalid payment details");
      }
      const result = await processFakePayment({
        cardNumber: numInfo.cleaned,
        expiry: expInfo.cleaned,
        cvv: cvvInfo.cleaned,
        name: name.trim(),
        amount,
        billing: {
          name: name.trim(),
          street: shippingAddress.street,
          city: shippingAddress.city,
          state: shippingAddress.state,
          postalCode: shippingAddress.postalCode,
          country: shippingAddress.country,
          email: customer.email,
        },
        items: mappedItems,
      });
      if (result.status !== "succeeded") {
        throw new Error(result.error || "Card was declined");
      }
      return { paymentIntentId: result.transactionId };
    };
    onCardHandlerReady(handler);
  }, [amount, cardNumber, expiry, cvv, name, mappedItems, onCardHandlerReady, customer.email, shippingAddress]);

  const formatCardNumber = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 16);
    return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
  };

  const formatExpiry = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 4);
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-600">Card Number</label>
            <input
              value={formatCardNumber(cardNumber)}
              onChange={(e) => setCardNumber(e.target.value)}
              inputMode="numeric"
              placeholder="1234 5678 9012 3456"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            {errors.cardNumber && <p className="text-xs text-red-600 mt-1">{errors.cardNumber}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600">Expiry (MM/YY)</label>
              <input
                value={formatExpiry(expiry)}
                onChange={(e) => setExpiry(e.target.value)}
                inputMode="numeric"
                placeholder="MM/YY"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              {errors.expiry && <p className="text-xs text-red-600 mt-1">{errors.expiry}</p>}
            </div>
            <div>
              <label className="text-xs text-gray-600">CVV</label>
              <input
                value={cvv}
                onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                inputMode="numeric"
                placeholder="123"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              {errors.cvv && <p className="text-xs text-red-600 mt-1">{errors.cvv}</p>}
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-gray-600">Name on Card</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
          </div>
        </div>
        <div className="mt-3 text-xs text-gray-500">
          Test cards: Use 4111 1111 1111 1111 (succeeds). Even last digit succeeds; odd fails. 9 simulates timeout.
        </div>
      </div>
    </div>
  );
}
