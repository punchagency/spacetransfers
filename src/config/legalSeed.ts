/**
 * The legal documents' starting text, written into the database the first
 * time the platform reads them. After that the database is the only copy and
 * admins change the wording from the console.
 *
 * `published` is the wording sign-ups accepted before documents moved into the
 * database, so the acceptance records already on file still point at text that
 * exists. `draft` is a fuller first draft written for counsel to review; it is
 * saved as an unpublished draft, and nothing changes for customers until an
 * admin publishes it. Text in [square brackets] is for the business or its
 * lawyer to fill in.
 */

export type LegalDocId = "terms" | "privacy" | "content-policy";

export interface LegalSeed {
  title: string;
  published: { version: string; isDraft: boolean; body: string };
  draft?: { isDraft: boolean; body: string };
}

const CONTENT_POLICY = `This policy governs the images, artwork, logos, designs, and other material you upload to Space Transfers. By creating an account you agree to it in full.

## 1. Your responsibility for what you upload
You are solely responsible for all images, artwork, logos, designs, text, and other content uploaded through your account, including uploads made by anyone using your credentials or by any sub-account you create.

- You will only upload content that you own, or that you have obtained the necessary rights, licences, or permissions to use, modify, reproduce, and print.
- You will not knowingly upload content that infringes any copyright, trademark, trade dress, design right, right of publicity, or other intellectual property or proprietary right.
- You will not upload content whose licence prohibits commercial reproduction, print-on-demand use, or resale, unless you hold a licence that expressly permits it.

## 2. We do not verify ownership
Space Transfers does not verify the ownership or licensing status of uploaded content, and is not responsible for determining whether any uploaded material is copyrighted or otherwise protected.

Space Transfers may provide automated screening tools that flag content as potentially carrying third-party intellectual property. Any such tool is advisory only. It is not a legal determination, it will miss infringing material, and it may flag material you are fully licensed to use. A result of "no issues detected" is not permission to print, and does not transfer responsibility for the upload to Space Transfers.

## 3. Indemnity
You agree to indemnify, defend, and hold harmless Space Transfers, its officers, employees, contractors, and print partners from and against any claims, demands, damages, losses, liabilities, costs, and expenses (including reasonable legal fees) arising out of or relating to content you upload in violation of applicable intellectual property laws or of this policy.

## 4. Our rights on a suspected violation
Space Transfers may, at its sole discretion and without prior notice, decline to print, cancel, or halt any order, remove uploaded content, and suspend or terminate an account where it reasonably believes this policy has been breached. Where an order is cancelled for this reason, any refund is governed by the Terms of Service.

## 5. Reporting infringement
If you believe content on Space Transfers infringes your rights, contact us with a description of the work, the material you believe infringes it, your contact details, and a statement that you are the rights holder or authorised to act for them.`;

const TERMS_SCAFFOLD = `Section scaffold only — the clauses below have not been drafted. Replace this document with your reviewed Terms of Service before launch.

## 1. Accounts and eligibility
Who may register, account accuracy, credential security, and sub-account responsibility.

## 2. Orders, pricing, and payment
How orders are placed and accepted, pricing and tax, payment terms, and failed payments.

## 3. Production, turnaround, and shipping
Production timelines, colour and print tolerances, delivery estimates, and risk of loss.

## 4. Cancellations, returns, and refunds
When an order can be cancelled, what qualifies as a defect, and the refund and reprint process.

## 5. Acceptable use
Prohibited content and conduct, and the consequences of a breach.

## 6. Intellectual property
Your content stays yours; the licence you grant Space Transfers to fulfil orders. See the Content & Intellectual Property Policy.

## 7. Warranties and limitation of liability
Disclaimers, liability cap, and excluded categories of loss.

## 8. Termination
How either party ends the agreement and what survives termination.

## 9. Governing law and disputes
Governing jurisdiction and the dispute-resolution process.

## 10. Changes to these terms
How changes are notified and when continued use counts as acceptance.`;

const PRIVACY_SCAFFOLD = `Section scaffold only — the clauses below have not been drafted. Replace this document with your reviewed Privacy Policy before launch.

## 1. What we collect
Account details, order and payment data, uploaded files, and technical data such as IP address and device information.

## 2. Why we collect it
Fulfilling orders, account security and fraud prevention, support, and legal or compliance obligations — including the record of your acceptance of these terms.

## 3. Who we share it with
Print partners, payment processors, shipping carriers, and infrastructure providers, each limited to what their role requires.

## 4. Retention
How long each category is kept, and what happens to uploaded artwork after an order completes.

## 5. Your rights
Access, correction, deletion, portability, and objection, and how to exercise them.

## 6. Cookies and analytics
What is set, what it is used for, and how to control it.

## 7. Contact
Who to contact about privacy, and how to escalate to a supervisory authority.`;

const TERMS_DRAFT = `These Terms of Service ("Terms") are an agreement between you and [Company legal name], trading as Space Transfers ("Space Transfers", "we", "us"). They govern your use of our gang sheet builder, our ordering and checkout, and related services (together, the "Service"). By creating an account or placing an order you agree to these Terms, our Privacy Policy, and our Content & Intellectual Property Policy.

## 1. Accounts
You must be at least [18] years old, or the age of majority where you live, to create an account or place an order.

- Give accurate information and keep it up to date, including your shipping address and phone number.
- Keep your password, passkeys and recovery codes secure. You are responsible for everything done through your account, including by any sub-account you create.
- Tell us promptly at [support email] if you believe your account has been used without your permission.

## 2. Designing and ordering
You build gang sheets in our online builder by placing your own artwork on a sheet of a fixed width. You are responsible for checking every sheet before you order: its contents, sizes, spacing, and the print resolution shown for each image.

The builder warns you when an image is likely to print below 300 DPI or contains transparency or fades that may not print as expected. These warnings are guidance only; we print what you order.

An order is accepted when your payment succeeds and we send an order confirmation.

## 3. Prices, tax and payment
Prices are shown in US dollars and are calculated from the size of each sheet, with a minimum length per sheet. Express orders carry a rush surcharge. Sales tax and shipping are added at checkout and shown before you pay.

Payment is taken in full when you place the order. Card payments are processed by Stripe; we do not see or store your full card number.

## 4. Production and delivery
Your order is printed by one of our independent print partners, usually the one nearest your delivery address, and shipped from their location.

- Turnaround and delivery times are estimates, not guarantees.
- Colours on screen can differ from printed colours. Small variations in colour, size and placement within normal print tolerances are not defects.
- Responsibility for the parcel passes to you on delivery to the address you gave us.

## 5. Cancellations, problems, refunds and reprints
We may cancel an order before it ships, for example if the artwork cannot be printed as supplied or breaches our Content & Intellectual Property Policy. When we cancel, we refund the payment in full unless work on the order has already begun, in which case we may refund part of it and tell you why.

If your order does not arrive, arrives damaged, or is printed incorrectly, report it from Order History within [14] days of delivery, with photos where you can. We will review it and, where the problem is ours or our partner's, offer a full or partial refund or a free reprint. Problems caused by the artwork you supplied, or by sizes or settings you chose, are not defects.

Refunds go back to the card you paid with and usually appear within 5 to 10 business days.

## 6. Your content
You keep all rights in the artwork you upload. You give us and our print partners a limited licence to store, process, reproduce and print it only as needed to provide the Service and fulfil your orders. You confirm you have the rights to everything you upload, as set out in our Content & Intellectual Property Policy.

## 7. Image tools and AI edits
The builder includes tools that change your images, such as background removal, resolution boosts and AI edits. Results vary and may not suit printing; check every result before you order.

AI edits are processed by a third-party provider (currently Google). You must not use them to create content that infringes anyone's rights or breaches our policies.

## 8. Acceptable use
You must not:

- use the Service for anything unlawful, or to print content that is unlawful, hateful, sexually explicit involving minors, or that infringes anyone's rights;
- try to access accounts, data or systems that are not yours, or interfere with the Service's security or operation;
- copy, resell or scrape the Service, or use automated means to access it, without our written permission.

## 9. Suspension and termination
We may suspend or close your account, or refuse an order, if you breach these Terms or our policies, or if we must do so by law. You may close your account at any time by contacting us. Sections that by their nature should survive termination, including payment obligations, content responsibility and limitation of liability, continue to apply.

## 10. Disclaimers and limitation of liability
[To be drafted by counsel.] To the extent permitted by law, the Service is provided "as is", and our total liability for any claim relating to an order is limited to the amount you paid for that order. We are not liable for indirect or consequential losses, such as lost profits or business interruption.

## 11. Governing law and disputes
These Terms are governed by the laws of [State], United States. [Dispute-resolution process to be drafted by counsel.]

## 12. Changes to these Terms
We may update these Terms. The version and date at the top show which version applies. If a change materially affects you, we will tell you before it takes effect; continuing to use the Service after that means you accept the updated Terms.

## 13. Contact
[Company legal name], [registered address]. Email: [support email].`;

const PRIVACY_DRAFT = `This Privacy Policy explains what personal information [Company legal name], trading as Space Transfers ("we", "us"), collects when you use our gang sheet builder, our print partner portal and related services, how we use it, who we share it with, and the choices you have.

## 1. Information we collect
- Account details: your name, email address, phone number and password. If you sign in with Google, we receive your name, email address and profile photo from Google. Your password is stored only in a form no one, including us, can read.
- Order details: the sheets you order, shipping addresses, the shipping method, order history, and any refunds or cancellations.
- Payment details: the brand and last four digits of your card and a reference to the payment. Your full card number goes directly to our payment processor, Stripe, and never reaches us.
- Your artwork: the images you upload, their file names, and the sheets you save in the builder.
- Problem reports: what you tell us when you report a problem with an order, our messages to each other, and any photos you attach. Photos are re-saved when you upload them, which removes the location data phones often add.
- Sign-in and device information: the IP address, approximate location (worked out from the IP address), device and browser of each sign-in, used to protect your account.
- Your agreement to our terms: which versions of our Terms, Privacy Policy and Content Policy you accepted, and when.
- If you are a print partner: your business details and address, documents you upload with your application, your jobs and earnings. Your bank details are held by Stripe, not by us.

## 2. How we use it
- To build, print, ship and support your orders.
- To take payments, issue refunds and pay our print partners.
- To keep accounts secure, including spotting unusual sign-ins and preventing fraud.
- To send you messages about your account and orders.
- To meet our legal, tax and accounting obligations, and to keep a record of your agreement to our terms.

## 3. Who we share it with
We share personal information only as needed for the purposes above:

- Our print partners, who receive your name, contact details, shipping address and the artwork for the orders they print.
- Stripe, which processes payments and refunds and pays our print partners.
- Our technology providers, which host our database (MongoDB), store files (Cloudflare), send email (Resend) and buy shipping labels and track parcels (EasyPost).
- Google, when you sign in with Google, and when you use AI edits: the image and instruction for each AI edit are sent to Google to produce the result.
- Address and location services we use to work out the region of an address (the US Census Bureau) and the approximate location of a sign-in (ipwho.is).
- Authorities or others where the law requires it, or to protect our rights and the safety of others.

We do not sell your personal information, and we do not share it for cross-context behavioural advertising.

## 4. Cookies and similar technologies
We do not use advertising or analytics cookies. Your sign-in and your preferences are kept in your browser's own storage. Stripe sets its own cookies when you open your cart or checkout, to prevent fraud, and Google sets its own cookies when you sign in with Google. [Update this section if analytics are added.]

## 5. How long we keep it
We keep your account information while your account is open. We keep order records for [period set by counsel, for example 7 years] to meet tax and accounting obligations. Artwork and problem-report photos are kept for [period] after your last order. Sign-in records are kept for [period]. [Retention periods to be confirmed by counsel.]

## 6. How we protect it
All connections to our services are encrypted. Passwords and recovery codes are stored in a form that cannot be read back. Admin accounts must use a passkey as a second sign-in step, and you can add one to yours. Each account can reach only its own information. No system is perfectly secure, and we will tell you, and the authorities where required, if a breach affects your information.

## 7. Your choices and rights
You can view and update your account details and see your orders at any time. You can ask us for a copy of your information, to correct it, or to delete it, by contacting us at [privacy email]. We will respond within the time the law requires. Depending on where you live, you may have further rights, including to opt out of the sale or sharing of personal information (we do neither) and to appeal our decision on a request. We honour the Global Privacy Control signal. [Add EU/UK rights if the Service is offered there.]

## 8. Children
The Service is not for children under [13 / 16 / 18]. We do not knowingly collect information from them.

## 9. Changes to this policy
We may update this policy. The version and date at the top show which version applies, and we will tell you about significant changes before they take effect.

## 10. Contact
[Company legal name], [registered address]. Privacy questions and requests: [privacy email].`;

export const LEGAL_SEED: Record<LegalDocId, LegalSeed> = {
  terms: {
    title: "Terms of Service",
    published: { version: "2026-07-28", isDraft: true, body: TERMS_SCAFFOLD },
    draft: { isDraft: true, body: TERMS_DRAFT },
  },
  privacy: {
    title: "Privacy Policy",
    published: { version: "2026-07-28", isDraft: true, body: PRIVACY_SCAFFOLD },
    draft: { isDraft: true, body: PRIVACY_DRAFT },
  },
  "content-policy": {
    title: "Content & Intellectual Property Policy",
    published: { version: "2026-07-28", isDraft: false, body: CONTENT_POLICY },
  },
};
