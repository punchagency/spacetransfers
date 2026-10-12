import { useRef, useState } from "react";
import { MdAddAPhoto, MdClose } from "react-icons/md";
import toast from "react-hot-toast";
import { apiFetch } from "../../lib/utils/api";
import { ISSUE_PHOTO_TYPES, MAX_ISSUE_PHOTOS, issuePhotoThumb, pickIssuePhotos, type IssuePhoto } from "../../lib/utils/orderIssues";

/** A stored photo at thumbnail size; the full one if the small one is missing. */
function Thumb({ photo, className }: { photo: IssuePhoto; className: string }) {
  const [src, setSrc] = useState(issuePhotoThumb(photo.url));
  return <img src={src} alt={photo.name || "Photo"} loading="lazy" onError={() => src !== photo.url && setSrc(photo.url)} className={className} />;
}

/** Photos already sent, each opening full size in a new tab. */
export function PhotoStrip({ photos, onDark = false }: { photos?: IssuePhoto[]; onDark?: boolean }) {
  if (!photos?.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {photos.map((photo) => (
        <a
          key={photo.url}
          href={photo.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${photo.name || "photo"}`}
          className={`block h-16 w-16 overflow-hidden rounded-lg border ${onDark ? "border-white/40" : "border-gray-200"}`}
        >
          <Thumb photo={photo} className="h-full w-full object-cover" />
        </a>
      ))}
    </div>
  );
}

interface PhotoPickerProps {
  photos: IssuePhoto[];
  onChange: (photos: IssuePhoto[]) => void;
  /** True while a photo is still uploading, so the form can wait for it. */
  onBusy: (busy: boolean) => void;
  /** "button" is the labelled control of the report form; "icon" sits beside a reply box. */
  variant?: "button" | "icon";
}

/** Chooses photos, uploads each as it is picked, and shows them with a way to take one back. */
export function PhotoPicker({ photos, onChange, onBusy, variant = "button" }: PhotoPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const full = photos.length + uploading >= MAX_ISSUE_PHOTOS;

  const add = async (list: FileList | null) => {
    const files = Array.from(list || []);
    if (input.current) input.current.value = "";
    if (files.length === 0) return;
    const { accepted, problems } = pickIssuePhotos(files, photos.length);
    problems.forEach((p) => toast.error(p));
    if (accepted.length === 0) return;

    setUploading(accepted.length);
    onBusy(true);
    let next = photos;
    for (const index of accepted) {
      const file = files[index];
      try {
        const body = new FormData();
        body.append("file", file);
        const stored = await apiFetch("/customer/issues/photos", { method: "POST", body });
        next = [...next, { url: stored.url, name: stored.name || file.name }];
        onChange(next);
      } catch (err: any) {
        toast.error(err.message || `${file.name} couldn't be added. Please try again.`);
      }
      setUploading((n) => Math.max(0, n - 1));
    }
    setUploading(0);
    onBusy(false);
  };

  const open = () => input.current?.click();

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ISSUE_PHOTO_TYPES.join(",")}
        multiple
        className="hidden"
        onChange={(e) => void add(e.target.files)}
      />
      {variant === "icon" ? (
        <button
          type="button"
          onClick={open}
          disabled={full}
          aria-label="Add a photo"
          title={full ? `Up to ${MAX_ISSUE_PHOTOS} photos` : "Add a photo"}
          className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          <MdAddAPhoto className="h-5 w-5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={open}
          disabled={full}
          className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3.5 py-2.5 text-sm font-medium text-gray-700 hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50"
        >
          <MdAddAPhoto className="h-4 w-4" />
          {photos.length + uploading === 0 ? "Add photos" : full ? `${MAX_ISSUE_PHOTOS} photos added` : "Add another photo"}
        </button>
      )}
    </>
  );
}

/** The photos chosen so far, each removable, with a placeholder for any still uploading. */
export function PhotoTray({ photos, uploading, onRemove }: { photos: IssuePhoto[]; uploading: boolean; onRemove: (url: string) => void }) {
  if (photos.length === 0 && !uploading) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {photos.map((photo) => (
        <div key={photo.url} className="relative h-16 w-16">
          <Thumb photo={photo} className="h-16 w-16 rounded-lg border border-gray-200 object-cover" />
          <button
            type="button"
            onClick={() => onRemove(photo.url)}
            aria-label={`Remove ${photo.name || "photo"}`}
            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-white shadow hover:bg-gray-700"
          >
            <MdClose className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {uploading && (
        <div role="status" aria-label="Uploading photo" className="flex h-16 w-16 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      )}
    </div>
  );
}
