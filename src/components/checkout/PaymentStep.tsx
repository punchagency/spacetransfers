import { MdCreditCard } from "react-icons/md";
import { CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { apiFetch } from "../../lib/utils/api";
import { toPricedItems } from "../../lib/utils/checkoutQuote";
import { useEffect, useMemo } from "react";

interface PaymentStepProps {
  payment: "card";
  setPayment: (method: "card") => void;
  /** Chosen on the Checkout step; sent so the charge is priced for it. */
  shipping: "standard" | "express";
  cartItems: any[];
  customer: { firstName: string; lastName: string; email: string; phone?: string };
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  onCardHandlerReady: (handler: (() => Promise<{ paymentIntentId: string }>) | null) => void;
  stripeEnabled: boolean;
  onCardCompleteChange?: (complete: boolean) => void;
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
          // Sent so the intent is priced from the same live carrier quote the
          // order will use; without it the two disagree on shipping.
          shippingAddress,
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
  cartItems,
  customer,
  shippingAddress,
  onCardHandlerReady,
  stripeEnabled,
  onCardCompleteChange,
}: PaymentStepProps) {
  const mappedItems = useMemo(() => toPricedItems(cartItems), [cartItems]);

  useEffect(() => {
    if (payment !== "card") {
      onCardHandlerReady(null);
      return;
    }
    // No payment provider configured: there is no handler that could take a
    // payment, and the card can never report itself complete — so clear both
    // and leave checkout blocked.
    if (!stripeEnabled) {
      onCardHandlerReady(null);
      onCardCompleteChange?.(false);
    }
  }, [onCardHandlerReady, onCardCompleteChange, payment, stripeEnabled]);

  return (
    <>
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
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
              /**
               * No Stripe key configured, so there is no way to take a payment.
               * This says so and blocks checkout, rather than collecting card
               * details a mock would "approve" — an order that reaches
               * fulfilment against a payment that never happened is far more
               * expensive than a blocked checkout.
               */
              <CardUnavailable />
            )
          )}
        </div>

        <p className="text-xs text-center text-gray-500 mt-4">
          By providing your payment information, you agree to our Terms of
          Service and Privacy Policy. Your payment is protected by
          industry-standard encryption.
        </p>
      </div>

    </>
  );
}

/**
 * Shown in place of the card form when no Stripe key is configured. Purely
 * presentational — PaymentStep clears the card handler and the complete flag,
 * which is what actually keeps checkout blocked.
 */
function CardUnavailable() {
  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="font-medium text-amber-900 text-sm">
        Online payment isn't switched on yet
      </div>
      <p className="mt-1 text-sm text-amber-800">
        Your gang sheet is saved and stays in your cart, so nothing is lost.
        You'll be able to complete this order as soon as card payments are
        turned on.
      </p>
    </div>
  );
}
