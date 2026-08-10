import { useEffect, useState } from "react";
import type { AiEditOptions } from "../../lib/ai";

/**
 * One-click colour removal.
 *
 * The swatches are the actual dominant colours of the selected artwork, so
 * "remove this colour" is a click on the colour rather than a description of
 * it. That matters more than it sounds: the alternative is asking a customer to
 * name a shade ("off-white? cream? light grey?") and then matching that guess
 * against real pixels, which is where a colour removal usually fails.
 *
 * Tolerance is exposed because no single default is right for every image. Flat
 * vector artwork keys perfectly at a low value; a photograph with a JPEG-noisy
 * background needs a wider net. Presets rather than a raw slider, since the
 * underlying units are perceptual distance and mean nothing to the user.
 */

interface ColorPickerStripProps {
  /** Image to sample. */
  imageUrl: string;
  /** Fires with the prompt and the structured options for the removal. */
  onRemove: (prompt: string, options: AiEditOptions) => void;
  disabled?: boolean;
}

const TOLERANCE_PRESETS = [
  { label: "Exact", value: 8, hint: "Only this precise colour — for flat vector artwork" },
  { label: "Normal", value: 25, hint: "This colour and close shades — good for most images" },
  { label: "Wide", value: 45, hint: "The whole colour family — for photos and gradients" },
];

export default function ColorPickerStrip({ imageUrl, onRemove, disabled }: ColorPickerStripProps) {
  const [colors, setColors] = useState<Array<{ hex: string; ratio: number }>>([]);
  const [tolerance, setTolerance] = useState(25);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    // Imported dynamically so the colour-processing module — the Lab conversion
    // and the per-pixel removal loop — code-splits out of the main bundle. This
    // component is reachable from a statically-imported panel, so a top-level
    // import would pull all of it into the initial download for every visitor,
    // including those who never open the AI panel at all.
    import("../../lib/utils/colorRemover")
      .then(({ extractDominantColors }) => extractDominantColors(imageUrl, 6))
      .then((result) => {
        // The image may have changed (or the panel closed) while this ran.
        if (!alive) return;
        setColors(result);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        // The usual cause is a cross-origin asset that taints the canvas, which
        // is not something the customer can act on — so the strip simply hides
        // rather than showing an error for a secondary affordance.
        setFailed(true);
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [imageUrl]);

  if (failed || (!loading && colors.length === 0)) return null;

  return (
    <div className="px-4 pb-1">
      <div className="flex items-center justify-between pb-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">
          Remove a colour
        </span>
        <div className="flex items-center gap-0.5 rounded-md bg-gray-100 p-0.5">
          {TOLERANCE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => setTolerance(preset.value)}
              title={preset.hint}
              aria-pressed={tolerance === preset.value}
              className={`rounded px-1.5 py-0.5 text-[9.5px] font-semibold transition-colors ${
                tolerance === preset.value
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {loading
          ? // Skeletons sized to the real swatches so the strip doesn't reflow
            // when they land — the panel is anchored to an artboard item and a
            // height change moves the whole thing.
            Array.from({ length: 6 }).map((_, i) => (
              <span
                key={i}
                className="h-7 w-7 flex-shrink-0 animate-pulse rounded-lg border border-gray-200 bg-gray-100"
              />
            ))
          : colors.map((color) => (
              <button
                key={color.hex}
                onClick={() =>
                  onRemove(`Remove the colour ${color.hex}`, {
                    targetColor: color.hex,
                    // Transparency, not white: for transfer printing an absent
                    // background has to actually be absent.
                    replacementColor: null,
                    tolerance,
                  })
                }
                disabled={disabled}
                title={`Remove ${color.hex} — ${Math.round(color.ratio * 100)}% of the image`}
                aria-label={`Remove the colour ${color.hex}`}
                className="group relative h-7 w-7 flex-shrink-0 rounded-lg border border-gray-200 transition-all duration-150 hover:scale-110 hover:border-slate-400 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
                style={{ backgroundColor: color.hex }}
              >
                {/* Coverage bar. Which swatch is the background is the first
                    thing someone needs to know here, and it is not always the
                    one that looks like it should be. */}
                <span
                  aria-hidden
                  className="absolute inset-x-0.5 bottom-0.5 h-0.5 overflow-hidden rounded-full bg-black/10"
                >
                  <span
                    className="block h-full rounded-full bg-black/45"
                    style={{ width: `${Math.min(100, color.ratio * 100)}%` }}
                  />
                </span>
              </button>
            ))}
      </div>
    </div>
  );
}
