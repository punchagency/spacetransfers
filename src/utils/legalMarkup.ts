/**
 * The plain-text form legal documents are written in, and its reading.
 *
 * Admins edit the wording in a text box, so it is text, not HTML: nothing in
 * it can run, and it reads the same in the editor as it does on the page.
 *
 *   Opening paragraphs, before the first heading, are the introduction.
 *
 *   ## 1. A section heading
 *   A paragraph. Lines next to each other join into one paragraph;
 *   a blank line starts the next.
 *
 *   - A bullet point
 *   - Another
 */

export type LegalBlock = { type: "p"; text: string } | { type: "ul"; items: string[] };
export interface LegalSection {
  heading: string;
  blocks: LegalBlock[];
}
export interface ParsedLegalText {
  intro: LegalBlock[];
  sections: LegalSection[];
}

export const parseLegalMarkup = (text: string): ParsedLegalText => {
  const intro: LegalBlock[] = [];
  const sections: LegalSection[] = [];
  let blocks = intro;
  let paragraph: string[] = [];
  let list: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "p", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (list && list.length) blocks.push({ type: "ul", items: list });
    list = null;
  };

  for (const raw of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^#{1,3}\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const section: LegalSection = { heading: heading[1].trim(), blocks: [] };
      sections.push(section);
      blocks = section.blocks;
      continue;
    }
    const bullet = /^[-*•]\s+(.+)$/.exec(line);
    if (bullet) {
      flushParagraph();
      (list ??= []).push(bullet[1].trim());
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return { intro, sections };
};

/** Why this text can't be published, or null when it can. */
export const legalMarkupError = (text: string): string | null => {
  const body = String(text ?? "").trim();
  if (!body) return "The document is empty.";
  if (body.length > 100_000) return "The document is too long (over 100,000 characters).";
  const parsed = parseLegalMarkup(body);
  if (parsed.sections.length === 0) return 'Add at least one section heading, a line starting with "## ".';
  return null;
};
