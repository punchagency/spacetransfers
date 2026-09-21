import { MdOutlineFileUpload } from "react-icons/md";
import { UPLOAD_FORMAT_LABELS } from "../../../../config/artboard.config";

export default function EmptyState({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div className="flex items-center justify-center px-4">
      <div className="w-[420px] max-w-full sm:max-w-[92vw]">
        <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white px-6 py-8 sm:px-10 sm:py-10 text-center shadow-sm">
          <div className="mx-auto mb-5 flex   items-center justify-center rounded-xl  ">
            <img src="/upload.svg" alt="Upload" className="h-10 w-10 text-slate-500" />
          </div>
          <div className="text-[18px] font-semibold text-slate-900">
            Upload your artwork
          </div>
          <div className="mt-2 text-[13px] leading-5 text-slate-500">
            {/* Drag-and-drop isn't available on touch devices, so phones get
                the actionable wording instead. */}
            <span className="hidden sm:inline">
              Drag and drop files here or browse <br />
              from your device
            </span>
            <span className="sm:hidden">Browse from your device</span>
          </div>
          <button
            onClick={onBrowse}
            className="mx-auto mt-6 rounded-lg border border-slate-200 bg-white px-5 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            Browse files
          </button>      
          <div className="mt-5 text-[11px] tracking-wide text-slate-400">
            {UPLOAD_FORMAT_LABELS.join(" • ")}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-center gap-6 text-[11px] text-slate-400">
  
        </div>
      </div>
    </div>
  );
}
