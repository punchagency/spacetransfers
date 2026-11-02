import { useCallback, useEffect, useRef, useState } from "react";
import { MdArrowBack, MdAttachFile, MdClose, MdGavel } from "react-icons/md";
import toast from "react-hot-toast";
import { onRightsCenterRequest, type RightsCenterRequest } from "../../lib/rightsCenter";
import { getToken } from "../../lib/utils/auth";
import {
  getDispute,
  heldFindings,
  isHeld,
  listDisputes,
  openDispute,
  replyToDispute,
  uploadEvidence,
  withdrawDispute,
  type ImageRights,
  type RightsDispute,
} from "../../lib/utils/rights";

/**
 * Rights reviews: the images the rights check held, and the customer's
 * disputes with Space Transfers about them.
 *
 * Opened when an upload is stopped, from an image's panel on the board, when
 * checkout is paused, and from the account menu. A dispute is a conversation:
 * the customer explains why they can print the image and attaches proof, an
 * admin replies and decides, and the decision shows here and by email.
 */

const INTRO: Record<NonNullable<RightsCenterRequest["reason"]>, { title: string; body: string } | null> = {
  upload: {
    title: "These images weren't added to your sheet",
    body: "They look like they include a brand, character or other work you'd need the rights to print. If you have the rights, dispute the result and we'll review it.",
  },
  board: {
    title: "This image needs a rights review",
    body: "It may include someone else's brand, character or work. Remove it from your sheet, or dispute the result if you have the rights to print it.",
  },
  checkout: {
    title: "Checkout is paused for these images",
    body: "Remove them from your sheet (Edit sheet in your cart), or dispute the result if you have the rights to print them. Checkout opens once each is removed or approved.",
  },
  menu: null,
};

const VERDICT_BADGE: Record<string, { label: string; className: string }> = {
  blocked: { label: "Blocked", className: "bg-red-100 text-red-800" },
  review: { label: "Needs review", className: "bg-amber-100 text-amber-900" },
  unchecked: { label: "Couldn't be checked", className: "bg-gray-100 text-gray-700" },
  pending: { label: "Being checked", className: "bg-gray-100 text-gray-700" },
};

const STATUS_BADGE: Record<RightsDispute["status"], { label: string; className: string }> = {
  open: { label: "Under review", className: "bg-amber-100 text-amber-900" },
  approved: { label: "Approved", className: "bg-green-100 text-green-800" },
  rejected: { label: "Not approved", className: "bg-red-100 text-red-800" },
  withdrawn: { label: "Withdrawn", className: "bg-gray-100 text-gray-700" },
};

const Badge = ({ label, className }: { label: string; className: string }) => (
  <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}>{label}</span>
);

const Thumb = ({ url }: { url: string }) => (
  <img src={url} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-gray-200 bg-gray-100 object-contain" loading="lazy" />
);

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

type View = { kind: "list" } | { kind: "dispute"; id: string } | { kind: "new"; image: ImageRights };
type Attachment = { url: string; name: string };

/** Adds files to a message: a licence PDF, or a photo of one. */
const AttachButton = ({ onAdd, disabled }: { onAdd: (a: Attachment) => void; disabled?: boolean }) => {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            onAdd(await uploadEvidence(file));
          } catch (err: any) {
            toast.error(err?.message || "That file couldn't be attached.");
          } finally {
            setBusy(false);
          }
        }}
      />
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        <MdAttachFile className="h-4 w-4" aria-hidden />
        {busy ? "Attaching…" : "Attach proof"}
      </button>
    </>
  );
};

const AttachmentChips = ({ items, onRemove }: { items: Attachment[]; onRemove?: (i: number) => void }) =>
  items.length ? (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((a, i) => (
        <li key={a.url} className="inline-flex max-w-full items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-[11px] text-gray-700">
          <a href={a.url} target="_blank" rel="noopener noreferrer" className="truncate underline underline-offset-2">
            {a.name}
          </a>
          {onRemove && (
            <button type="button" onClick={() => onRemove(i)} aria-label={`Remove ${a.name}`} className="text-gray-500 hover:text-gray-800">
              <MdClose className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  ) : null;

const Findings = ({ findings }: { findings: { id: string; label: string; detail?: string | null }[] }) => (
  <ul className="space-y-1">
    {findings.map((f) => (
      <li key={f.id} className="text-[12px] leading-snug text-gray-800">
        <span className="font-semibold">{f.label}</span>
        {f.detail ? <span className="block text-[11px] text-gray-500">{f.detail}</span> : null}
      </li>
    ))}
  </ul>
);

export default function RightsCenter() {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<RightsCenterRequest>({});
  const [view, setView] = useState<View>({ kind: "list" });
  const [disputes, setDisputes] = useState<RightsDispute[] | null>(null);
  const [current, setCurrent] = useState<RightsDispute | null>(null);
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const signedIn = Boolean(getToken());

  const refresh = useCallback(() => {
    if (!getToken()) return setDisputes([]);
    listDisputes().then(setDisputes).catch(() => setDisputes([]));
  }, []);

  useEffect(
    () =>
      onRightsCenterRequest((req) => {
        setRequest(req);
        setView({ kind: "list" });
        setOpen(true);
      }),
    [],
  );

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    setMessage("");
    setAttachments([]);
    if (view.kind !== "dispute") return setCurrent(null);
    getDispute(view.id).then(setCurrent).catch(() => toast.error("That dispute couldn't be loaded."));
  }, [view]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!open) return null;

  const intro = INTRO[request.reason || "menu"];
  const held = (request.images || []).filter(isHeld);
  const disputeFor = (img: ImageRights) =>
    (img.dispute && disputes?.find((d) => d.id === img.dispute!.id)) || disputes?.find((d) => d.imageUrl === img.url && d.status === "open");

  const submitNew = async (image: ImageRights) => {
    if (message.trim().length < 10) return toast.error("Tell us why you can print this image (at least a sentence).");
    setSending(true);
    try {
      const d = await openDispute({ imageUrl: image.url, imageName: image.name, message: message.trim(), attachments });
      toast.success("Sent. We'll reply here and by email.");
      refresh();
      setView({ kind: "dispute", id: d.id });
    } catch (err: any) {
      toast.error(err?.message || "Your dispute couldn't be sent. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const sendReply = async () => {
    if (!current || !message.trim()) return;
    setSending(true);
    try {
      setCurrent(await replyToDispute(current.id, message.trim(), attachments));
      setMessage("");
      setAttachments([]);
      refresh();
    } catch (err: any) {
      toast.error(err?.message || "Your message couldn't be sent. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const withdraw = async () => {
    if (!current) return;
    try {
      setCurrent(await withdrawDispute(current.id));
      refresh();
    } catch (err: any) {
      toast.error(err?.message || "The dispute couldn't be withdrawn.");
    }
  };

  const composer = (onSend: () => void, sendLabel: string, placeholder: string) => (
    <div className="space-y-2">
      <label htmlFor="rights-message" className="sr-only">
        Your message
      </label>
      <textarea
        id="rights-message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        maxLength={4000}
        placeholder={placeholder}
        className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-[13px] leading-relaxed focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <AttachmentChips items={attachments} onRemove={(i) => setAttachments((a) => a.filter((_, j) => j !== i))} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AttachButton onAdd={(a) => setAttachments((list) => [...list, a].slice(0, 5))} disabled={attachments.length >= 5} />
        <button
          type="button"
          onClick={onSend}
          disabled={sending || !message.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {sending ? "Sending…" : sendLabel}
        </button>
      </div>
    </div>
  );

  return (
    <div onClick={() => setOpen(false)} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 p-4 backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rights-center-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[min(720px,calc(100dvh-2rem))] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-gray-200 px-5 py-4">
          {view.kind !== "list" ? (
            <button type="button" onClick={() => setView({ kind: "list" })} aria-label="Back" className="text-gray-500 hover:text-gray-800">
              <MdArrowBack className="h-5 w-5" />
            </button>
          ) : (
            <MdGavel className="h-5 w-5 text-gray-500" aria-hidden />
          )}
          <h2 id="rights-center-title" className="flex-1 text-[16px] font-semibold text-gray-900">
            {view.kind === "new" ? "Dispute this result" : view.kind === "dispute" ? "Your dispute" : "Rights reviews"}
          </h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {view.kind === "list" && (
            <>
              {intro && held.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-[13px] font-semibold text-amber-950">{intro.title}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-amber-950">{intro.body}</p>
                </div>
              )}
              {held.length > 0 && (
                <ul className="space-y-3">
                  {held.map((img) => {
                    const d = disputeFor(img);
                    const badge = VERDICT_BADGE[img.verdict] || VERDICT_BADGE.review;
                    return (
                      <li key={img.url} className="flex gap-3 rounded-xl border border-gray-200 p-3">
                        <Thumb url={img.url} />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate text-[13px] font-semibold text-gray-900">{img.name || "Image"}</p>
                            <Badge {...badge} />
                          </div>
                          {img.verdict === "unchecked" ? (
                            <p className="text-[12px] text-gray-600">This image couldn't be checked. Remove it and upload it again.</p>
                          ) : (
                            <Findings findings={heldFindings(img)} />
                          )}
                          {img.verdict !== "unchecked" &&
                            (d ? (
                              <button
                                type="button"
                                onClick={() => setView({ kind: "dispute", id: d.id })}
                                className="inline-flex items-center gap-2 text-[12px] font-semibold text-blue-700 hover:underline"
                              >
                                View dispute <Badge {...STATUS_BADGE[d.status]} />
                              </button>
                            ) : signedIn ? (
                              <button
                                type="button"
                                onClick={() => setView({ kind: "new", image: img })}
                                className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-800 hover:bg-gray-50"
                              >
                                I have the rights: dispute
                              </button>
                            ) : (
                              <p className="text-[12px] text-gray-600">Sign in to dispute this result.</p>
                            ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <section aria-labelledby="rights-disputes" className="space-y-2">
                <h3 id="rights-disputes" className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">
                  Your disputes
                </h3>
                {disputes === null ? (
                  <p className="text-[12px] text-gray-500">Loading…</p>
                ) : disputes.length === 0 ? (
                  <p className="text-[12px] leading-relaxed text-gray-600">
                    {held.length
                      ? "None yet."
                      : "Nothing needs a rights review. Images the check holds, and any dispute you open, appear here."}
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                    {disputes.map((d) => (
                      <li key={d.id}>
                        <button
                          type="button"
                          onClick={() => setView({ kind: "dispute", id: d.id })}
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
                        >
                          <img src={d.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-md border border-gray-200 bg-gray-100 object-contain" loading="lazy" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-gray-900">{d.imageName || d.findings[0]?.label || "Image"}</span>
                            <span className="block text-[11px] text-gray-500">
                              {d.status === "open" && !d.awaitingAdmin ? "Space Transfers replied · " : ""}
                              {when(d.updatedAt)}
                            </span>
                          </span>
                          <Badge {...STATUS_BADGE[d.status]} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          {view.kind === "new" && (
            <>
              <div className="flex gap-3">
                <Thumb url={view.image.url} />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-[13px] font-semibold text-gray-900">{view.image.name || "Image"}</p>
                  <Findings findings={heldFindings(view.image)} />
                </div>
              </div>
              <p className="text-[12px] leading-relaxed text-gray-600">
                Tell us why you can print it: for example, it's your own brand, or you hold a licence for it. Attach the licence or other proof if you
                have it. Space Transfers reviews every dispute and replies here and by email.
              </p>
              {composer(() => void submitNew(view.image), "Send dispute", "I can print this because…")}
            </>
          )}

          {view.kind === "dispute" &&
            (!current ? (
              <p className="text-[12px] text-gray-500">Loading…</p>
            ) : (
              <>
                <div className="flex gap-3">
                  <Thumb url={current.imageUrl} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-[13px] font-semibold text-gray-900">{current.imageName || "Image"}</p>
                      <Badge {...STATUS_BADGE[current.status]} />
                    </div>
                    <Findings findings={current.findings} />
                  </div>
                </div>
                {current.decision && (current.status === "approved" || current.status === "rejected") && (
                  <div
                    className={`rounded-xl border px-4 py-3 text-[12px] leading-relaxed ${
                      current.status === "approved" ? "border-green-200 bg-green-50 text-green-950" : "border-red-200 bg-red-50 text-red-950"
                    }`}
                  >
                    <p className="font-semibold">
                      {current.status === "approved" ? "Approved: you can print this artwork." : "Not approved: remove this image from your sheet to check out."}
                    </p>
                    <p className="mt-1">{current.decision.note}</p>
                  </div>
                )}
                <ol className="space-y-3">
                  {current.messages.map((m, i) => (
                    <li key={i} className={`flex ${m.author === "CUSTOMER" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[85%] space-y-1.5 rounded-2xl px-3.5 py-2 text-[13px] ${
                          m.author === "CUSTOMER" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900"
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        {m.attachments.length > 0 && (
                          <ul className="space-y-0.5">
                            {m.attachments.map((a) => (
                              <li key={a.url}>
                                <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-[11px] underline underline-offset-2">
                                  {a.name}
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className={`text-[11px] ${m.author === "CUSTOMER" ? "text-blue-100" : "text-gray-500"}`}>
                          {m.author === "CUSTOMER" ? "You" : "Space Transfers"} · {when(m.at)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
                {current.status === "open" && (
                  <>
                    {composer(() => void sendReply(), "Send", "Write a reply")}
                    <button type="button" onClick={() => void withdraw()} className="text-[12px] font-medium text-gray-500 hover:text-gray-800 hover:underline">
                      Withdraw this dispute
                    </button>
                  </>
                )}
              </>
            ))}
        </div>
      </div>
    </div>
  );
}
