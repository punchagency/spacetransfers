import { useState, useEffect, useRef, Fragment } from "react";
import { gsap } from "gsap";
import { MdClose, MdCheckCircle } from "react-icons/md";
import CartStep from "../checkout/CartStep";
import CheckoutStep from "../checkout/CheckoutStep";
import PaymentStep from "../checkout/PaymentStep";
import OrderSummary from "../checkout/OrderSummary";
import { LuShoppingCart } from "react-icons/lu";
interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems?: any[];
}

const steps = ["Cart", "Checkout", "Payment", "Confirmation"];

export default function CheckoutModal({
  isOpen,
  onClose,
  cartItems: initialCartItems,
}: CheckoutModalProps) {
  const [step, setStep] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const stepperRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [payment, setPayment] = useState<"card" | "paypal">("card");
  const [shipping, setShipping] = useState<"standard" | "express">("standard");
  const [cartItems, setCartItems] = useState(initialCartItems || []);
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
  const [cardData, setCardData] = useState({
    cardNumber: "",
    expiry: "",
    cvv: "",
    cardName: "",
  });

  const subtotal = cartItems.reduce(
    (sum, item) =>
      sum + (item.price || 0) * (item.quantity || item.copies || 1),
    0,
  );
  const shippingCost = shipping === "standard" ? 8.99 : 24.99;
  const tax = subtotal * 0.08;
  const total = subtotal + shippingCost + tax;

  useEffect(() => {
    if (initialCartItems) {
      setCartItems(initialCartItems);
    }
  }, [initialCartItems]);

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
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-center gap-2 border-b border-gray-200 px-6 py-4">
          {steps.map((s, i) => (
            <Fragment key={s}>
              <div className="flex flex-col items-center">
                <div
                  ref={(el) => (stepperRefs.current[i] = el)}
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold transition-colors duration-300 ${
                    i <= step
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-600"
                  }`}
                >
                  {i + 1}
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
            <div className="lg:col-span-2 space-y-6">
              <div ref={contentRef}>
                {step === 0 && (
                  <CartStep
                    cartItems={cartItems}
                    updateQuantity={updateQuantity}
                    removeItem={removeItem}
                  />
                )}

                {step === 1 && (
                  <CheckoutStep formData={formData} setFormData={setFormData} />
                )}

                {step === 2 && (
                  <PaymentStep
                    payment={payment}
                    setPayment={setPayment}
                    shipping={shipping}
                    setShipping={setShipping}
                    formData={cardData}
                    setFormData={setCardData}
                  />
                )}

                {step === 3 && (
                  <div className="flex flex-col items-center justify-center py-12">
                    <MdCheckCircle className="h-16 w-16 text-green-500 mb-4" />
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">
                      Order Confirmed
                    </h2>
                    <p className="text-gray-600 mb-6">
                      Your order has been placed successfully.
                    </p>
                    <button
                      onClick={onClose}
                      className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      Close
                    </button>
                  </div>
                )}
              </div>
            </div>

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
                    <p className="text-xs text-gray-500">
                      Delivery fees not included yet.
                    </p>
                    <div className="flex justify-between text-lg font-semibold pt-2">
                      <span>Total</span>
                      <span>${subtotal.toFixed(2)}</span>
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
                  total={total}
                  onNext={() => setStep(step + 1)}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
