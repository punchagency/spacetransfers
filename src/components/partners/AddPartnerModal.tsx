import { useMemo, useState } from 'react';
import { FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { apiFetch } from '../../utils/api';
import { REGIONS } from "../../utils/regions";

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

  const [isSubmitting, setIsSubmitting] = useState(false);
  /*
   * Shown only when the invitation could not be emailed. It is the single copy
   * of that link — the database stores a hash of the token, never the token —
   * so if this is dismissed without being passed on, the partner needs a fresh
   * invitation.
   */
  const [inviteFallbackUrl, setInviteFallbackUrl] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const validation = useMemo(() => {
    const errors: Record<string, string> = {};

    if (!partnerName.trim()) errors.partnerName = 'Partner name is required';
    if (!email.trim()) errors.email = 'Email is required';
    else if (!isValidEmail(email)) errors.email = 'Enter a valid email';
    // Two letters, because `getRegionFromState` and the distance centroid both
    // key on the US state code — anything else silently yields no region.
    if (stateCode.trim() && !/^[A-Z]{2}$/.test(stateCode.trim())) {
      errors.stateCode = 'Two-letter state code, e.g. CA';
    }

    return { errors, isValid: Object.keys(errors).length === 0 };
    // Only these three are validated now: name and email are required, and a
    // state code, if given, must be a real one.
  }, [partnerName, email, stateCode]);

  const toggleRegion = (region: string) => {
    setRegions((prev) => (prev.includes(region) ? prev.filter((r) => r !== region) : [...prev, region]));
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
    setTouched({});
  };

  const handleClose = () => {
    if (isSubmitting) return;
    resetForm();
    /*
     * Cleared on close, not in `resetForm` — that runs immediately after a
     * successful create, and clearing there would wipe the link before it was
     * ever shown. Clearing here stops a previous partner's invitation appearing
     * above a blank form the next time the modal opens.
     */
    setInviteFallbackUrl(null);
    onClose();
  };

  const handleSubmit = async () => {
    setTouched({
      partnerName: true,
      contactName: true,
      email: true,
      phone: true,
      regions: true,
    });

    if (!validation.isValid) return;

    setIsSubmitting(true);
    try {
      const created = await apiFetch('/admin/partners', {
        method: 'POST',
        body: JSON.stringify({
          partnerName: partnerName.trim(),
          contactName: contactName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          regions,
          address: {
            street: street.trim(),
            city: city.trim(),
            state: stateCode.trim().toUpperCase(),
            postalCode: postalCode.trim(),
            country: 'US',
          },
        }),
      });

      if (created?.invite && created.invite.sent === false) {
        toast.error(
          `Partner created, but the invitation email could not be sent (${created.invite.reason}). ` +
            `They cannot set a password until they receive their link.`,
          { duration: 12000 },
        );
        if (created.invite.url) {
          // Surfaced so it can be passed on by hand while email is down. It is
          // the only copy — nothing stores the link, only its hash.
          setInviteFallbackUrl(created.invite.url);
        }
      } else {
        toast.success('Partner created — invitation sent');
      }

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
            <p className="text-xs text-gray-500 mt-0.5">The partner fills in the rest themselves once they set their password.</p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 hover:text-gray-600"
          >
            <FiX className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-bold text-gray-900">
                Partner Name <span className="text-red-600">*</span>
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
                Contact Name
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
                Email <span className="text-red-600">*</span>
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
                Phone
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
                Service Areas
              </label>
              <span className="text-xs text-gray-500">{regions.length} selected</span>
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
              <p className="text-xs text-gray-500">Where orders ship from</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-bold text-gray-900">
                Street
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
                  City
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
                  State
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
                  Postal Code
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
        </div>

        {inviteFallbackUrl && (
          <div className="px-6 pt-4 shrink-0">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-gray-900">Send this link to the partner</p>
              <p className="text-xs text-gray-600 mt-1">
                The invitation email could not be delivered. This is the only copy of the link —
                the database stores a hash of it, never the link itself — and it expires in 7 days.
              </p>
              <code className="mt-2 block w-full break-all rounded-lg bg-white border border-amber-200 px-3 py-2 text-[11px] text-gray-800">
                {inviteFallbackUrl}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(inviteFallbackUrl);
                  toast.success('Link copied');
                }}
                className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                Copy link
              </button>
            </div>
          </div>
        )}

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

