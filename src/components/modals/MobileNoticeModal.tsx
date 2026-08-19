import { useState } from "react";
import { MdClose, MdPhoneIphone, MdLaptopMac, MdTabletMac } from "react-icons/md";

type MobileNoticeModalProps = {
  isOpen: boolean;
  /** Called when the user dismisses. `dontShowAgain` reflects the checkbox. */
  onDismiss: (dontShowAgain: boolean) => void;
};

/**
 * A non-intrusive notice shown only on phones (see the matchMedia gate in
 * Editor). Explains that the mobile experience is limited and recommends a
 * tablet or desktop for full functionality. Dismissible, with a "Don't show
 * this again" option persisted by the caller.
 */
export default function MobileNoticeModal({ isOpen, onDismiss }: MobileNoticeModalProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  if (!isOpen) return null;

  return (
    <div
      onClick={() => onDismiss(dontShowAgain)}
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-xs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-notice-title"
        className="w-full sm:max-w-sm overflow-hidden rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="flex items-center justify-center w-11 h-11 rounded-full bg-blue-50 text-blue-600 flex-shrink-0">
            <MdPhoneIphone className="w-6 h-6" />
          </div>
          <button
            onClick={() => onDismiss(dontShowAgain)}
            aria-label="Dismiss"
            className="text-gray-400 hover:text-gray-600 -mr-1 -mt-1"
          >
            <MdClose className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pt-3 pb-1">
          <h2 id="mobile-notice-title" className="text-[17px] font-semibold text-gray-900">
            Limited experience on mobile
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-gray-600">
            You can view and make quick edits here, but some advanced tools are
            unavailable on a phone because of the smaller screen. For the full
            editing experience, we recommend switching to a tablet or a
            desktop/laptop.
          </p>

          <div className="mt-3 flex items-center gap-2 text-[12px] font-medium text-gray-500">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 px-2.5 py-1.5">
              <MdTabletMac className="w-4 h-4 text-gray-500" /> Tablet
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 px-2.5 py-1.5">
              <MdLaptopMac className="w-4 h-4 text-gray-500" /> Desktop
            </span>
            <span className="text-[12px] text-gray-400">recommended</span>
          </div>
        </div>

        <div className="px-5 py-4 mt-1">
          <label className="flex items-center gap-2.5 mb-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
            <span className="text-[13px] text-gray-700">Don't show this again</span>
          </label>
          <button
            onClick={() => onDismiss(dontShowAgain)}
            className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors"
          >
            Continue on mobile
          </button>
        </div>
      </div>
    </div>
  );
}
