interface DownloadFormatSelectorProps {
  format: "zip" | "individual";
  onChange: (format: "zip" | "individual") => void;
}

const FiCheckIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const DownloadFormatSelector = ({
  format,
  onChange,
}: DownloadFormatSelectorProps) => {
  return (
    <div className="pt-2 animate-in fade-in slide-in-from-top-4 duration-200">
      <h3 className="text-sm font-bold text-gray-900 mb-3">Download Format</h3>
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => onChange("individual")}
          className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all ${
            format === "individual"
              ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500"
              : "border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50"
          }`}
        >
          <div
            className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center ${
              format === "individual"
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-300"
            }`}
          >
            {format === "individual" && <FiCheckIcon className="w-2.5 h-2.5" />}
          </div>
          <div>
            <span
              className={`block text-sm font-bold ${
                format === "individual" ? "text-blue-900" : "text-gray-900"
              }`}
            >
              Individual Files
            </span>
            <span
              className={`block text-xs ${
                format === "individual" ? "text-blue-600" : "text-gray-500"
              }`}
            >
              Separate downloads
            </span>
          </div>
        </button>

        <button
          onClick={() => onChange("zip")}
          className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all ${
            format === "zip"
              ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500"
              : "border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50"
          }`}
        >
          <div
            className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center ${
              format === "zip"
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-300"
            }`}
          >
            {format === "zip" && <FiCheckIcon className="w-2.5 h-2.5" />}
          </div>
          <div>
            <span
              className={`block text-sm font-bold ${
                format === "zip" ? "text-blue-900" : "text-gray-900"
              }`}
            >
              ZIP Archive
            </span>
            <span
              className={`block text-xs ${
                format === "zip" ? "text-blue-600" : "text-gray-500"
              }`}
            >
              Single compressed file
            </span>
          </div>
        </button>
      </div>
    </div>
  );
};
