export default function EmptyState() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="flex flex-col items-center">
        <div className="w-24 h-24 bg-transparent rounded-xl flex items-center justify-center">
          <img
            src="/folder-icon.svg"
            alt="folder"
            className="w-[122px] h-[122px] drop-shadow-lg"
          />
        </div>
        <p className="text-[20px] text-gray-800 italic font-light">
          Just drop your files directly to the artboard
        </p>
      </div>
    </div>
  );
}
