import { BsPerson } from "react-icons/bs";
import { IoLocationOutline } from "react-icons/io5";
import { IoMdCheckmarkCircleOutline } from "react-icons/io";
import { DPI, UPLOAD_FORMAT_LABELS } from "../../config/artboard.config";
import { usePricingSettings } from "../../lib/utils/pricingRates";

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
  errors?: Partial<Record<keyof FormData, string>>;
}

export default function CheckoutStep({
  formData,
  setFormData,
  errors,
}: CheckoutStepProps) {
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
          <div>
            <label className="block text-sm font-medium mb-1">
              First Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.firstName}
              onChange={(e) =>
                setFormData({ ...formData, firstName: e.target.value })
              }
              className={`w-full px-3 py-2 border rounded-lg ${
                errors?.firstName ? "border-red-500" : "border-gray-300"
              } ${formData.firstName ? "bg-[#F3F3F5]" : "bg-white"}`}
            />
            {errors?.firstName ? (
              <div className="mt-1 text-xs text-red-600">{errors.firstName}</div>
            ) : null}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Last Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.lastName}
              onChange={(e) =>
                setFormData({ ...formData, lastName: e.target.value })
              }
              className={`w-full px-3 py-2 border rounded-lg ${
                errors?.lastName ? "border-red-500" : "border-gray-300"
              } ${formData.lastName ? "bg-[#F3F3F5]" : "bg-white"}`}
            />
            {errors?.lastName ? (
              <div className="mt-1 text-xs text-red-600">{errors.lastName}</div>
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium mb-1">
              Email Address <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
              className={`w-full px-3 py-2 border rounded-lg ${
                errors?.email ? "border-red-500" : "border-gray-300"
              } ${formData.email ? "bg-[#F3F3F5]" : "bg-white"}`}
            />
            {errors?.email ? (
              <div className="mt-1 text-xs text-red-600">{errors.email}</div>
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium mb-1">
              Phone Number <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) =>
                setFormData({ ...formData, phone: e.target.value })
              }
              className={`w-full px-3 py-2 border rounded-lg ${
                errors?.phone ? "border-red-500" : "border-gray-300"
              } ${formData.phone ? "bg-[#F3F3F5]" : "bg-white"}`}
            />
            {errors?.phone ? (
              <div className="mt-1 text-xs text-red-600">{errors.phone}</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border mb-5 border-gray-200 p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <IoLocationOutline className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold">Shipping Address</h3>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Street Address <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.street}
              onChange={(e) =>
                setFormData({ ...formData, street: e.target.value })
              }
              className={`w-full px-3 py-2 border rounded-lg ${
                errors?.street ? "border-red-500" : "border-gray-300"
              } ${formData.street ? "bg-[#F3F3F5]" : "bg-white"}`}
            />
            {errors?.street ? (
              <div className="mt-1 text-xs text-red-600">{errors.street}</div>
            ) : null}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                City <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) =>
                  setFormData({ ...formData, city: e.target.value })
                }
                className={`w-full px-3 py-2 border rounded-lg ${
                  errors?.city ? "border-red-500" : "border-gray-300"
                } ${formData.city ? "bg-[#F3F3F5]" : "bg-white"}`}
              />
              {errors?.city ? (
                <div className="mt-1 text-xs text-red-600">{errors.city}</div>
              ) : null}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                State / Province <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.state}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    // Two-letter US state code only — mirrors printer signup.
                    state: e.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2),
                  })
                }
                placeholder="CA"
                maxLength={2}
                className={`w-full px-3 py-2 border rounded-lg uppercase ${
                  errors?.state ? "border-red-500" : "border-gray-300"
                } ${formData.state ? "bg-[#F3F3F5]" : "bg-white"}`}
              />
              {errors?.state ? (
                <div className="mt-1 text-xs text-red-600">{errors.state}</div>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Postal Code <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.postalCode}
                onChange={(e) =>
                  setFormData({ ...formData, postalCode: e.target.value })
                }
                className={`w-full px-3 py-2 border rounded-lg ${
                  errors?.postalCode ? "border-red-500" : "border-gray-300"
                } ${formData.postalCode ? "bg-[#F3F3F5]" : "bg-white"}`}
              />
              {errors?.postalCode ? (
                <div className="mt-1 text-xs text-red-600">{errors.postalCode}</div>
              ) : null}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Country <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.country}
                onChange={(e) =>
                  setFormData({ ...formData, country: e.target.value })
                }
                className={`w-full px-3 py-2 border rounded-lg ${
                  errors?.country ? "border-red-500" : "border-gray-300"
                } ${formData.country ? "bg-[#F3F3F5]" : "bg-white"}`}
              />
              {errors?.country ? (
                <div className="mt-1 text-xs text-red-600">{errors.country}</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {detectedRegion && (
        <div className={`flex mb-4.5 items-center gap-2 px-4 py-2.5 rounded-lg border text-xs font-medium ${REGION_COLORS[detectedRegion] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}>
          <IoLocationOutline className="w-4 h-4 flex-shrink-0" />
          <span>Service Region: <strong>{detectedRegion}</strong> </span>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-normal text-[11px]">Design Validation</h3>
          <span className="text-[11px] bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
            Review Warnings
          </span>
        </div>
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
            {[
              `Sheet size: ${sheetWidthIn}" wide (the roll width), any length — billed from ${minSheetLengthIn}" minimum`,
              `Resolution: ${DPI.THRESHOLD} DPI for sharp prints — anything lower is flagged on your sheet`,
              `Formats: ${UPLOAD_FORMAT_LABELS.join(", ")}`,
              "Transparency: fades and see-through areas don't print as shown — they're flagged on your sheet",
              "Color: RGB — CMYK files are converted to RGB automatically",
            ].map((line) => (
              <div key={line} className="flex items-center text-[10px] gap-2">
                <IoMdCheckmarkCircleOutline className="w-4 h-4 shrink-0 text-green-600" />
                <span>{line}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
