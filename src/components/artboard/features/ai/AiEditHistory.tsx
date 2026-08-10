import { MdHistory, MdUndo } from "react-icons/md";

/**
 * The selected image's own AI edit history, with one-click revert to any point.
 *
 * Deliberately separate from the board-wide undo stack, and both are needed.
 * Undo walks every action backwards in order, so reaching an edit from six
 * operations ago also reverses the five unrelated changes made since. This is
 * scoped to one image's chain, which is how people actually think about it —
 * "go back to before I made it pink" — and it leaves the rest of the sheet
 * alone.
 *
 * Persisted on the item, so unlike the undo stack it survives a page reload
 * and a saved design.
 */

interface AiEditHistoryProps {
  /** Oldest first. Each entry holds the image as it was *before* that prompt. */
  entries: Array<{ prompt: string; url: string; at: number }>;
  /** Current image, shown as the tail of the timeline. */
  currentUrl: string;
  onRevert: (entryIndex: number) => void;
  disabled?: boolean;
}

const relativeTime = (at: number): string => {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

export default function AiEditHistory({
  entries,
  currentUrl,
  onRevert,
  disabled,
}: AiEditHistoryProps) {
  if (entries.length === 0) return null;

  return (
    <div className="border-t border-gray-100 px-4 py-2">
      <div className="flex items-center gap-1.5 pb-1.5">
        <MdHistory className="h-3.5 w-3.5 text-gray-400" />
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">
          Edit history
        </span>
      </div>

      <div className="flex items-start gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {entries.map((entry, index) => (
          <button
            key={`${entry.at}-${index}`}
            onClick={() => onRevert(index)}
            disabled={disabled}
            // The prompt is the label, but the thumbnail is the state being
            // restored — which is the state *before* that prompt ran. Saying so
            // avoids the obvious misread of "click the pink one to get pink".
            title={`Revert to before “${entry.prompt}” · ${relativeTime(entry.at)}`}
            className="group relative flex-shrink-0 rounded-lg border border-gray-200 bg-white p-0.5 transition-all duration-150 hover:border-slate-400 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <img
              src={entry.url}
              alt={`Before “${entry.prompt}”`}
              className="h-9 w-9 rounded object-contain"
              style={{ backgroundColor: "#f8f9fa" }}
            />
            <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-slate-900/0 opacity-0 transition-all duration-150 group-hover:bg-slate-900/55 group-hover:opacity-100">
              <MdUndo className="h-3.5 w-3.5 text-white" />
            </span>
          </button>
        ))}

        {/* The current state, marked as where you are and not clickable. */}
        <div className="relative flex-shrink-0 rounded-lg border-2 border-slate-900 bg-white p-0.5" title="Current">
          <img
            src={currentUrl}
            alt="Current"
            className="h-9 w-9 rounded object-contain"
            style={{ backgroundColor: "#f8f9fa" }}
          />
        </div>
      </div>
    </div>
  );
}
