import type { PrintJob } from "../../../types/printQueue";

interface LabelPreviewProps {
  job: PrintJob;
}

export const LabelPreview = ({ job }: LabelPreviewProps) => {
  return (
    <div className="space-y-2">
      <div className="bg-gray-100/50 rounded-xl p-6 border border-gray-200 flex flex-col gap-4">
        <h3 className="text-sm font-bold text-gray-900">Label Preview</h3>
        <div className="bg-white rounded-xl py-10 flex items-center justify-center border border-gray-200">
          <div className="bg-white w-[380px] border-2 border-gray-900 rounded-lg p-6 shadow-sm">
            <div className="flex justify-between items-start mb-5 border-b-2 border-gray-900 pb-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-900">
                  Priority Mail
                </div>
                <div className="text-5xl font-black tracking-tighter text-gray-900 mt-1">
                  DTF
                </div>
              </div>
              <div className="w-14 h-14 border-2 border-gray-900 rounded-sm flex items-center justify-center font-bold text-xs text-gray-900">
                QR
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <div className="font-bold uppercase text-[10px] text-gray-900 mb-1">
                  FROM:
                </div>
                <div className="text-sm font-medium text-gray-900 leading-snug">
                  <div>DTF Print Shop</div>
                  <div>1234 Industry Blvd</div>
                </div>
              </div>

              <div className="pt-3 border-t border-gray-200">
                <div className="font-bold uppercase text-[10px] text-gray-900 mb-1">
                  TO:
                </div>
                <div className="text-sm font-medium text-gray-900 leading-snug">
                  <div>{job.customer}</div>
                  <div>East Coast</div>
                </div>
              </div>

              <div className="pt-3 border-t border-gray-200">
                <div className="font-bold uppercase text-sm text-gray-900">
                  ORDER: {job.orderId}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Qty: 72 sheets • 16×20"
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
