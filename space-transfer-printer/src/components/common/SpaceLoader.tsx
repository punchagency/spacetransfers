type SpaceLoaderProps = {
  size?: number;
  label?: string;
  layout?: "block" | "inline";
};

export const SpaceLoader = ({ size = 65, layout = "block" }: SpaceLoaderProps) => {
  const rootClass =
    layout === "inline"
      ? "inline-flex items-center justify-center gap-2"
      : "flex flex-col items-center justify-center gap-3";

  return (
    <div role="status" aria-live="polite" className={rootClass}>
      <div className="relative" style={{ width: size, height: size }}>
        <div aria-hidden="true" className="absolute inset-0 rounded-full space-loader-glow" />
        {/* <div aria-hidden="true" className="absolute inset-0 rounded-full border-[3px] border-gray-200/80" /> */}
        <div aria-hidden="true" className="absolute inset-0 rounded-full space-loader-ring" />
        <img
          src="/space.svg"
          loading="lazy"
          decoding="async"
          alt=""
          className="absolute inset-0 m-auto w-[85%] h-[85%] space-loader-core"
        />
      </div>
    </div>
  );
};
