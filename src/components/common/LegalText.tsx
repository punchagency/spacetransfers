import type { LegalBlock, ParsedLegalText } from "../../lib/legal/markup";

/** A legal document's wording, as plain text in headings, paragraphs and lists. */
export default function LegalText({ text, compact = false }: { text: ParsedLegalText; compact?: boolean }) {
  const p = compact ? "mt-1 text-[12px] leading-relaxed text-gray-600" : "mt-2 leading-relaxed text-gray-700";
  const ul = compact ? "mt-1.5 list-disc space-y-1 pl-4 text-[12px] leading-relaxed text-gray-600" : "mt-2 list-disc space-y-1.5 pl-5 leading-relaxed text-gray-700";
  const blocks = (list: LegalBlock[]) =>
    list.map((b, i) =>
      b.type === "p" ? (
        <p key={i} className={p}>
          {b.text}
        </p>
      ) : (
        <ul key={i} className={ul}>
          {b.items.map((item, j) => (
            <li key={j}>{item}</li>
          ))}
        </ul>
      ),
    );
  return (
    <>
      {text.intro.length > 0 && <div className={compact ? "mb-4" : "mt-6"}>{blocks(text.intro)}</div>}
      <div className={compact ? "space-y-4" : "mt-6 space-y-6"}>
        {text.sections.map((section, i) => (
          <section key={i}>
            <h2 className={compact ? "text-[12.5px] font-semibold text-gray-900" : "text-base font-semibold text-gray-900"}>{section.heading}</h2>
            {blocks(section.blocks)}
          </section>
        ))}
      </div>
    </>
  );
}
