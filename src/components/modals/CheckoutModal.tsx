import { useState, useEffect, useRef, Fragment } from "react";
import { gsap } from "gsap";
import { MdClose, MdCheckCircle, MdArrowBack } from "react-icons/md";
import { isValidPhone } from "../../lib/utils/validators";
import CartStep from "../checkout/CartStep";
import CheckoutStep from "../checkout/CheckoutStep";
import PaymentStep from "../checkout/PaymentStep";
import ReviewStep from "../checkout/ReviewStep";
import OrderSummary from "../checkout/OrderSummary";
import { ErrorBoundary } from "../common/ErrorBoundary";
import ConfirmModal from "./ConfirmModal";
import { LuShoppingCart } from "react-icons/lu";
import { apiFetch } from "../../lib/utils/api";
import { stripEmbeddedImages, hasEmbeddedImages } from "../../lib/utils/payloadImages";
import { itemListsEquivalent } from "../../lib/utils/assetIdentity";
import { AssetIndex } from "../../lib/utils/assetTable";
import { resolveFlowCols } from "../artboard/lib/utils/layoutHelpers";
import { getSheetWidthIn } from "../../lib/utils/pricingRates";
import { DEFAULT_SHEET_SETTINGS } from "../../lib/utils/editorSettings";
import toast from "react-hot-toast";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { formatOrderNumber } from "../../lib/utils/orderNumber";

const stripePublishableKey = (import.meta as any).env?.VITE_STRIPE_PUBLISHABLE_KEY as
  | string
  | undefined;
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null;

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems?: any[];
  onUpdateCart?: (items: any[]) => void;
  /** Puts a cart sheet back on the artboard, so edits update that same line. */
  onEditSheet?: (item: any) => void;
  /** Empties the cart at its owner. Doing it in here alone was lost if this modal closed. */
  onClearCart?: () => void;
  /** Clears the artboard for another sheet, leaving the cart as it is. */
  onStartNewSheet?: () => void;
  onCheckoutSuccess?: () => void;
  /**
   * Whether the visitor has an account yet.
   *
   * Browsing and filling a cart do not need one — that is how storefronts work,
   * and Add to Cart has always allowed it. Placing the order does: it is saved
   * against a customer, paid for, and shipped somewhere. Without this the
   * signed-out path ran all the way to payment and failed on a 401 from the
   * order call, after the customer had entered an address.
   */
  isLoggedIn?: boolean;
  onRequireSignIn?: () => void;
}

const steps = ["Cart", "Checkout", "Payment", "Confirmation"];

export default function CheckoutModal({
  isOpen,
  onClose,
  isLoggedIn = false,
  onRequireSignIn,
  cartItems: initialCartItems,
  onUpdateCart,
  onEditSheet,
  onClearCart,
  onStartNewSheet,
  onCheckoutSuccess,
}: CheckoutModalProps) {
  const [step, setStep] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // True only while `placeOrder`'s `stripEmbeddedImages` safety net is doing
  // real (uncached) upload work — the pre-warm effect below normally means
  // this never actually flips, but when it does, the button should say why
  // it's taking longer rather than sitting on a generic "Processing...".
  const [finalizingArtwork, setFinalizingArtwork] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const stepperRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [payment, setPayment] = useState<"card">("card");
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
  const [orderId, setOrderId] = useState<string | null>(null);
  // The canonical DTF-#### number the customer will see everywhere else.
  const [orderDisplayId, setOrderDisplayId] = useState<string | null>(null);

  /**
   * Resolves any leftover embedded artwork as soon as checkout opens, rather
   * than waiting for the "Place Order" click to discover it.
   *
   * `placeOrder` already calls `stripEmbeddedImages` as a safety net — the
   * artboard uploads as it edits, so this is normally a no-op — but on the
   * rare path where it isn't (mid-upload checkout, an earlier failed upload),
   * that safety net used to run for the first time on submit, so the customer
   * discovered a slow or failing upload only after clicking the button that
   * was supposed to place their order in under 5 seconds.
   *
   * `toHostedUrl`'s cache is keyed by URL and process-lifetime, so calling it
   * here costs nothing extra later: by the time `placeOrder` runs its own
   * `stripEmbeddedImages`, every image resolved here is a cache hit. A
   * failure here is swallowed deliberately — this is a warm-up, not a gate,
   * and `placeOrder`'s own call is what actually decides whether checkout can
   * proceed; surfacing an error twice for the same cause would be confusing.
   */
  useEffect(() => {
    if (!isOpen) return;
    stripEmbeddedImages({ items: cartItems }).catch(() => {});
    // Intentionally keyed to `isOpen` alone: this is a one-shot warm-up per
    // checkout session, not something that should re-fire on every cart edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const subtotal = Number(
    cartItems
      .reduce(
        (sum, item) =>
          sum + (item.price || 0) * (item.quantity || item.copies || 1),
        0,
      )
      .toFixed(2),
  );
  /**
   * Shipping and tax rates come from the server so the total shown here is the
   * total that gets charged.
   *
   * These were hardcoded — express $19.99 and tax always 0 — while the server
   * charged $24.99 plus 8%. On a $100 express order the customer saw $119.99
   * and was charged $132.99.
   *
   * The fallback matches the server's own default, so a failed fetch shows a
   * plausible figure rather than $0 shipping; the server recomputes on submit
   * either way, so it can never be the figure actually charged.
   */
  const [rates, setRates] = useState<{
    shipping: { standard: number; express: number };
    taxRatePct: number;
    rushSurchargePct: number;
  }>({ shipping: { standard: 8.99, express: 24.99 }, taxRatePct: 8, rushSurchargePct: 10 });

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    apiFetch("/customer/pricing")
      .then((r) => {
        if (cancelled || !r?.shipping) return;
        setRates({
          shipping: {
            standard: Number(r.shipping.standard),
            express: Number(r.shipping.express),
          },
          taxRatePct: Number(r.taxRatePct),
          rushSurchargePct: Number(r.rushSurchargePct ?? 10),
        });
      })
      .catch(() => {
        // Non-fatal: keep the fallback rates. The server is authoritative at
        // submit, so a stale display cannot become a wrong charge.
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const shippingCost = Number(
    (shipping === "standard" ? rates.shipping.standard : rates.shipping.express).toFixed(2),
  );
  /**
   * Express means the job is rushed through production, not just posted faster —
   * so it carries a surcharge that pays the partner for jumping the queue. The
   * express price itself only pays the courier.
   */
  const rushSurcharge = Number(
    (shipping === "express" ? subtotal * (rates.rushSurchargePct / 100) : 0).toFixed(2),
  );
  const tax = Number(((subtotal + rushSurcharge) * (rates.taxRatePct / 100)).toFixed(2));
  const total = Number((subtotal + rushSurcharge + shippingCost + tax).toFixed(2));

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

    /*
     * Shape checked, not just presence — the same gap email had until the line
     * above was written. `req("phone", ...)` only ever tested truthiness, so
     * "1" or "abc" passed straight through and became the number on a real
     * order, which is what a partner or the store calls when a shipment needs
     * attention.
     */
    const phone = String(formData.phone || "").trim();
    if (phone && !isValidPhone(phone)) {
      errors.phone = "Enter a valid phone number";
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

  // Card requires a configured provider AND a complete card. The previous form
  // of this check reduced to `isCardComplete` on both branches, so an
  // unconfigured environment could still advance to placing an order.
  const isPaymentValid = Boolean(stripePromise && isCardComplete);

  const mapItems = () =>
    cartItems.map((item) => {
      const isGangsheet = (item.type || "gangsheet") === "gangsheet";
      /**
       * One table of distinct URLs per sheet; placements reference it by index.
       *
       * A gang sheet repeats the same few graphics many times, and each
       * placement previously carried its own full copy of the artwork URL —
       * twice, as `assetId` and `croppedUrl`. At ~121 chars each that is ~242
       * bytes of pure repetition per placement, which put a large sheet over
       * the body limit on its own. Interning makes the payload scale with
       * distinct artwork (typically 5–50 URLs) instead of placement count.
       */
      const assets = new AssetIndex();

      const artboardItems = isGangsheet && Array.isArray((item as any).items)
        ? (item as any).items.map((it: any) => ({
            id: Number(it.id),
            // Integer references into `assetTable.urls`, resolved server-side.
            assetRef: assets.ref(it.assetId || it.originalUrl || it.url || ""),
            // Prefer the dedicated export URL (croppedUrl); fall back to the display URL.
            // croppedUrl is set by the drop handler and canvas operations and always holds
            // a full-resolution source (Cloudinary URL or native-res canvas PNG data URL).
            croppedRef: assets.ref(
              typeof it.croppedUrl === "string" && it.croppedUrl
                ? it.croppedUrl
                : typeof it.url === "string" ? it.url : "",
            ),
            // Pixel dimensions of the croppedUrl source — lets the server compute exact DPI
            // for canvas-processed items without querying the DB (which stores the larger
            // pre-crop original, not the canvas-cropped dimensions).
            croppedWidthPx: typeof it.croppedWidthPx === "number" && it.croppedWidthPx > 0 ? it.croppedWidthPx : undefined,
            croppedHeightPx: typeof it.croppedHeightPx === "number" && it.croppedHeightPx > 0 ? it.croppedHeightPx : undefined,
            autoCrop: typeof it.autoCrop === "boolean" ? it.autoCrop : undefined,
            widthIn: Number(it.widthIn),
            heightIn: Number(it.heightIn),
            posX: Number(it.posX),
            posY: Number(it.posY),
            rotation: typeof it.rotation === "number" ? it.rotation : 0,
            flipped: Boolean(it.flipped),
            copies: typeof it.copies === "number" ? it.copies : 1,
            linked: Boolean(it.linked),
            // How auto-nest laid the piece out. Without these the print export
            // drew nested pieces upright and wrapped copies its own way.
            nestRotation: it.nestRotation === 90 ? 90 : 0,
            flowCols: resolveFlowCols(
              it,
              // The roll this sheet was built on, recorded on the cart line.
              (item as any).widthIn || getSheetWidthIn(),
              (item as any).sheetMarginIn ?? DEFAULT_SHEET_SETTINGS.marginSize,
              (item as any).itemSpacingIn ?? DEFAULT_SHEET_SETTINGS.spacing,
            ),
          }))
        : undefined;

      return {
        name: item.name || "Gang Sheet",
        widthIn: item.widthIn || 0,
        heightIn: item.heightIn || 0,
        quantity: item.quantity || item.copies || 1,
        unitPrice: item.price || 0,
        designId: item.designId || item.id?.toString(),
        type: item.type || "gangsheet",
        sheetWidthIn: isGangsheet ? (item.widthIn || 0) : undefined,
        sheetHeightIn: isGangsheet ? (item.heightIn || 0) : undefined,
        previewImage: isGangsheet ? ((item as any).image || undefined) : undefined,
        artboardItems: artboardItems && artboardItems.length > 0 ? artboardItems : undefined,
        // Absent when there is nothing to reference; the server then falls back
        // to the inline-URL shape.
        assetTable: assets.size > 0 ? assets.table() : undefined,
        itemSpacingIn: isGangsheet ? ((item as any).itemSpacingIn ?? undefined) : undefined,
        sheetMarginIn: isGangsheet ? ((item as any).sheetMarginIn ?? undefined) : undefined,
      };
    });

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

    /**
     * Safety net, not the mechanism.
     *
     * The artboard uploads canvas results as they are produced, and the
     * pre-warm effect above already resolves any stragglers as soon as
     * checkout opens, so by now this normally finds nothing and returns
     * immediately. It covers the cases that beat even that — the customer
     * moved through checkout faster than a slow upload could finish — and is
     * awaited rather than fire-and-forget because an order must never be
     * submitted with artwork the print pipeline cannot resolve.
     *
     * The button's label only changes when there is real, uncached work to
     * do — checked structurally, not by attempting the upload and seeing how
     * long it takes, so a fast cache hit never flickers the label.
     */
    const stillEmbedded = hasEmbeddedImages(payload);
    if (stillEmbedded) setFinalizingArtwork(true);
    let safePayload;
    try {
      safePayload = await stripEmbeddedImages(payload);
    } finally {
      if (stillEmbedded) setFinalizingArtwork(false);
    }

    const result = await apiFetch("/customer/orders", {
      method: "POST",
      body: JSON.stringify(safePayload),
    });

    if (result?.id) {
      setOrderId(result.id);
      setOrderDisplayId(result.displayId || null);
    }
    setStep(4);
    if (onCheckoutSuccess) {
      onCheckoutSuccess();
    }
  };

  const handleNextStep = async () => {
    if (isSubmitting) return;

    if (step === 0) {
      if (!isCartValid) {
        toast.error("Your cart is empty.");
        return;
      }
      /*
       * Asked for here, at the edge of checkout — not earlier. The cart survives
       * the sign-in, so nothing is lost by leaving it this late, and a visitor
       * can price a sheet and fill a basket without being stopped.
       */
      if (!isLoggedIn) {
        toast("Please sign in to complete your order.", { icon: "🔐" });
        onRequireSignIn?.();
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
      if (!isPaymentValid) {
        toast.error("Please enter complete card details.");
        return;
      }

      setStep(3);
      return;
    }

    if (step === 3) {
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
    // Structural comparison rather than `JSON.stringify(a) !== JSON.stringify(b)`.
    // Cart rows carry artwork as `data:` URLs, so serializing two carts just to
    // compare them built strings past V8's ~512 MB cap and threw
    // `RangeError: Invalid string length` — on a path that only ever needed to
    // answer "did this change?".
    if (initialCartItems && !itemListsEquivalent(initialCartItems, cartItems)) {
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
    // Same substitution, and the more dangerous of the two: this effect is
    // keyed to `cartItems`, so it re-serialized the entire cart twice on every
    // quantity tweak and every item removal.
    if (onUpdateCart && !itemListsEquivalent(initialCartItems, cartItems)) {
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

  const handleContinueDesigning = () => {
    setStep(0);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isSubmitting) {
      // Don't trigger if target is a button or link (already handles Enter)
      if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) {
        return;
      }
      handleNextStep();
    }
  };
 
  return (
    <div
      onClick={onClose}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center px-2 py-4 md:p-0 bg-black/20 backdrop-blur-xs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-6xl overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 sm:h-10 sm:w-10 flex-shrink-0 items-center justify-center rounded-full bg-black">
              <LuShoppingCart className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-gray-900">
                {step === 0 ? "Cart" : "Checkout"}
              </h2>
              <p className="text-xs sm:text-sm text-gray-500">
                Complete your gang sheet order
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {step > 0 && step < 4 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="Go back"
              >
                <MdArrowBack className="h-5 w-5" />
              </button>
            )}
            {step < 4 ? (
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
        {step < 4 && (
          <div className="flex items-center justify-center border-b border-gray-100 bg-gray-50/50 py-4 md:py-6">
            {steps.map((s, i) => (
              <Fragment key={s}>
                <div className="flex flex-col items-center">
                  <div
                    ref={(el) => (stepperRefs.current[i] = el)}
                    className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold transition-all duration-300 ${
                      i < step
                        ? "border-green-500 bg-green-500 text-white"
                        : i === step
                          ? "border-blue-600 bg-black text-white"
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
                  <div className="relative h-0.5 w-8 sm:w-16 mb-6">
                    <div className="absolute inset-0 bg-gray-200" />
                    <div
                      ref={(el) => (lineRefs.current[i] = el)}
                      className="absolute inset-0 bg-black origin-left"
                      style={{ transform: i < step ? "scaleX(1)" : "scaleX(0)" }}
                    />
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="p-4 md:p-6 max-h-[68dvh] md:max-h-[70vh] overflow-y-auto">
          <ErrorBoundary>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
              <div className={`${isCartEmpty || step === 4 ? 'lg:col-span-3' : 'lg:col-span-2'} space-y-6`}>
                <div ref={contentRef}>
                  {step === 0 && (
                    <CartStep
                      cartItems={cartItems}
                      updateQuantity={updateQuantity}
                      removeItem={removeItem}
                      onEditItem={onEditSheet ? (item) => onEditSheet(item) : undefined}
                      onClearCart={() => setConfirmClear(true)}
                      onStartNewSheet={onStartNewSheet ? () => { onClose(); onStartNewSheet(); } : undefined}
                    />
                  )}

                  {step === 1 && (
                    <CheckoutStep
                      formData={formData}
                      setFormData={setFormData}
                      errors={checkoutErrors as any}
                      cartItems={cartItems}
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
                          stripeEnabled={true}
                          onCardCompleteChange={setIsCardComplete}
                          onCardHandlerReady={(handler) => {
                            cardHandlerRef.current = handler;
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
                        stripeEnabled={false}
                        onCardCompleteChange={setIsCardComplete}
                        onCardHandlerReady={(handler) => {
                          cardHandlerRef.current = handler;
                        }}
                      />
                    ))
                  )}

                  {step === 3 && (
                    <ReviewStep
                      formData={formData}
                      shipping={shipping}
                      payment={payment}
                    />
                  )}

                  {step === 4 && (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="mb-6 rounded-full bg-green-100 p-6 animate-bounce">
                        <MdCheckCircle className="h-20 w-20 text-green-500" />
                      </div>
                      <h2 className="mb-2 text-2xl sm:text-3xl font-extrabold text-gray-900">
                        Order Placed Successfully!
                      </h2>
                      {orderId && (
                        <div className="mb-4 text-sm sm:text-lg font-medium text-black bg-black/10 px-4 py-1 rounded-full border border-blue-100">
                          Order {formatOrderNumber(orderDisplayId, orderId)}
                        </div>
                      )}
                      <p className="mb-8 max-w-md text-gray-600">
                        Thank you for your purchase! We've received your order and will begin processing it right
                        away. A confirmation email has been sent to <strong>{formData.email}</strong>.
                      </p>
                      <div className="flex flex-col sm:flex-row gap-4">
                        <button
                          onClick={handleContinueDesigning}
                          className="flex items-center justify-center gap-2 rounded-lg bg-black px-10 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:bg-blue-700 hover:scale-105"
                        >
                          Continue Designing
                        </button>  
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {!isCartEmpty && step < 4 && (
                <div className="lg:col-span-1">
                  {step === 0 ? (
                    <div className="bg-white rounded-lg border border-gray-200 p-6 sticky top-6">
                      <h2 className="text-base sm:text-lg font-semibold mb-6">CART SUMMARY</h2>

                      <div className="border-t border-gray-200 pt-4 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Subtotal</span>
                          <span className="font-medium">
                            ${subtotal.toFixed(2)}
                          </span>
                        </div>
                        {rushSurcharge > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Rush production</span>
                            <span className="font-medium">
                              ${rushSurcharge.toFixed(2)}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Shipping</span>
                          <span className="font-medium">
                            ${shippingCost.toFixed(2)}
                          </span>
                        </div>
                        {/*
                          Tax was charged and never shown, so Subtotal plus
                          Shipping did not add up to the Total on screen — the
                          difference just appeared, unexplained, at checkout.
                        */}
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Tax</span>
                          <span className="font-medium">
                            ${tax.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between text-lg font-semibold pt-2 border-t border-gray-200">
                          <span>Total</span>
                          <span>${total.toFixed(2)}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => setStep(1)}
                        className="w-full mt-4 rounded-lg bg-black py-3 text-sm font-semibold text-white hover:bg-gray-900"
                      >
                        Proceed to Checkout
                      </button>
                      {/* The way back to the artboard, where the rest of the order is built. */}
                      <button
                        onClick={handleContinueDesigning}
                        className="w-full mt-2 rounded-lg border border-gray-300 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50"
                      >
                        Continue designing
                      </button>
                    </div>
                  ) : (
                    <OrderSummary
                      cartItems={cartItems}
                      step={step}
                      subtotal={subtotal}
                      shippingCost={shippingCost}
                      total={total}
                      onNext={handleNextStep}
                      isSubmitting={isSubmitting}
                      submittingLabel={finalizingArtwork ? "Finalizing artwork…" : undefined}
                      disableNext={
                        (step === 0 && !isCartValid) ||
                        (step === 1 && !isCheckoutValid) ||
                        (step === 2 && !isPaymentValid)
                      }
                      nextLabel={
                        step === 2 && !stripePromise
                          ? "Payment not available yet"
                          : step === 2 && !isPaymentValid
                          ? "Enter card details"
                          : step === 3
                            ? "Place Order"
                            : undefined
                      }
                    />
                  )}
                </div>
              )}
            </div>
          </ErrorBoundary>
        </div>
      </div>
      {/* Its own layer: a click inside it used to bubble to the backdrop above,
          closing checkout before the emptied cart reached its owner. */}
      <div onClick={(e) => e.stopPropagation()}>
        <ConfirmModal
          isOpen={confirmClear}
          title="Clear your cart?"
          message="Every sheet in the cart will be removed. Sheets you saved as designs are kept."
          confirmLabel="Clear cart"
          danger
          onConfirm={() => {
            setConfirmClear(false);
            setCartItems([]);
            onClearCart?.();
          }}
          onCancel={() => setConfirmClear(false)}
        />
      </div>
    </div>
  );
}
