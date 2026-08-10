/**
 * Readable text for the legal documents shown during sign-up.
 *
 * This exists so the agreements can be read *in the app*, at the moment of
 * acceptance, instead of linking out to `/legal/*` routes — which this app has
 * no router to serve, so those links were dead.
 *
 * ⚠️ Drafting status is tracked per document via `isDraft`. The Content & IP
 * Policy is written out in full because its terms were specified directly. The
 * Terms of Service and Privacy Policy are **scaffolds only** — section headings
 * plus a note on what belongs in each — and the modal renders a loud banner over
 * any document marked `isDraft` so an unfinished one cannot ship unnoticed.
 *
 * None of this has been reviewed by a lawyer. Have counsel review all three
 * before launch, then set `isDraft: false` and bump the version in both
 * `documents.ts` and the server's `config/legal.ts`.
 */

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalContent {
  id: string;
  title: string;
  version: string;
  /** True while the text is a scaffold rather than finished, reviewed copy. */
  isDraft: boolean;
  intro?: string;
  sections: LegalSection[];
}

const COMPANY = "Space Transfers";

export const LEGAL_CONTENT: Record<"terms" | "privacy" | "contentPolicy", LegalContent> = {
  contentPolicy: {
    id: "content-policy",
    title: "Content & Intellectual Property Policy",
    version: "2026-07-28",
    isDraft: false,
    intro:
      `This policy governs the images, artwork, logos, designs, and other material you upload to ${COMPANY}. By creating an account you agree to it in full.`,
    sections: [
      {
        heading: "1. Your responsibility for what you upload",
        paragraphs: [
          "You are solely responsible for all images, artwork, logos, designs, text, and other content uploaded through your account, including uploads made by anyone using your credentials or by any sub-account you create.",
        ],
        bullets: [
          "You will only upload content that you own, or that you have obtained the necessary rights, licences, or permissions to use, modify, reproduce, and print.",
          "You will not knowingly upload content that infringes any copyright, trademark, trade dress, design right, right of publicity, or other intellectual property or proprietary right.",
          "You will not upload content whose licence prohibits commercial reproduction, print-on-demand use, or resale, unless you hold a licence that expressly permits it.",
        ],
      },
      {
        heading: "2. We do not verify ownership",
        paragraphs: [
          `${COMPANY} does not verify the ownership or licensing status of uploaded content, and is not responsible for determining whether any uploaded material is copyrighted or otherwise protected.`,
          `${COMPANY} may provide automated screening tools that flag content as potentially carrying third-party intellectual property. Any such tool is advisory only. It is not a legal determination, it will miss infringing material, and it may flag material you are fully licensed to use. A result of "no issues detected" is not permission to print, and does not transfer responsibility for the upload to ${COMPANY}.`,
        ],
      },
      {
        heading: "3. Indemnity",
        paragraphs: [
          `You agree to indemnify, defend, and hold harmless ${COMPANY}, its officers, employees, contractors, and print partners from and against any claims, demands, damages, losses, liabilities, costs, and expenses (including reasonable legal fees) arising out of or relating to content you upload in violation of applicable intellectual property laws or of this policy.`,
        ],
      },
      {
        heading: "4. Our rights on a suspected violation",
        paragraphs: [
          `${COMPANY} may, at its sole discretion and without prior notice, decline to print, cancel, or halt any order, remove uploaded content, and suspend or terminate an account where it reasonably believes this policy has been breached. Where an order is cancelled for this reason, any refund is governed by the Terms of Service.`,
        ],
      },
      {
        heading: "5. Reporting infringement",
        paragraphs: [
          `If you believe content on ${COMPANY} infringes your rights, contact us with a description of the work, the material you believe infringes it, your contact details, and a statement that you are the rights holder or authorised to act for them.`,
        ],
      },
    ],
  },

  terms: {
    id: "terms",
    title: "Terms of Service",
    version: "2026-07-28",
    isDraft: true,
    intro:
      "Section scaffold only — the clauses below have not been drafted. Replace this document with your reviewed Terms of Service before launch.",
    sections: [
      { heading: "1. Accounts and eligibility", paragraphs: ["Who may register, account accuracy, credential security, and sub-account responsibility."] },
      { heading: "2. Orders, pricing, and payment", paragraphs: ["How orders are placed and accepted, pricing and tax, payment terms, and failed payments."] },
      { heading: "3. Production, turnaround, and shipping", paragraphs: ["Production timelines, colour and print tolerances, delivery estimates, and risk of loss."] },
      { heading: "4. Cancellations, returns, and refunds", paragraphs: ["When an order can be cancelled, what qualifies as a defect, and the refund and reprint process."] },
      { heading: "5. Acceptable use", paragraphs: ["Prohibited content and conduct, and the consequences of a breach."] },
      { heading: "6. Intellectual property", paragraphs: [`Your content stays yours; the licence you grant ${COMPANY} to fulfil orders. See the Content & Intellectual Property Policy.`] },
      { heading: "7. Warranties and limitation of liability", paragraphs: ["Disclaimers, liability cap, and excluded categories of loss."] },
      { heading: "8. Termination", paragraphs: ["How either party ends the agreement and what survives termination."] },
      { heading: "9. Governing law and disputes", paragraphs: ["Governing jurisdiction and the dispute-resolution process."] },
      { heading: "10. Changes to these terms", paragraphs: ["How changes are notified and when continued use counts as acceptance."] },
    ],
  },

  privacy: {
    id: "privacy",
    title: "Privacy Policy",
    version: "2026-07-28",
    isDraft: true,
    intro:
      "Section scaffold only — the clauses below have not been drafted. Replace this document with your reviewed Privacy Policy before launch.",
    sections: [
      { heading: "1. What we collect", paragraphs: ["Account details, order and payment data, uploaded files, and technical data such as IP address and device information."] },
      { heading: "2. Why we collect it", paragraphs: ["Fulfilling orders, account security and fraud prevention, support, and legal or compliance obligations — including the record of your acceptance of these terms."] },
      { heading: "3. Who we share it with", paragraphs: ["Print partners, payment processors, shipping carriers, and infrastructure providers, each limited to what their role requires."] },
      { heading: "4. Retention", paragraphs: ["How long each category is kept, and what happens to uploaded artwork after an order completes."] },
      { heading: "5. Your rights", paragraphs: ["Access, correction, deletion, portability, and objection, and how to exercise them."] },
      { heading: "6. Cookies and analytics", paragraphs: ["What is set, what it is used for, and how to control it."] },
      { heading: "7. Contact", paragraphs: ["Who to contact about privacy, and how to escalate to a supervisory authority."] },
    ],
  },
};
