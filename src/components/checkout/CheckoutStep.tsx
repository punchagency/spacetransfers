import { BsPerson } from "react-icons/bs";
import { IoLocationOutline } from "react-icons/io5";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { IoMdCheckmarkCircleOutline } from "react-icons/io";
import { MdWarningAmber } from "react-icons/md";
import { DPI, UPLOAD_FORMAT_LABELS } from "../../config/artboard.config";
import { usePricingSettings } from "../../lib/utils/pricingRates";
import {
  cartLinePieces,
  describeWarning,
  summarizeCartWarnings,
  type SheetWarning,
} from "../../lib/utils/checkoutWarnings";
import { checkoutFieldError, checkoutFormErrors, type CheckoutField } from "../../lib/utils/checkoutValidation";
import { useTransparencyVerdicts } from "../artboard/lib/hooks/useTransparencyVerdicts";

const REGION_BY_STATE: Record<string, string> = {
  WA:"West",OR:"West",CA:"West",NV:"West",ID:"West",MT:"West",WY:"West",
  UT:"West",AZ:"West",NM:"West",CO:"West",AK:"West",HI:"West",
  ND:"Midwest",SD:"Midwest",NE:"Midwest",KS:"Midwest",MN:"Midwest",
  IA:"Midwest",MO:"Midwest",WI:"Midwest",IL:"Midwest",MI:"Midwest",
  IN:"Midwest",OH:"Midwest",
  TX:"South",OK:"South",AR:"South",LA:"South",MS:"South",AL:"South",
  TN:"South",KY:"South",WV:"South",VA:"South",NC:"South",SC:"South",
  GA:"South",FL:"South",MD:"South",DC:"South",DE:"South",
  PA:"Northeast",NY:"Northeast",VT:"Northeast",ME:"Northeast",
  NH:"Northeast",MA:"Northeast",RI:"Northeast",CT:"Northeast",NJ:"Northeast",
};

const REGION_COLORS: Record<string, string> = {
  West:      "bg-blue-50 text-blue-700 border-blue-200",
  Midwest:   "bg-amber-50 text-amber-700 border-amber-200",
  South:     "bg-green-50 text-green-700 border-green-200",
  Northeast: "bg-purple-50 text-purple-700 border-purple-200",
};

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

interface CheckoutStepProps {
  formData: FormData;
  setFormData: (data: FormData) => void;
  /**
   * Bumped each time Continue is pressed on an incomplete form, so every
   * field's problem shows at once — including fields never visited.
   */
  revealAttempt?: number;
  /** The cart, so the Design Validation card can report on its artwork. */
  cartItems?: any[];
  /** Standard or Express, shown under the address it is priced for. */
  shippingPicker?: ReactNode;
  /** Told what the artwork check found, so Continue can ask before going on. */
  onArtworkCheck?: (check: { warnings: SheetWarning[]; checking: boolean; sheetCount: number }) => void;
}

export default function CheckoutStep({
  formData,
  setFormData,
  revealAttempt = 0,
  cartItems = [],
  shippingPicker,
  onArtworkCheck,
}: CheckoutStepProps) {
  /*
   * Inline validation: a field's problem appears when the shopper leaves it,
   * not while they are still typing, and once shown it follows every keystroke
   * so it clears the moment the value is right. Errors used to exist only after
   * Continue, which stayed disabled until every field had something in it.
   */
  const [shown, setShown] = useState<Partial<Record<CheckoutField, string>>>({});

  useEffect(() => {
    if (revealAttempt > 0) setShown(checkoutFormErrors(formData));
    // Only a new attempt reveals everything; edits are handled per field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealAttempt]);

  const judge = (key: CheckoutField, value: string) =>
    setShown((prev) => ({ ...prev, [key]: checkoutFieldError(key, value) ?? undefined }));

  const field = (
    key: CheckoutField,
    label: string,
    opts: {
      type?: string;
      autoComplete?: string;
      inputMode?: "numeric" | "text";
      placeholder?: string;
      maxLength?: number;
      uppercase?: boolean;
      wrap?: string;
      transform?: (value: string) => string;
    } = {},
  ) => {
    const id = `checkout-${key}`;
    const error = shown[key];
    return (
      <div className={opts.wrap}>
        <label htmlFor={id} className="block text-sm font-medium mb-1">
          {label} <span className="text-red-500">*</span>
        </label>
        <input
          id={id}
          name={key}
          type={opts.type ?? "text"}
          autoComplete={opts.autoComplete}
          inputMode={opts.inputMode}
          placeholder={opts.placeholder}
          maxLength={opts.maxLength}
          value={formData[key]}
          onChange={(e) => {
            const value = opts.transform ? opts.transform(e.target.value) : e.target.value;
            setFormData({ ...formData, [key]: value });
            if (shown[key]) judge(key, value);
          }}
          onBlur={(e) => judge(key, e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`w-full px-3 py-2 border rounded-lg ${opts.uppercase ? "uppercase " : ""}${
            error ? "border-red-500" : "border-gray-300"
          } ${formData[key] ? "bg-[#F3F3F5]" : "bg-white"}`}
        />
        {error ? (
          <div id={`${id}-error`} className="mt-1 text-xs text-red-600">{error}</div>
        ) : null}
      </div>
    );
  };

  // Every piece on every sheet, for the same transparency check the artboard
  // runs (remembered per image, so pieces already checked there cost nothing).
  const pieces = useMemo(() => cartItems.flatMap(cartLinePieces), [cartItems]);
  const verdicts = useTransparencyVerdicts(pieces);
  const { warnings, checking } = useMemo(
    () => summarizeCartWarnings(cartItems, verdicts),
    [cartItems, verdicts],
  );
  const sheetCount = useMemo(
    () => cartItems.filter((line) => cartLinePieces(line).length > 0).length,
    [cartItems],
  );
  useEffect(() => {
    onArtworkCheck?.({ warnings, checking, sheetCount });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warnings, checking, sheetCount]);

  // The roll and the minimum are admin settings; the copy reads them rather than
  // stating numbers that go stale the moment either changes.
  const { sheetWidthIn, minSheetLengthIn } = usePricingSettings();
  const detectedRegion =
    formData.state.trim().length === 2
      ? REGION_BY_STATE[formData.state.trim().toUpperCase()] ?? null
      : null;

  return (
    <>
      <div className="bg-white rounded-lg border mb-5 border-gray-200 p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <BsPerson className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold">Customer Information</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field("firstName", "First Name", { autoComplete: "given-name" })}
          {field("lastName", "Last Name", { autoComplete: "family-name" })}
          {field("email", "Email Address", { type: "email", autoComplete: "email", wrap: "sm:col-span-2" })}
          {field("phone", "Phone Number", { type: "tel", autoComplete: "tel", wrap: "sm:col-span-2" })}
        </div>
      </div>

      <div className="bg-white rounded-lg border mb-5 border-gray-200 p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <IoLocationOutline className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold">Shipping Address</h3>
        </div>
        <div className="space-y-4">
          {field("street", "Street Address", { autoComplete: "address-line1" })}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field("city", "City", { autoComplete: "address-level2" })}
            {field("state", "State", {
              autoComplete: "address-level1",
              placeholder: "CA",
              maxLength: 2,
              uppercase: true,
              // Two-letter US state code only — mirrors printer signup.
              transform: (v) => v.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2),
            })}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field("postalCode", "ZIP Code", { autoComplete: "postal-code", inputMode: "numeric", placeholder: "97201" })}
            {field("country", "Country", { autoComplete: "country" })}
          </div>
        </div>
      </div>

      {shippingPicker}

      {detectedRegion && (
        <div className={`flex mb-4.5 items-center gap-2 px-4 py-2.5 rounded-lg border text-xs font-medium ${REGION_COLORS[detectedRegion] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}>
          <IoLocationOutline className="w-4 h-4 flex-shrink-0" />
          <span>Service Region: <strong>{detectedRegion}</strong> </span>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        {/* The badge used to say "Review Warnings" whatever the cart held. It now
            reports the artboard's own flags for the artwork being ordered. */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-normal text-[11px]">Design Validation</h3>
          {warnings.length > 0 ? (
            <span className="text-[11px] bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
              {warnings.length} {warnings.length === 1 ? "warning" : "warnings"}
            </span>
          ) : checking ? (
            <span className="text-[11px] bg-gray-100 text-gray-600 px-2 py-1 rounded">Checking…</span>
          ) : sheetCount > 0 ? (
            <span className="text-[11px] bg-green-100 text-green-800 px-2 py-1 rounded">No issues found</span>
          ) : null}
        </div>
        {warnings.length > 0 && (
          <div className="mb-4 space-y-1.5 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2.5">
            {warnings.map((w) => (
              <div key={`${w.sheet}-${w.kind}`} className="flex items-start gap-2 text-[11px] text-yellow-900">
                <MdWarningAmber className="mt-px h-4 w-4 shrink-0 text-yellow-600" />
                <span>{describeWarning(w, sheetCount)}</span>
              </div>
            ))}
            <p className="pt-0.5 text-[10.5px] text-yellow-800">
              You can still order as is. To fix these, go back to your cart and choose Edit sheet.
            </p>
          </div>
        )}
        <hr className="border-gray-200 mb-4" />
        <div className="space-y-2">
          <h4 className="font-normal text-[11px]">DTF Printing Guidelines</h4>
          {/*
            Every line here is read from where the rule actually lives. This used
            to promise a 12 x 16in print area (sheets are the roll width by any
            length), list four formats of the twelve accepted, ask for CMYK (the
            editor converts CMYK to RGB) and set a 150 DPI minimum the editor
            flags as low.
          */}
          <div className="space-y-2.5 text-sm text-gray-700">
            {/*
              The two rows the artwork is checked against follow that check.
              Every row wore a green tick, so "Transparency" was ticked on the
              same card that flagged fades a few lines above it.
            */}
            {[
              { text: `Sheet size: ${sheetWidthIn}" wide (the roll width), any length — billed from ${minSheetLengthIn}" minimum`, state: "ok" },
              {
                text: `Resolution: ${DPI.THRESHOLD} DPI for sharp prints — anything lower is flagged on your sheet`,
                state: warnings.some((w) => w.kind !== "transparency") ? "warn" : "ok",
              },
              { text: `Formats: ${UPLOAD_FORMAT_LABELS.join(", ")}`, state: "ok" },
              {
                text: "Transparency: fades and see-through areas don't print as shown — they're flagged on your sheet",
                state: warnings.some((w) => w.kind === "transparency") ? "warn" : checking ? "pending" : "ok",
              },
              { text: "Color: RGB — CMYK files are converted to RGB automatically", state: "ok" },
            ].map(({ text, state }) => (
              <div key={text} className="flex items-center text-[10px] gap-2">
                {state === "warn" ? (
                  <MdWarningAmber className="w-4 h-4 shrink-0 text-yellow-600" aria-label="Flagged" />
                ) : state === "pending" ? (
                  <IoMdCheckmarkCircleOutline className="w-4 h-4 shrink-0 text-gray-300" aria-label="Checking" />
                ) : (
                  <IoMdCheckmarkCircleOutline className="w-4 h-4 shrink-0 text-green-600" />
                )}
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
