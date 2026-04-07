import { useState, useEffect, useRef, Fragment } from "react";
import { gsap } from "gsap";
import { MdClose, MdCheckCircle, MdArrowBack } from "react-icons/md";
import CartStep from "../checkout/CartStep";
import CheckoutStep from "../checkout/CheckoutStep";
import PaymentStep from "../checkout/PaymentStep";
import OrderSummary from "../checkout/OrderSummary";
import { LuShoppingCart } from "react-icons/lu";
import { apiFetch } from "../../lib/utils/api";
import toast from "react-hot-toast";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

const stripePublishableKey = (import.meta as any).env?.VITE_STRIPE_PUBLISHABLE_KEY as
  | string
  | undefined;
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null;
const paypalClientId = (import.meta as any).env?.VITE_PAYPAL_CLIENT_ID as string | undefined;

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems?: any[];
  onUpdateCart?: (items: any[]) => void;
  onCheckoutSuccess?: () => void;
}

const steps = ["Cart", "Checkout", "Payment", "Confirmation"];

export default function CheckoutModal({
  isOpen,
  onClose,
  cartItems: initialCartItems,
  onUpdateCart,
  onCheckoutSuccess,
}: CheckoutModalProps) {
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const stepperRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [payment, setPayment] = useState<"card" | "paypal">("card");
  const [shipping, setShipping] = useState<"standard" | "express">("standard");
  const [cartItems, setCartItems] = useState(initialCartItems || []);
  const [checkoutErrors, setCheckoutErrors] = useState<Record<string, string>>({});
  const [isCardComplete, setIsCardComplete] = useState(false);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    street: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
  });
  const cardHandlerRef = useRef<null | (() => Promise<{ paymentIntentId: string }>)>(null);

  const subtotal = Number(
    cartItems
      .reduce(
        (sum, item) =>
          sum + (item.price || 0) * (item.quantity || item.copies || 1),
        0,
      )
      .toFixed(2),
  );
  const shippingCost = shipping === "standard" ? 8.99 : 19.99;
  const taxRate = formData.country === "United States" || formData.country === "US" || !formData.country ? 0.094 : 0;
  const tax = Number((subtotal * taxRate).toFixed(2));
  const total = Number((subtotal + shippingCost + tax).toFixed(2));

  const validateCheckout = () => {
    const errors: Record<string, string> = {};
    const req = (key: keyof typeof formData, label: string) => {
      if (!String(formData[key] || "").trim()) errors[key] = `${label} is required`;
    };
    req("firstName", "First name");
    req("lastName", "Last name");
    req("email", "Email");
    req("phone", "Phone number");
    req("street", "Street address");
    req("city", "City");
    req("state", "State / Province");
    req("postalCode", "Postal code");
    req("country", "Country");

    const email = String(formData.email || "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = "Enter a valid email address";
    }

    setCheckoutErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const isCartValid = cartItems.length > 0;
  const isCheckoutValid = Object.keys(checkoutErrors).length === 0 && Boolean(
    formData.firstName.trim() &&
      formData.lastName.trim() &&
      formData.email.trim() &&
      formData.phone.trim() &&
      formData.street.trim() &&
      formData.city.trim() &&
      formData.state.trim() &&
      formData.postalCode.trim() &&
      (formData.country || "US").trim(),
  );

  const isPaymentValid =
    payment === "paypal"
      ? false
      : Boolean(stripePromise && isCardComplete);

  const mapItems = () =>
    cartItems.map((item) => ({
      name: item.name || "Gang Sheet",
      widthIn: item.widthIn || 0,
      heightIn: item.heightIn || 0,
      quantity: item.quantity || item.copies || 1,
      unitPrice: item.price || 0,
      designId: item.designId || item.id?.toString(),
      type: item.type || "gangsheet",
    }));

  const placeOrder = async (paymentPayload: any) => {
    const payload = {
      items: mapItems(),
      customer: {
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        phone: formData.phone || undefined,
      },
      shippingAddress: {
        street: formData.street,
        city: formData.city,
        state: formData.state,
        postalCode: formData.postalCode,
        country: formData.country || "US",
      },
      shippingMethod: shipping,
      payment: paymentPayload,
      pricing: {
        subtotal,
        shippingCost,
        tax,
        total,
        currency: "USD",
      },
    };

    await apiFetch("/customer/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    setStep(3);
    if (onCheckoutSuccess) {
      onCheckoutSuccess();
    }
  };

  const handleNextStep = async () => {
    if (step === 0) {
      if (!isCartValid) {
        toast.error("Your cart is empty.");
        return;
      }
      setStep(1);
      return;
    }

    if (step === 1) {
      const ok = validateCheckout();
      if (!ok) {
        toast.error("Please complete all required checkout fields.");
        return;
      }
      setStep(step + 1);
      return;
    }

    if (step === 2) {
      if (payment === "paypal") {
        toast.error("Complete PayPal payment to place your order");
        return;
      }

      if (!isPaymentValid) {
        toast.error("Please enter complete card details.");
        return;
      }

      setIsSubmitting(true);
      try {
        const handler = cardHandlerRef.current;
        if (!handler) {
          throw new Error("Card payment is not configured");
        }

        const { paymentIntentId } = await handler();
        await placeOrder({ method: "card", paymentIntentId });
      } catch (err: any) {
        toast.error(err.message || "Failed to place order");
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  useEffect(() => {
    if (initialCartItems && JSON.stringify(initialCartItems) !== JSON.stringify(cartItems)) {
      setCartItems(initialCartItems);
    }
  }, [initialCartItems]);

  useEffect(() => {
    if (Object.keys(checkoutErrors).length === 0) return;
    const next: Record<string, string> = { ...checkoutErrors };
    const trim = (v: any) => String(v || "").trim();
    if (trim(formData.firstName)) delete next.firstName;
    if (trim(formData.lastName)) delete next.lastName;
    if (trim(formData.email) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trim(formData.email))) delete next.email;
    if (trim(formData.phone)) delete next.phone;
    if (trim(formData.street)) delete next.street;
    if (trim(formData.city)) delete next.city;
    if (trim(formData.state)) delete next.state;
    if (trim(formData.postalCode)) delete next.postalCode;
    if (trim(formData.country || "US")) delete next.country;
    if (Object.keys(next).length !== Object.keys(checkoutErrors).length) {
      setCheckoutErrors(next);
    }
  }, [checkoutErrors, formData]);

  const updateQuantity = (id: number, change: number) => {
    setCartItems((items) =>
      items.map((item) => {
        if (item.id === id) {
          const currentQty = item.quantity || item.copies || 1;
          const newQty = Math.max(1, currentQty + change);
          return { ...item, quantity: newQty, copies: newQty };
        }
        return item;
      }),
    );
  };

  const removeItem = (id: number) => {
    setCartItems((items) => items.filter((item) => item.id !== id));
  };

  useEffect(() => {
    if (onUpdateCart && JSON.stringify(initialCartItems) !== JSON.stringify(cartItems)) {
      onUpdateCart(cartItems);
    }
  }, [cartItems, onUpdateCart]);

  useEffect(() => {
    if (contentRef.current) {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0, x: 20 },
        { opacity: 1, x: 0, duration: 0.4, ease: "power2.out" },
      );
    }

    // Animate stepper circles
    stepperRefs.current.forEach((ref, i) => {
      if (ref && i === step) {
        gsap.fromTo(
          ref,
          { scale: 0.8 },
          { scale: 1, duration: 0.3, ease: "back.out(1.7)" },
        );
      }
    });

    // Animate connecting lines
    lineRefs.current.forEach((ref, i) => {
      if (ref && i < step) {
        gsap.to(ref, {
          scaleX: 1,
          duration: 0.4,
          ease: "power2.out",
        });
      }
    });
  }, [step]);

  if (!isOpen) return null;

  const isCartEmpty = !cartItems || cartItems.length === 0;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-xs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-6xl overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600">
              <LuShoppingCart className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {step === 0 ? "Cart" : "Checkout"}
              </h2>
              <p className="text-sm text-gray-500">
                Complete your gang sheet order
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {step < 3 ? (
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <MdClose className="h-5 w-5" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-center border-b border-gray-100 bg-gray-50/50 py-6">
          {steps.map((s, i) => (
            <Fragment key={s}>
              <div className="flex flex-col items-center">
                <div
                  ref={(el) => (stepperRefs.current[i] = el)}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold transition-all duration-300 ${
                    i < step
                      ? "border-green-500 bg-green-500 text-white"
                      : i === step
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-gray-300 bg-white text-gray-400"
                  }`}
                >
                  {i < step ? (
                    <MdCheckCircle className="h-5 w-5" />
                  ) : (
                    <span>{i + 1}</span>
                  )}
                </div>
                <span
                  className={`mt-2 text-xs font-medium ${
                    i <= step ? "text-gray-900" : "text-gray-400"
                  }`}
                >
                  {s}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className="relative h-0.5 w-16 mb-6">
                  <div className="absolute inset-0 bg-gray-200" />
                  <div
                    ref={(el) => (lineRefs.current[i] = el)}
                    className="absolute inset-0 bg-blue-600 origin-left"
                    style={{ transform: i < step ? "scaleX(1)" : "scaleX(0)" }}
                  />
                </div>
              )}
            </Fragment>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className={`${isCartEmpty ? 'lg:col-span-3' : 'lg:col-span-2'} space-y-6`}>
              <div ref={contentRef}>
                {step === 0 && (
                  <CartStep
                    cartItems={cartItems}
                    updateQuantity={updateQuantity}
                    removeItem={removeItem}
                  />
                )}

                {step === 1 && (
                  <CheckoutStep
                    formData={formData}
                    setFormData={setFormData}
                    errors={checkoutErrors as any}
                  />
                )}

                {step === 2 && (
                  (stripePromise ? (
                    <Elements stripe={stripePromise}>
                      <PaymentStep
                        payment={payment}
                        setPayment={setPayment}
                        shipping={shipping}
                        setShipping={setShipping}
                        cartItems={cartItems}
                        customer={{
                          firstName: formData.firstName,
                          lastName: formData.lastName,
                          email: formData.email,
                          phone: formData.phone || undefined,
                        }}
                        shippingAddress={{
                          street: formData.street,
                          city: formData.city,
                          state: formData.state,
                          postalCode: formData.postalCode,
                          country: formData.country || "US",
                        }}
                        isSubmitting={isSubmitting}
                        stripeEnabled={true}
                        paypalClientId={paypalClientId}
                        onCardCompleteChange={setIsCardComplete}
                        onCardHandlerReady={(handler) => {
                          cardHandlerRef.current = handler;
                        }}
                        onPaypalCaptured={async ({ paypalOrderId, paypalCaptureId }) => {
                          setIsSubmitting(true);
                          try {
                            await placeOrder({
                              method: "paypal",
                              paypalOrderId,
                              paypalCaptureId,
                            });
                          } catch (err: any) {
                            toast.error(err?.message || "Failed to place order");
                          } finally {
                            setIsSubmitting(false);
                          }
                        }}
                      />
                    </Elements>
                  ) : (
                    <PaymentStep
                      payment={payment}
                      setPayment={setPayment}
                      shipping={shipping}
                      setShipping={setShipping}
                      cartItems={cartItems}
                      customer={{
                        firstName: formData.firstName,
                        lastName: formData.lastName,
                        email: formData.email,
                        phone: formData.phone || undefined,
                      }}
                      shippingAddress={{
                        street: formData.street,
                        city: formData.city,
                        state: formData.state,
                        postalCode: formData.postalCode,
                        country: formData.country || "US",
                      }}
                      isSubmitting={isSubmitting}
                      stripeEnabled={false}
                      paypalClientId={paypalClientId}
                      onCardCompleteChange={setIsCardComplete}
                      onCardHandlerReady={(handler) => {
                        cardHandlerRef.current = handler;
                      }}
                      onPaypalCaptured={async ({ paypalOrderId, paypalCaptureId }) => {
                        setIsSubmitting(true);
                        try {
                          await placeOrder({
                            method: "paypal",
                            paypalOrderId,
                            paypalCaptureId,
                          });
                        } catch (err: any) {
                          toast.error(err?.message || "Failed to place order");
                        } finally {
                          setIsSubmitting(false);
                        }
                      }}
                    />
                  ))
                )}

                {step === 3 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="mb-4 rounded-full bg-green-100 p-4">
                      <MdCheckCircle className="h-16 w-16 text-green-500" />
                    </div>
                    <h2 className="mb-2 text-2xl font-bold text-gray-900">
                      Thank you for your order!
                    </h2>
                    <p className="mb-8 max-w-md text-gray-600">
                      We've received your order and will begin processing it right
                      away. You'll receive a confirmation email shortly.
                    </p>
                    <button
                      onClick={onClose}
                      className="rounded-lg bg-blue-600 px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                    >
                      Continue Shopping
                    </button>
                  </div>
                )}
              </div>
            </div>

            {!isCartEmpty && (
              <div className="lg:col-span-1">
                {step === 0 ? (
                  <div className="bg-white rounded-lg border border-gray-200 p-6 sticky top-6">
                    <h2 className="text-lg font-semibold mb-6">CART SUMMARY</h2>

                    <div className="border-t border-gray-200 pt-4 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Subtotal</span>
                        <span className="font-medium">
                          ${subtotal.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Shipping</span>
                        <span className="font-medium">
                          ${shippingCost.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Tax ({(taxRate * 100).toFixed(1)}%)</span>
                        <span className="font-medium">${tax.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-lg font-semibold pt-2 border-t border-gray-200">
                        <span>Total</span>
                        <span>${total.toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="mt-4 text-xs text-gray-600">
                      Returns are easy! Free return within 7 days for items in
                      original condition.
                    </div>

                    <button
                      onClick={() => setStep(1)}
                      className="w-full mt-4 rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      Proceed to Checkout
                    </button>
                  </div>
                ) : (
                  <OrderSummary
                    cartItems={cartItems}
                    step={step}
                    subtotal={subtotal}
                    shippingCost={shippingCost}
                    tax={tax}
                    taxRate={taxRate}
                    total={total}
                    onNext={handleNextStep}
                    isSubmitting={isSubmitting}
                    disableNext={
                      (step === 0 && !isCartValid) ||
                      (step === 1 && !isCheckoutValid) ||
                      (step === 2 && payment === "paypal") ||
                      (step === 2 && payment === "card" && !isPaymentValid)
                    }
                    nextLabel={
                      step === 2 && payment === "paypal"
                        ? "Complete with PayPal"
                        : step === 2 && payment === "card" && !isPaymentValid
                          ? "Enter card details"
                          : undefined
                    }
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
