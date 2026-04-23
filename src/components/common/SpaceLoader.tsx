type SpaceLoaderProps = {
  size?: number;
  label?: string;
  layout?: "block" | "inline";
};

export const SpaceLoader = ({ size = 44, label, layout = "block" }: SpaceLoaderProps) => {
  const rootClass =
    layout === "inline"
      ? "inline-flex items-center justify-center gap-2"
      : "flex flex-col items-center justify-center gap-3";

  return (
    <div role="status" aria-live="polite" className={rootClass}>
      <div className="relative" style={{ width: size, height: size }}>
        <div className="absolute inset-0 rounded-full border-2 border-gray-200" />
        <div className="absolute inset-0 rounded-full border-2 border-blue-600 border-t-transparent space-loader-ring" />
        <img
          src="/space.svg"
          loading="lazy"
          decoding="async"
          alt=""
          className="absolute inset-0 m-auto w-[62%] h-[62%]"
        />
      </div>
      <span className="sr-only">Loading</span>
      {label ? <div className="text-sm text-gray-500">{label}</div> : null}
    </div>
  );
};
