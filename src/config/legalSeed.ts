/**
 * The legal documents' starting text, written into the database the first
 * time the platform reads them. After that the database is the only copy and
 * admins change the wording from the console.
 *
 * Each document is complete and describes the platform as it works. Text in
 * [square brackets] is a fact only the business can supply (its legal name,
 * address, state and contact addresses, and its designated agent); admins fill
 * those in from the console and publish.
 */

export type LegalDocId = "terms" | "privacy" | "content-policy";

export interface LegalSeed {
  title: string;
  published: { version: string; isDraft: boolean; body: string };
  draft?: { isDraft: boolean; body: string };
}

const TERMS = `These Terms of Service ("Terms") are a legal agreement between you and [Company legal name], trading as Space Transfers ("Space Transfers", "we", "us" or "our"). They govern your use of the Space Transfers website, our gang sheet builder, ordering, checkout and account features, our print partner portal, and every related service we provide (together, the "Service").

By creating an account, ticking the box to accept these Terms, or placing an order, you agree to these Terms, to our Privacy Policy, and to our Content & Intellectual Property Policy, which form part of these Terms. If you do not agree, do not use the Service.

Please read section 23 carefully. It requires most disputes to be resolved by individual binding arbitration rather than in court, and waives your right to bring or join a class action, unless you opt out as described there.

Part A applies to everyone. Part B applies in addition if you are an approved print partner.

## Part A: Everyone who uses the Service

## 1. Definitions
- "Account" means the account you register to use the Service, including any sub-account created under it.
- "Artwork" means any image, design, logo, text or other material you upload, create or edit using the Service.
- "Customer" means anyone who designs or orders products through the Service.
- "Order" means a purchase of one or more gang sheets or other products through the Service.
- "Print partner" or "partner" means an independent print business we have approved to produce and ship Orders.
- "Sheet" or "gang sheet" means a sheet of direct-to-film (DTF) transfer film printed with your Artwork.

## 2. Eligibility
You must be at least 18 years old, or the age of majority where you live if that is higher, and able to form a binding contract, to create an Account or place an Order. The Service is offered to customers in the United States, and Orders can be shipped only to addresses in the United States. If you use the Service for a business, you confirm that you are authorised to accept these Terms for that business, and "you" includes that business.

## 3. Your account
- Give accurate, complete and current information when you register and when you order, including your name, email address, phone number and shipping address, and keep it up to date.
- Keep your password, passkeys and recovery codes secure and do not share them. You are responsible for all activity under your Account, including activity by anyone you let use it and by any sub-account you create.
- If you create sub-accounts, you are responsible for their users' compliance with these Terms, and their activity is treated as yours.
- Tell us immediately at [support email] if you suspect unauthorised use of your Account. We may require additional verification, such as a passkey or a one-time code, to protect your Account, and we may suspend access while we investigate suspicious activity.
- You may not create an Account using automated means, under a false identity, or after we have closed a previous Account of yours for a breach of these Terms.

## 4. The builder and your responsibility for your sheets
The builder lets you place Artwork on a sheet of a fixed width and choose its length, size and spacing. You are solely responsible for checking every sheet before you order it, including its contents, the size and position of each design, the spacing between designs, the spelling of any text, and the print resolution shown for each image.

The builder may warn you that an image is likely to print below 300 DPI, contains transparency or fades that may not print as expected, sits too close to another design or the edge of the sheet, or may involve someone else's rights. These warnings are automated guidance only. They may miss problems and may flag images that would print well. We print the sheet as you submit it, and a problem that a warning described, or that was visible in the sheet you submitted, is not a defect.

Sheets you save are kept in your Account for your convenience. We do not guarantee that saved sheets or uploaded files will be kept indefinitely, and you should keep your own copies of your Artwork.

## 5. Image tools and AI edits
The builder includes tools that change your images, such as background removal, cropping, trimming and AI edits. AI edits are produced by a third-party provider (currently Google) from the image and instruction you give. Results are generated automatically, can be unpredictable, may contain errors, and may not be suitable for printing. You are responsible for reviewing every result before you use or order it.

You must not use these tools to create Artwork that infringes anyone's rights or breaches our Content & Intellectual Property Policy, or to remove watermarks, signatures, copyright notices or other marks identifying the owner of a work. An edited image is checked in the same way as an upload. To the extent any rights arise in an AI-edited result, they belong to you, subject to the rights of the owners of anything the result is based on, and you remain responsible for it as your Artwork.

## 6. Rights checks on artwork
We check Artwork for signs that it may include material owned by others, as described in our Content & Intellectual Property Policy. An image may be kept off your sheet, marked for review, or held from checkout, and you may dispute a result. Before every Order you must confirm that you own the Artwork or have the rights to print it. These checks protect the Service and do not shift to us any part of your responsibility for your Artwork. We are not obliged to check any Artwork, and our checking or not checking an image is not a statement that it is, or is not, lawful to print.

## 7. Orders and acceptance
When you place an Order you make an offer to buy the products in your cart at the prices shown at checkout. An Order is accepted, and a contract for that Order is formed, when your payment succeeds and we send you an order confirmation. We may decline or cancel an Order before it ships, including where:

- the Artwork may infringe someone's rights or breaches our policies;
- the Artwork cannot be printed as supplied;
- the shipping address cannot be verified or is outside the area we serve;
- a pricing, tax or shipping error appears on the Order; or
- we suspect fraud or unauthorised use of a payment method or Account.

If we cancel an accepted Order, we will tell you and refund you as set out in section 11.

## 8. Prices, taxes and payment
- Prices are in US dollars. A sheet is priced by its area, its width multiplied by its length, and every sheet is charged for at least the minimum length shown in the builder, even if your designs are shorter.
- Rush (express) production adds a surcharge, shown as a percentage of the subtotal before you pay.
- Shipping is calculated from the parcel, its destination and the service you choose, and includes a handling charge. Sales tax is added where applicable. All of these are shown before you pay.
- Payment is taken in full when you place an Order. Card payments are processed by Stripe, Inc.; we do not see or store your full card number. By paying you confirm you are authorised to use the payment method.
- Prices may change at any time, but a change does not affect an Order already accepted. If an obvious error in a price, tax or shipping amount appears on an Order, we may cancel it and refund you in full, or contact you to confirm the correct amount before we proceed.
- If you dispute a charge with your card issuer instead of contacting us first, we may suspend your Account while the dispute is open. If a chargeback is decided in our favour, or you dispute a charge for an Order that was delivered as ordered, we may close your Account.

## 9. Production
Your Order is produced by an independent print partner we select, usually the one best placed to serve your delivery address, and is shipped from that partner's location. We remain responsible to you for your Order under these Terms.

- Turnaround times shown in the Service are good-faith estimates, not guarantees. Delays can occur, for example at busy times, if an Order needs a rights review, or for reasons outside our control.
- Printed colours can differ from colours on a screen, which vary between devices. Minor variations in colour, density, size, alignment and placement within normal tolerances for DTF printing are not defects.
- DTF transfers must be applied following the application instructions for the product, including the temperature, pressure, time and peel method. Results depend on the garment, the fabric, the equipment and the method used. We are not responsible for transfers that are applied incorrectly, for garments or other items damaged during application, or for how a transfer performs on a particular material.
- Test a transfer on the material you intend to use before applying a large quantity.

## 10. Shipping and delivery
- You must give a complete, correct and deliverable shipping address. We may verify your address with our shipping provider and suggest a correction; you decide whether to accept it. We are not responsible for an Order delivered to the address you gave us, or delayed or lost because that address was incorrect or incomplete. Re-shipping to a corrected address may be charged.
- Delivery dates are estimates given by the carrier and are not guaranteed. We are not responsible for carrier delays.
- Risk of loss and title pass to you when the carrier delivers the parcel to your shipping address. If the carrier's tracking shows a parcel delivered and you have not received it, contact the carrier and tell us; we will help, but we are not responsible for parcels stolen after delivery.

## 11. Cancellations, problems, refunds and reprints
Cancelling your own Order. You can cancel an Order from your order history before it is assigned to a print partner, and you will receive a full refund. Once a partner has the Order, they may already be printing it, so you can ask to cancel and the partner decides; if they accept, your Order is cancelled and refunded. An Order cannot be cancelled once it has shipped.

When we cancel. If we cancel an Order before work has begun, we refund it in full. If work has already begun, for example where an Order is cancelled because its Artwork breaches our policies, we may keep back the cost of the work already done and will tell you why.

Reporting a problem. If an Order does not arrive, arrives damaged, or is printed incorrectly, report it from your order history within 14 days of delivery, or of the expected delivery date if it has not arrived. Describe the problem and include photos where you can. We may ask for more information, or for the item to be returned. We review each report and, where the problem was caused by us, our partner or the carrier's handling, we will, at our choice, reprint the affected sheets at no charge or refund some or all of the price.

What is not a defect. Problems caused by Artwork as supplied (including low resolution, transparency, colours or sizes), by choices you made in the builder, by an incorrect address, by application of the transfer, or by normal variation described in section 9 are not defects, and no refund or reprint is due for them.

Custom products. Every sheet is made to your specification. Except as set out in this section or required by law, Orders cannot be returned or refunded for a change of mind.

How refunds are paid. Refunds go to the payment method used for the Order and usually appear within 5 to 10 business days, depending on your bank.

Sole remedy. To the extent permitted by law, a reprint or refund under this section is your sole and exclusive remedy for a defective, damaged, late or undelivered Order.

## 12. Your content and the licence you give us
You keep all rights you have in your Artwork. You grant us, our print partners and our service providers a non-exclusive, worldwide, royalty-free licence to host, store, copy, process, screen, resize, convert, reproduce and print your Artwork, and to show it back to you and to the partner producing your Order, only as needed to operate the Service, check Artwork as described in our policies, fulfil and support your Orders, and keep the records our policies describe. This licence ends when your Artwork is deleted from the Service, except for copies kept in Order records and backups as described in our Privacy Policy. We will not use your Artwork to advertise our business or sell it to anyone else.

You confirm that you own, or have all the rights, licences and permissions needed to grant this licence for, all Artwork you upload, and that our use of it as these Terms allow will not infringe anyone's rights or break any law.

## 13. Our intellectual property
The Service, including its software, design, text, graphics and the Space Transfers name and logo, is owned by us or our licensors and is protected by law. We give you a limited, personal, non-exclusive, non-transferable and revocable licence to use the Service for its intended purpose under these Terms. You may not copy, modify, distribute, sell or lease any part of the Service, or reverse engineer or attempt to extract its source code, except where the law allows despite this restriction.

If you send us feedback or suggestions, we may use them without any obligation to you.

## 14. Acceptable use
You must not, and must not help anyone else to:

- use the Service for any unlawful purpose, or to print anything that breaches our Content & Intellectual Property Policy;
- upload malware or any file designed to harm or interfere with the Service or anyone's device;
- try to access Accounts, data or systems that are not yours, probe or test the Service's security, or get around any security, rate-limit or rights-checking feature;
- scrape, crawl or use bots or other automated means to access the Service, or resell, sublicense or frame it, without our written permission;
- interfere with the Service's operation, or place an unreasonable load on it;
- impersonate anyone, misrepresent your connection with anyone, or give false information in a dispute, report or application;
- harass, threaten or abuse our staff, our print partners or other users, including in messages sent through the Service.

## 15. Communications
By creating an Account you agree to receive electronic communications from us about your Account and Orders, including order confirmations, shipping and delivery updates, security alerts, replies to reports and disputes, and changes to these Terms. These messages are part of the Service and you cannot opt out of them while you have an Account. We will ask for your consent before sending marketing messages, and each one will tell you how to unsubscribe.

You agree that all agreements, notices, disclosures and other communications we give you electronically, including by email, through your Account or on the Service, satisfy any legal requirement that they be in writing, and that ticking a box or clicking a button to accept is your electronic signature.

## 16. Third-party services
The Service relies on third parties, including Stripe for payments, carriers and EasyPost for shipping, and Google for sign-in and AI edits. Your use of a third party's service may also be subject to that party's terms. We are not responsible for third-party services, websites or content, and links to them are not endorsements.

## 17. Privacy
Our Privacy Policy explains how we collect, use and share personal information. By using the Service you acknowledge that we will handle your information as described there.

## 18. Suspension and termination
You may close your Account at any time from your account settings, unless an Order is still being produced or shipped, in which case you can close it once that Order is complete. You can download a copy of your data before you do.

We may suspend or close your Account, remove Artwork, or refuse or cancel Orders, with or without notice, if we reasonably believe you have breached these Terms or our policies, if you repeatedly upload infringing material, if we must do so by law, or if continuing to provide the Service to you would expose us, our partners or other users to harm or legal risk. Where practical, we will tell you why.

When your Account closes, your right to use the Service ends. Sections 4, 8, 10 to 13, and 18 to 26, and any other provision that by its nature should survive, continue to apply.

## 19. Disclaimers
To the fullest extent permitted by law, the Service, all products and all automated features, including resolution and fade warnings, address checks, rights checks and AI edits, are provided "as is" and "as available". We and our print partners disclaim all warranties, express or implied, including implied warranties of merchantability, fitness for a particular purpose, title and non-infringement, and any warranties arising from a course of dealing or usage of trade. We do not warrant that the Service will be uninterrupted, timely, secure or error-free, that any defect will be corrected, or that any automated feature will detect every problem. Some jurisdictions do not allow the exclusion of implied warranties, so some of these exclusions may not apply to you.

## 20. Limitation of liability
To the fullest extent permitted by law:

- neither we nor our officers, employees, contractors, print partners or service providers will be liable for any indirect, incidental, special, consequential, exemplary or punitive damages, or for any loss of profits, revenue, business, goodwill, data or opportunity, or the cost of substitute goods, however caused and even if we were told they were possible;
- our total liability for all claims arising out of or relating to the Service or these Terms will not exceed the greater of the amount you paid us for the Order giving rise to the claim and one hundred US dollars (US$100);
- these limits apply to every theory of liability, including contract, tort (including negligence), strict liability and statute.

Nothing in these Terms limits liability that cannot be limited by law, such as liability for fraud or for death or personal injury caused by negligence.

## 21. Indemnity
You agree to defend, indemnify and hold harmless Space Transfers, its officers, employees, contractors and print partners from and against any claims, demands, actions, damages, losses, liabilities, fines, costs and expenses (including reasonable legal fees) arising out of or relating to your Artwork, your Orders, your use of the Service, your breach of these Terms or our policies, or your violation of any law or anyone's rights. We may take control of the defence of any such claim at your expense, and you will cooperate with us. You may not settle a claim that affects us without our written consent.

## 22. Events outside our control
We are not liable for any delay or failure to perform caused by events beyond our reasonable control, including carrier and supply delays, failures of utilities, the internet or third-party services, labour disputes, fire, flood, severe weather, epidemics, war, terrorism, civil unrest or acts of government.

## 23. Dispute resolution and arbitration
Informal resolution first. Before starting any claim, you and we agree to try to resolve the dispute informally. Send a written description of the dispute and the remedy sought to [support email] (or, for us, to the email on your Account). If it is not resolved within 30 days, either party may begin proceedings as set out below.

Binding arbitration. Except as set out below, any dispute, claim or controversy arising out of or relating to these Terms, the Service, or any Order, including its scope and enforceability, will be resolved by binding individual arbitration administered by the American Arbitration Association ("AAA") under its Consumer Arbitration Rules (or, for disputes with businesses and print partners, its Commercial Arbitration Rules) in effect at the time. The Federal Arbitration Act governs this section. The arbitration will take place in the county where you live or, if both parties agree, by video or on written submissions. Fees are allocated as the AAA rules provide. The arbitrator may award the same individual relief a court could, but only to the individual party seeking it.

Exceptions. Either party may bring an individual claim in small claims court if it qualifies, and either party may seek an injunction in court to stop infringement or misuse of intellectual property.

Class action waiver. You and we each agree to bring claims only in an individual capacity and not as a plaintiff or class member in any purported class, collective, consolidated or representative proceeding. The arbitrator may not consolidate claims or preside over any form of representative proceeding. If this waiver is found unenforceable for a claim, that claim must be decided in court, not in arbitration.

Opting out. You may opt out of this arbitration agreement by emailing [support email] within 30 days of first accepting these Terms, with your name, the email on your Account and a clear statement that you opt out of arbitration. Opting out does not affect any other part of these Terms.

Time limit. To the extent permitted by law, any claim must be brought within one year after it arises, or it is permanently barred.

## 24. Governing law and venue
These Terms are governed by the laws of the State of [State] and applicable US federal law, without regard to conflict-of-law rules. Subject to section 23, any claim that is not arbitrated must be brought exclusively in the state or federal courts located in [County], [State], and you and we consent to their jurisdiction.

## 25. Changes to these Terms and the Service
We may update these Terms from time to time. Each version is dated, and the version in force when you accept or order is the one that applies to that acceptance or Order. If a change materially affects your rights, we will tell you by email or through the Service before it takes effect and may ask you to accept the new version. If you continue to use the Service after a change takes effect, you accept the updated Terms; if you do not agree, you must stop using the Service and may close your Account. We may change, suspend or discontinue any part of the Service at any time.

## 26. General
- These Terms, with our Privacy Policy and Content & Intellectual Property Policy, are the entire agreement between you and us about the Service and replace any earlier understanding.
- If any provision is found unenforceable, it will be enforced to the maximum extent possible and the rest of these Terms will remain in effect.
- Our failure to enforce a provision is not a waiver of our right to do so later.
- You may not assign or transfer these Terms without our written consent. We may assign them to an affiliate or to a successor in a merger, acquisition or sale of assets.
- Nothing in these Terms creates a partnership, joint venture, employment or agency relationship.
- Headings are for convenience only. "Including" means "including without limitation".
- We may give you notices by email to the address on your Account or through the Service. You may give us notices at the contact details below.

## Part B: Additional terms for print partners

## 27. Applying and approval
If you apply to be a print partner, these additional terms apply to you as well as Part A. Where Part A and Part B conflict, Part B applies to your work as a partner. We review every application and may approve, decline, suspend or reinstate a partner at our discretion. You must give accurate business information, keep it up to date, and hold every licence, registration and permit your business needs.

## 28. Independent contractor
You are an independent business, not our employee, agent or joint venturer. You control how you perform the work, provide your own premises, equipment, materials and staff, and are solely responsible for them, for your employees' and contractors' conduct, and for complying with all laws that apply to your business, including employment, health and safety, environmental and tax laws.

## 29. Accepting and producing jobs
- We offer you jobs through the partner portal. You may decline a job or hand it back before you start it. Once you accept a job you agree to produce it to the specification in the job, to a professional standard, and within the stage deadlines shown in the portal.
- A job that misses a stage deadline may be taken back and given to another partner.
- You must use the print files provided for each job without altering the Artwork, and keep job status updated in the portal as work progresses.
- You must ship each Order using the shipping label provided through the Service, to the customer's address on the job, and pack it so it arrives undamaged.
- While a customer's request to cancel, or a rights concern, is open on a job, you must not move it on until it is answered.

## 30. Customer information and artwork
You may use customers' names, addresses, contact details and Artwork only to produce and ship the jobs we give you. You must keep them confidential and secure, must not keep copies longer than needed for that purpose, must not contact customers outside the Service or market to them, and must not use or allow anyone else to use their Artwork for any other purpose. Tell us without delay, and in any case within 72 hours, if you become aware of any unauthorised access to or loss of customer information or Artwork.

## 31. Rights concerns
If you believe a job's Artwork may infringe someone's rights or breach our policies, report it from the job before printing. The job is then put on hold while we review it, and we will tell you whether to proceed. You must not print Artwork you know infringes someone's rights, even if it has passed our checks. Our decision on a rights concern is final as between you and us.

## 32. Pay and payouts
- You are paid for each job at your pricing as agreed with us and shown in the portal. A job becomes payable once it has shipped. If we cancel a job after you started it, we may at our discretion pay you for work done.
- We prepare payout drafts weekly and pay them after review and approval by our team; nothing is paid automatically. Payouts are made through Stripe Connect to the account you connect. You must complete Stripe's onboarding, keep your Stripe account in good standing and accept Stripe's terms for connected accounts. We are not responsible for delays caused by Stripe or your bank.
- We may withhold, delay or reduce payment for jobs that were defective, late, not produced to specification, or the subject of an open report, and may recover amounts paid for such jobs from future payouts.
- If a job you produced must be reprinted because of your error, it will normally be given back to you, and we may decide that the reprint is unpaid.
- You are responsible for all taxes on your earnings. Stripe may issue tax forms for payments made to you, and you must give Stripe or us any tax information the law requires.

## 33. Partner warranties and indemnity
You warrant that your work will be performed with reasonable skill and care, in a safe workplace, and in compliance with all applicable laws. You will indemnify and hold harmless Space Transfers and its officers, employees and contractors from and against any claims, losses, liabilities, costs and expenses (including reasonable legal fees) arising from your work, your premises, your staff, your breach of these Terms, or your misuse of customer information or Artwork.

## 34. Suspension and closing a partner account
We may suspend or end your participation at any time, including for missed deadlines, quality problems, customer complaints, breach of these Terms, or if we no longer need partners in your area. You may close your partner account from your settings once you have no jobs in progress, no open reports and no unpaid money. We keep records of your jobs and payouts after closing for accounting, tax and legal purposes, as our Privacy Policy describes.

## 35. Contact
[Company legal name], trading as Space Transfers, [Business address]. Email: [support email].`;

const PRIVACY = `This Privacy Policy explains how [Company legal name], trading as Space Transfers ("Space Transfers", "we", "us" or "our"), collects, uses, shares and protects personal information when you use our website, gang sheet builder, ordering and account features, our print partner portal, and related services (the "Service"). It also explains your choices and rights. Terms not defined here have the meanings given in our Terms of Service.

## 1. Who we are
[Company legal name] is responsible for the personal information described in this policy. You can contact us about privacy at [privacy email] or at [Business address].

## 2. Information we collect
We collect the following categories of personal information. In the terms used by some US state laws, these are identifiers, customer records, commercial information, internet or other electronic network activity, approximate geolocation, audio-visual information (the images you upload), and professional information (for print partners).

Information you give us:
- Account information: your name, email address, phone number, password and account preferences. Your password and recovery codes are stored only as one-way hashes that no one, including us, can read.
- Order information: the sheets you order, quantities, shipping addresses and phone numbers, shipping method, order history, cancellations, refunds and reprints.
- Artwork: the images you upload, their file names and embedded file details (such as copyright and author fields), the sheets you build and save, and AI edit instructions you write.
- Communications: problem reports, rights dispute messages, evidence such as licences you attach, and anything else you send us. Photos and images you attach are re-saved when uploaded, which removes location data many phones add.
- Your agreement to our terms: which versions of our Terms of Service, Privacy Policy and Content & Intellectual Property Policy you accepted, when you read each to the end, when you accepted, and the IP address and browser used.
- Print partners: business name, contact person, business and shipping addresses, documents submitted with an application, pricing, capacity, jobs, performance and earnings.

Information collected automatically:
- Sign-in and security information: the IP address, approximate location (city and country, derived from the IP address), device and browser for each sign-in attempt, and passkeys you register (we store only the public part of a passkey).
- Technical information: when something goes wrong, error reports with technical details such as the page, browser and the step that failed. These reports are set up to leave out personal details such as names, email addresses and form contents.

Information from others:
- Google, if you sign in with Google: your name, email address and profile photo.
- Stripe: the outcome of payments and refunds, and the card brand and last four digits. Stripe holds your full card details; we never see them. For print partners, Stripe holds bank and identity details and tells us whether your account can receive payouts.
- Shipping providers: address verification results, label and tracking information.

We do not collect sensitive information such as government ID numbers, financial account numbers, health information or precise geolocation, except that print partners' bank and identity details are collected and held by Stripe, not us.

## 3. How we use it
- To provide the Service: create and run your Account, save your sheets, process images, price, produce and ship Orders, and assign them to a print partner near you.
- To process payments, refunds and partner payouts.
- To check uploaded Artwork for signs of third-party intellectual property, handle rights disputes and infringement notices, and keep records of decisions, including to identify repeat infringers.
- To communicate with you about your Account, Orders, reports, disputes, security and changes to our terms.
- To keep the Service and accounts secure: detecting unusual sign-ins, preventing fraud and abuse, enforcing rate limits, and investigating problems.
- To fix errors and improve how the Service works.
- To comply with law, respond to lawful requests, enforce our terms, keep tax and accounting records, and establish, exercise or defend legal claims, including by keeping the record of your acceptance of our terms.

We do not use your Artwork or personal information to train artificial intelligence models, and our AI providers are not permitted to use the data we send them to train their models under the terms we use them on. We do not make decisions that have legal or similarly significant effects on you based solely on automated processing; every rights dispute is decided by a person.

## 4. Who we share it with
We share personal information only as needed for the purposes above:

- Print partners receive the customer's name, phone number, shipping address and the Artwork for the Orders they produce, and may use them only for that purpose.
- Service providers process information on our behalf under contracts that limit their use of it: Stripe (payments and partner payouts), EasyPost and the carriers it connects to (address verification, shipping labels and tracking), Render (hosting), MongoDB (database), Cloudflare (file storage), Resend (email delivery), Sentry (error reports), Google (sign-in, AI image edits through Gemini, and Artwork checks through Cloud Vision), and Anthropic (Artwork checks).
- Public lookup services receive limited information to answer a single question: the US Census Bureau geocoder (an address, to find its region) and ipwho.is (an IP address, to find its approximate location).
- Print partners who use the "Download to Google Drive" feature send job files to their own Google Drive.
- Authorities, courts and others, where we believe in good faith that the law requires it, or to protect the rights, property or safety of Space Transfers, our users, partners or the public, including responding to infringement claims.
- A buyer or successor, if we are involved in a merger, acquisition, financing or sale of assets, subject to this policy.
- Anyone else, with your consent.

We do not sell personal information, and we do not share it for cross-context behavioural advertising. We have not done so in the past 12 months.

## 5. Cookies and browser storage
We do not use advertising cookies or third-party analytics. We keep your sign-in, cart and preferences in your browser's own storage so the Service works. Stripe sets cookies on checkout pages to prevent fraud, and Google sets cookies when you use Sign in with Google. You can clear browser storage at any time, which signs you out. Because we do not track you across other sites, we do not respond differently to "Do Not Track" signals, but we honour Global Privacy Control signals as an opt-out of sale and sharing, which we do not do in any case.

## 6. How long we keep it
- Account information, saved sheets, uploaded Artwork, sign-in records and the record of your acceptance of our terms: while your Account is open. When you close your Account they are deleted, except Artwork that is part of an Order record.
- Order records, including shipping details and the Artwork printed, and problem reports with their messages and photos: kept after your Account closes, for as long as needed for tax, accounting and legal purposes, normally at least 7 years.
- Rights disputes, their messages and evidence, and records of blocked images: kept after your Account closes, for as long as needed to enforce our repeat-infringer policy and to respond to legal claims.
- Records of artwork checks (a fingerprint of each image and what the checks found): kept so the same image is recognised again without being checked twice.
- Print files prepared for partners: removed 14 days after they are created.
- Partner records, including jobs and payouts: kept after a partner account closes, for as long as needed for tax, accounting and legal purposes, normally at least 7 years.
- Backups: encrypted copies of our database are kept for 30 days and then deleted.

We may keep information longer where the law requires it or where it is needed for a legal claim, and we delete or de-identify it when it is no longer needed.

## 7. How we protect it
All connections to the Service are encrypted. Passwords and recovery codes are stored as one-way hashes. Admin accounts must use a passkey as a second sign-in step, and you can add one to your Account. Each Account can reach only its own information, sign-in attempts are rate-limited, and backups are encrypted. No system is perfectly secure; if a breach affects your personal information, we will notify you and the authorities as the law requires.

## 8. Your choices and rights
You can view and update your account details, see your Orders, download a copy of your information, and close your Account at any time from your account settings.

Depending on where you live, including California, Colorado, Connecticut, Virginia, Utah, Texas, Oregon and other US states with privacy laws, you may have the right to:

- know what personal information we hold about you and how we use and share it, and get a copy of it in a portable format;
- correct inaccurate personal information;
- delete personal information, subject to exceptions such as Order records we must keep;
- opt out of the sale or sharing of personal information, targeted advertising and certain profiling (we do none of these);
- limit the use of sensitive personal information (we use account sign-in credentials only to provide and secure the Service);
- not be discriminated against for exercising these rights.

To make a request, use the tools in your account settings or email [privacy email]. We will verify your request by confirming control of the email address on your Account, and may ask for more information if needed. You may use an authorised agent, who must show us your signed permission. We will respond within the time the law requires, usually 45 days. If we decline your request, you may appeal by replying to our decision; if we deny your appeal, you may contact your state attorney general.

California residents: this section, together with sections 2 to 6, is our notice at collection and privacy policy under the California Consumer Privacy Act.

## 9. Children
The Service is intended for adults aged 18 or over. We do not knowingly collect personal information from anyone under 16. If you believe a child has given us personal information, contact us and we will delete it.

## 10. Where information is processed
We are based in the United States and the Service is intended for US users. Our service providers may process information in the United States and other countries, under contractual protections. If you use the Service from outside the United States, you understand your information will be transferred to and processed in the United States.

## 11. Changes to this policy
We may update this policy from time to time. Each version is dated, and the version shown on the Service is the one in force. If a change materially affects how we use your information, we will tell you by email or through the Service before it takes effect.

## 12. Contact
[Company legal name], trading as Space Transfers, [Business address]. Privacy questions and requests: [privacy email]. General support: [support email].`;

const CONTENT_POLICY = `This Content & Intellectual Property Policy ("Policy") governs the images, artwork, logos, designs, text and other material ("Artwork") you upload to, create with or order through Space Transfers, operated by [Company legal name] ("Space Transfers", "we", "us"). It forms part of our Terms of Service. By creating an Account you agree to it in full.

## 1. Your responsibility for what you upload
You are solely responsible for all Artwork uploaded through your Account, including uploads made by anyone using your credentials and by any sub-account you create.

- Upload only Artwork you created and own outright, or that you have obtained every right, licence and permission needed to use, modify, reproduce, print and sell, from every person who holds rights in it.
- Do not upload Artwork that infringes any copyright, trademark, trade dress, design right, patent, right of publicity or privacy, or other proprietary right.
- Do not upload Artwork whose licence prohibits commercial reproduction, print-on-demand use, merchandise or resale, unless you hold a licence that expressly permits it. Many stock images, fonts, clip art and "free" downloads do not allow printing on products for sale.
- Do not remove or alter watermarks, signatures, copyright notices or other information identifying a work's owner.
- Keep proof of your rights, such as licences, receipts and permissions, for as long as you sell products using the Artwork, and provide it to us on request.

## 2. What needs permission
As a guide, you need the owner's permission to print:

- logos, brand names, slogans and packaging of companies and products;
- sports teams, leagues, colleges and their names, crests, mascots and colours used as branding;
- characters, scenes and stills from films, television, games, comics, anime and books;
- band names, album art, song lyrics and tour artwork;
- photographs, illustrations and artwork made by someone else, including works found online and works "inspired by" or closely copied from them;
- images of real, identifiable people, especially celebrities, for commercial use.

Fair use and parody are narrow defences decided case by case, and selling printed products is a commercial use. Do not rely on them without legal advice. Altering a work, or adding your own elements to it, does not by itself remove the need for permission.

## 3. Prohibited content
Whatever rights you hold, you may not upload or order Artwork that:

- depicts or promotes the sexual exploitation of children, which we report to the National Center for Missing & Exploited Children and law enforcement;
- is sexually explicit or pornographic;
- promotes violence, terrorism or violent extremism, or threatens or incites harm against any person or group;
- attacks or demeans people on the basis of race, ethnicity, national origin, religion, disability, sex, gender identity, sexual orientation or other protected characteristic, or uses hate symbols;
- harasses, bullies or defames anyone, or discloses anyone's private information;
- promotes illegal drugs, illegal weapons or other illegal activity;
- is counterfeit, or is designed to be mistaken for an official product of a brand or organisation;
- is otherwise unlawful.

We decide whether Artwork breaches this section, and may decline any Artwork we consider inappropriate to print.

## 4. How we check uploads
Space Transfers checks Artwork for signs of third-party intellectual property, including recognised logos, brands, characters, sports teams and published works; images that appear on stock libraries or elsewhere online; text and names known to belong to rights holders; the copyright and credit details stored in the file itself; and images we have previously blocked. Some checks are carried out for us by Google (Cloud Vision) and Anthropic (Claude). Checks run when you upload or edit an image, before you pay, when an Order is created, and when a print partner opens the job.

- An image the checks are confident about is not added to your sheet. An image they are unsure about is marked on your sheet. Either way, an Order cannot be placed with it until it is removed or cleared.
- If an image cannot be checked, for example because it could not be read, checkout may be paused until it can.
- These checks are not a legal determination. They will miss some infringing material and may stop material you are fully licensed to use. An image passing the checks is not permission to print it, and does not transfer any responsibility for it to Space Transfers.
- Before every Order, you confirm that you own the Artwork or have the rights to print it.

## 5. Disputing a result
If you have the rights to print an image the checks stopped, you can dispute the result from Rights reviews in your Account.

- Explain why you are entitled to print it, and attach proof where you have it, such as a licence, a written permission, or evidence that you created the work.
- A member of our team reviews every dispute. We may ask questions through the dispute thread, and the dispute stays open until it is decided or you withdraw it.
- We record the reason for every decision and the name of the person who made it. An approval clears only what was found in that image, for your Account only. It does not clear the same image for anyone else, and we may withdraw it if we learn the rights were not as described.
- If we reject a dispute, the image may be blocked from being printed by anyone.
- Giving false information or false proof in a dispute is a breach of our Terms of Service, and may make you liable to the rights holder and to us.

## 6. Print partners
Our print partners may put a job on hold if they believe its Artwork may infringe someone's rights or breach this Policy, while we review it. If we decide the job cannot be printed, we will cancel the Order as described in our Terms of Service.

## 7. Our rights on a suspected violation
We may, at our discretion and without prior notice, decline to print, hold, cancel or stop any Order, remove or block Artwork, and suspend or close an Account where we reasonably believe this Policy has been breached or where we receive a notice of infringement. Where an Order is cancelled for this reason, any refund is governed by our Terms of Service, and we may keep back the cost of work already done.

## 8. Repeat infringers
We keep a record of rejected disputes, blocked images and infringement notices. We will, in appropriate circumstances, suspend or permanently close the Accounts of users who repeatedly upload infringing material or are the subject of repeated valid notices, and we may refuse to open a new Account for them.

## 9. Reporting copyright infringement (DMCA notice)
We respect the rights of creators and respond to notices of alleged copyright infringement under the US Digital Millennium Copyright Act (17 U.S.C. § 512). If you believe material on or produced through Space Transfers infringes your copyright, send a written notice to our designated agent:

[Agent name], Designated Copyright Agent, [Company legal name], [Postal address]. Email: [Agent email]. Phone: [Agent phone].

Your notice must include:

- your physical or electronic signature, as the copyright owner or a person authorised to act for them;
- identification of the copyrighted work you claim is infringed, or a representative list if there are several;
- identification of the material you claim is infringing, with enough information for us to locate it, such as an order number, image or description;
- your name, postal address, telephone number and email address;
- a statement that you have a good-faith belief that use of the material in the manner complained of is not authorised by the copyright owner, its agent or the law; and
- a statement that the information in the notice is accurate and, under penalty of perjury, that you are the copyright owner or authorised to act on the owner's behalf.

We act promptly on valid notices, including by removing or blocking the material, cancelling unfulfilled Orders that use it, and notifying the user who uploaded it. A notice that does not substantially comply with these requirements may not be acted on. Under 17 U.S.C. § 512(f), anyone who knowingly materially misrepresents that material is infringing may be liable for damages.

## 10. Counter-notification
If material you uploaded was removed or blocked because of a copyright notice and you believe this was a mistake or misidentification, you may send a counter-notification to our designated agent at the address above. It must include:

- your physical or electronic signature;
- identification of the material that was removed or blocked and where it appeared before;
- a statement, under penalty of perjury, that you have a good-faith belief that the material was removed or disabled as a result of mistake or misidentification;
- your name, address and telephone number, and a statement that you consent to the jurisdiction of the federal district court for the judicial district in which your address is located (or, if your address is outside the United States, any judicial district in which we may be found), and that you will accept service of process from the person who sent the original notice or their agent.

On receiving a valid counter-notification, we will send a copy to the person who sent the original notice. Unless they tell us within 10 business days that they have filed a court action to restrain the use, we may restore the material within 10 to 14 business days after receiving the counter-notification. Knowingly materially misrepresenting that material was removed by mistake may make you liable for damages.

## 11. Trademark and other rights complaints
To report a trademark, right of publicity or other non-copyright complaint, email [Agent email] with your contact details, the right you hold and where it is registered, the material concerned with enough detail for us to locate it, and a statement that you believe in good faith the use is not authorised. We review these complaints and may remove material, cancel Orders and apply section 8.

## 12. Indemnity
You agree to defend, indemnify and hold harmless Space Transfers, its officers, employees, contractors and print partners from and against any claims, demands, damages, losses, liabilities, costs and expenses (including reasonable legal fees) arising out of or relating to Artwork you upload or order, any breach of this Policy, or any false statement in a dispute or counter-notification.

## 13. Changes to this Policy
We may update this Policy from time to time. Each version is dated, and the version in force when you upload or order applies. We will tell you about material changes before they take effect.

## 14. Contact
Questions about this Policy: [support email]. Infringement notices: our designated agent, as set out in section 9.`;

/** The date these texts took effect, which is also the version sign-ups accept. */
const VERSION = "2026-10-29";

export const LEGAL_SEED: Record<LegalDocId, LegalSeed> = {
  terms: { title: "Terms of Service", published: { version: VERSION, isDraft: false, body: TERMS } },
  privacy: { title: "Privacy Policy", published: { version: VERSION, isDraft: false, body: PRIVACY } },
  "content-policy": {
    title: "Content & Intellectual Property Policy",
    published: { version: VERSION, isDraft: false, body: CONTENT_POLICY },
  },
};
