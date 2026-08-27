import { useMemo, useState } from 'react';
import { FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { apiFetch } from '../../utils/api';
import { REGIONS } from "../../utils/regions";


const FORMATS = ['PNG', 'PDF', 'TIFF', 'JPG'];

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export const AddPartnerModal = ({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}) => {
  const [partnerName, setPartnerName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [regions, setRegions] = useState<string[]>([]);
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [postalCode, setPostalCode] = useState('');

  const [maxSheetWidth, setMaxSheetWidth] = useState('24');
  const [maxSheetHeight, setMaxSheetHeight] = useState('19.5');
  const [formats, setFormats] = useState<string[]>(['PNG', 'PDF', 'TIFF']);
  const [maxDPI, setMaxDPI] = useState('1200');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const validation = useMemo(() => {
    const errors: Record<string, string> = {};

    if (!partnerName.trim()) errors.partnerName = 'Partner name is required';
    if (!contactName.trim()) errors.contactName = 'Contact name is required';
    if (!email.trim()) errors.email = 'Email is required';
    else if (!isValidEmail(email)) errors.email = 'Enter a valid email';
    if (!phone.trim()) errors.phone = 'Phone is required';
    if (!street.trim()) errors.street = 'Street is required';
    if (!city.trim()) errors.city = 'City is required';
    // Two letters, because `getRegionFromState` and the distance centroid both
    // key on the US state code — anything else silently yields no region.
    if (!/^[A-Z]{2}$/.test(stateCode.trim())) errors.stateCode = 'Two-letter state code, e.g. CA';
    if (!postalCode.trim()) errors.postalCode = 'Postal code is required';
    if (regions.length === 0) errors.regions = 'Select at least one service area';

    const w = Number(maxSheetWidth);
    const h = Number(maxSheetHeight);
    const dpi = Number(maxDPI);

    if (!Number.isFinite(w) || w <= 0) errors.maxSheetWidth = 'Width must be a positive number';
    if (!Number.isFinite(h) || h <= 0) errors.maxSheetHeight = 'Height must be a positive number';
    if (!Number.isFinite(dpi) || dpi < 72 || dpi > 2400) errors.maxDPI = 'DPI must be between 72 and 2400';
    if (formats.length === 0) errors.formats = 'Select at least one format';

    return { errors, isValid: Object.keys(errors).length === 0 };
  }, [partnerName, contactName, email, phone, street, city, stateCode, postalCode,
      regions, maxSheetWidth, maxSheetHeight, maxDPI, formats]);

  const toggleRegion = (region: string) => {
    setRegions((prev) => (prev.includes(region) ? prev.filter((r) => r !== region) : [...prev, region]));
  };

  const toggleFormat = (format: string) => {
    setFormats((prev) => (prev.includes(format) ? prev.filter((f) => f !== format) : [...prev, format]));
  };

  const resetForm = () => {
    setPartnerName('');
    setContactName('');
    setEmail('');
    setPhone('');
    setRegions([]);
    setStreet('');
    setCity('');
    setStateCode('');
    setPostalCode('');
    setMaxSheetWidth('24');
    setMaxSheetHeight('19.5');
    setFormats(['PNG', 'PDF', 'TIFF']);
    setMaxDPI('1200');
    setTouched({});
  };

  const handleClose = () => {
    if (isSubmitting) return;
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    setTouched({
      partnerName: true,
      contactName: true,
      email: true,
      phone: true,
      regions: true,
      maxSheetWidth: true,
      maxSheetHeight: true,
      formats: true,
      maxDPI: true,
    });

    if (!validation.isValid) return;

    setIsSubmitting(true);
    try {
      await apiFetch('/admin/partners', {
        method: 'POST',
        body: JSON.stringify({
          partnerName: partnerName.trim(),
          contactName: contactName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          regions,
          capabilities: {
            maxSheetSizeIn: { width: Number(maxSheetWidth), height: Number(maxSheetHeight) },
            formats,
            maxDPI: Number(maxDPI),
          },
          address: {
            street: street.trim(),
            city: city.trim(),
            state: stateCode.trim().toUpperCase(),
            postalCode: postalCode.trim(),
            country: 'US',
          },
          status: 'Pending',
        }),
      });
      toast.success('Partner created');
      resetForm();
      onCreated();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create partner');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const errorFor = (field: string) => (touched[field] ? validation.errors[field] : undefined);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-xs transition-opacity"
        onClick={handleClose}
      />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Add New Partner</h2>
            <p className="text-xs text-gray-500 mt-0.5">Create a fulfilment partner account and configure service areas and capabilities.</p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600"
          >
            <FiX className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-bold text-gray-900">
                Partner Name <span className="text-red-500">*</span>
              </label>
              <input
                value={partnerName}
                onChange={(e) => setPartnerName(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, partnerName: true }))}
                className={`w-full px-4 py-3 bg-gray-50 border rounded-xl text-sm font-medium text-gray-900 outline-none focus:bg-white transition-all ${errorFor('partnerName') ? 'border-red-300 focus:border-red-400' : 'border-transparent focus:border-blue-500'}`}
                placeholder="FastPrint LA"
              />
              {errorFor('partnerName') && <p className="text-xs text-red-600">{errorFor('partnerName')}</p>}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-bold text-gray-900">
                Contact Name <span className="text-red-500">*</span>
              </label>
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, contactName: true }))}
                className={`w-full px-4 py-3 bg-gray-50 border rounded-xl text-sm font-medium text-gray-900 outline-none focus:bg-white transition-all ${errorFor('contactName') ? 'border-red-300 focus:border-red-400' : 'border-transparent focus:border-blue-500'}`}
                placeholder="John Smith"
              />
              {errorFor('contactName') && <p className="text-xs text-red-600">{errorFor('contactName')}</p>}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-bold text-gray-900">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                value={email}
                type="email"
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                className={`w-full px-4 py-3 bg-gray-50 border rounded-xl text-sm font-medium text-gray-900 outline-none focus:bg-white transition-all ${errorFor('email') ? 'border-red-300 focus:border-red-400' : 'border-transparent focus:border-blue-500'}`}
                placeholder="contact@fastprintla.com"
              />
              {errorFor('email') && <p className="text-xs text-red-600">{errorFor('email')}</p>}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-bold text-gray-900">
                Phone <span className="text-red-500">*</span>
              </label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                className={`w-full px-4 py-3 bg-gray-50 border rounded-xl text-sm font-medium text-gray-900 outline-none focus:bg-white transition-all ${errorFor('phone') ? 'border-red-300 focus:border-red-400' : 'border-transparent focus:border-blue-500'}`}
                placeholder="+1 (555) 123-4567"
              />
              {errorFor('phone') && <p className="text-xs text-red-600">{errorFor('phone')}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-gray-900">
                Service Areas <span className="text-red-500">*</span>
              </label>
              <span className="text-xs text-gray-400">{regions.length} selected</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {REGIONS.map((region) => {
                const selected = regions.includes(region);
                return (
                  <button
                    type="button"
                    key={region}
                    onClick={() => toggleRegion(region)}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors text-left ${selected ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                  >
                    {region}
                  </button>
                );
              })}
            </div>
            {errorFor('regions') && <p className="text-xs text-red-600">{errorFor('regions')}</p>}
          </div>


          {/*
            Collected because three systems silently degrade without it: the
            shipping-rate origin, the ShipStation label's ship-from, and the
            nearest-partner ranking (which sorts on a state centroid and treats
            a missing state as infinitely far away).
          */}
          <div className="border-t border-gray-100 pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">Business Address</h3>
              <p className="text-xs text-gray-400">Where orders ship from</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-bold text-gray-900">
                Street <span className="text-red-500">*</span>
              </label>
              <input
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, street: true }))}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="1200 S Figueroa St"
              />
              {errorFor('street') && <p className="text-xs text-red-600">{errorFor('street')}</p>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-bold text-gray-900">
                  City <span className="text-red-500">*</span>
                </label>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, city: true }))}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  placeholder="Los Angeles"
                />
                {errorFor('city') && <p className="text-xs text-red-600">{errorFor('city')}</p>}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-bold text-gray-900">
                  State <span className="text-red-500">*</span>
                </label>
                <input
                  value={stateCode}
                  onChange={(e) => setStateCode(e.target.value.toUpperCase().slice(0, 2))}
                  onBlur={() => setTouched((t) => ({ ...t, stateCode: true }))}
                  maxLength={2}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium uppercase outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  placeholder="CA"
                />
                {errorFor('stateCode') && <p className="text-xs text-red-600">{errorFor('stateCode')}</p>}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-bold text-gray-900">
                  Postal Code <span className="text-red-500">*</span>
                </label>
                <input
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, postalCode: true }))}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  placeholder="90017"
                />
                {errorFor('postalCode') && <p className="text-xs text-red-600">{errorFor('postalCode')}</p>}
              </div>
            </div>
          </div>
          <div className="border-t border-gray-100 pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">Fulfillment Capabilities</h3>
              <p className="text-xs text-gray-400">Used for routing and validation</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                  Max Sheet Width (in)
                </label>
                <input
                  value={maxSheetWidth}
                  onChange={(e) => setMaxSheetWidth(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, maxSheetWidth: true }))}
                  className={`w-full px-4 py-3 bg-gray-50 border rounded-xl text-sm font-medium text-gray-900 outline-none focus:bg-white transition-all ${errorFor('maxSheetWidth') ? 'border-red-300 focus:border-red-400' : 'border-transparent focus:border-blue-500'}`}
                />
                {errorFor('maxSheetWidth') && <p className="text-xs text-red-600">{errorFor('maxSheetWidth')}</p>}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                  Max Sheet Height (in)
                </label>
                <input
                  value={maxSheetHeight}
                  onChange={(e) => setMaxSheetHeight(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, maxSheetHeight: true }))}
                  className={`w-full px-4 py-3 bg-gray-50 border rounded-xl text-sm font-medium text-gray-900 outline-none focus:bg-white transition-all ${errorFor('maxSheetHeight') ? 'border-red-300 focus:border-red-400' : 'border-transparent focus:border-blue-500'}`}
                />
                {errorFor('maxSheetHeight') && <p className="text-xs text-red-600">{errorFor('maxSheetHeight')}</p>}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                  Max Resolution (DPI)
                </label>
                <input
                  value={maxDPI}
                  onChange={(e) => setMaxDPI(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, maxDPI: true }))}
                  className={`w-full px-4 py-3 bg-gray-50 border rounded-xl text-sm font-medium text-gray-900 outline-none focus:bg-white transition-all ${errorFor('maxDPI') ? 'border-red-300 focus:border-red-400' : 'border-transparent focus:border-blue-500'}`}
                />
                {errorFor('maxDPI') && <p className="text-xs text-red-600">{errorFor('maxDPI')}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                  Supported Formats
                </label>
                <span className="text-xs text-gray-400">{formats.length} selected</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {FORMATS.map((fmt) => {
                  const selected = formats.includes(fmt);
                  return (
                    <button
                      type="button"
                      key={fmt}
                      onClick={() => toggleFormat(fmt)}
                      className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${selected ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                    >
                      {fmt}
                    </button>
                  );
                })}
              </div>
              {errorFor('formats') && <p className="text-xs text-red-600">{errorFor('formats')}</p>}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 shrink-0">
          <button
            onClick={handleClose}
            className="flex-1 py-3 px-4 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20 disabled:opacity-60 disabled:hover:bg-blue-600"
            disabled={isSubmitting || !validation.isValid}
          >
            {isSubmitting ? 'Creating...' : 'Create Partner'}
          </button>
        </div>
      </div>
    </div>
  );
};

