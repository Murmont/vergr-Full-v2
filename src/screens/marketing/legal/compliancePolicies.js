// VERGR compliance policies.
//
// The eight documents payment partners and app stores ask for by name. They
// live in their own module rather than in legalContent.js because that file is
// already 1,300 lines of Terms/Privacy/AUP and these are a distinct set with a
// distinct audience: an underwriter or a reviewer works down a checklist, so
// each document is titled EXACTLY as the checklist names it and each one is
// reachable at its own URL.
//
// WRITE ONLY WHAT THE PRODUCT ACTUALLY DOES. Every threshold, timeframe and
// system named below was read out of the code before it was written down:
//
//   Gemini write-time scanning + verdicts     functions/contentAi.js
//   CSAM fail-safe at confidence >= 0.30      functions/contentAi.js
//   audit trail                               content_moderation_log/
//   human review queue + ranks + audit        functions/vanguard.js, vanguard_actions/
//   reports and appeals                       submitReport, submitAppeal
//   identity verification (Didit)             functions/didit.js
//   KYC tier payment caps                     functions/creatorPayouts.js KYC_MONTHLY_CAP_MICRO_USD
//   Scheduled payout cadence + $100 minimum   functions/creatorPayouts.js CADENCE / MIN_PAYOUT_GEMS
//   country blocking                          functions/geo.js
//
// If any of those change, change the matching sentence here in the same commit.
// A compliance page that overstates the controls is worse than none: it is the
// document a regulator or an acquirer holds you to.

import { OPERATOR, LEGAL_VERSION } from './legalContent';

// 2026-08-20: revised only to name the new operating entity (Vergr LLC,
// Kentucky) in place of Murmont LLC. No control, threshold or timeframe in
// these documents changed.
const POLICY_UPDATED = 'Last updated: August 20, 2026';
const POLICY_EFFECTIVE = 'Effective: August 14, 2026';

const list = (items) => ({ type: 'list', items });

const base = {
  version: LEGAL_VERSION,
  updated: POLICY_UPDATED,
  effective: POLICY_EFFECTIVE,
};

// ═════════════════════════════════════════════════════════════════════
//                     CONTENT MODERATION POLICY
// ═════════════════════════════════════════════════════════════════════

export const CONTENT_MODERATION_POLICY = {
  ...base,
  label: 'Content Moderation Policy',
  intro: [
    `VERGR is a live streaming and social app, operated by ${OPERATOR.legalName}. People come here to go live, share clips, hang out in squads and message each other. This policy explains how we keep that space safe: what is not allowed, how we detect it, who decides, and what happens next.`,
    'We use a combination of automated scanning and trained human reviewers. Automated systems run before content becomes visible. Humans decide anything that is contested, and every human decision is recorded.',
  ],
  sections: [
    {
      id: 'prohibited',
      title: '1. What is not allowed',
      body: [
        'The following are prohibited everywhere on VERGR, on every surface, whether free or paid, public or private, and regardless of who is watching.',
        list([
          'Nudity and sexual content. Sexually explicit or suggestive material of any kind is prohibited. This covers video, images, audio, text, gestures and emoji. Offering or soliciting sexual services or sexual interactions through VERGR is prohibited and results in immediate account removal.',
          'Any sexual content involving a minor, or any person who appears to be a minor. This is treated separately and absolutely. See our CSAM, Non-Consensual and Illegal Content Procedures.',
          'Content depicting or promoting real-world graphic violence, gore, cruelty to animals, self-harm or suicide. Violence within video games is not covered by this restriction and is permitted.',
          'Hate speech, and material that promotes prejudice or discrimination on the basis of ethnicity, race, gender, sexual orientation, religion, disability or any other personal attribute.',
          'Harassment, bullying, threats and coordinated pile-ons.',
          'Terrorism, violent extremism, and the promotion of organised crime.',
          'Sharing another person\'s private information without their consent, including full names, addresses, phone numbers, email addresses, workplace or financial details.',
          'Fraud, scams, phishing, and the sale or promotion of stolen accounts, cheats or hacked goods.',
          'Impersonation, and manipulated or synthetic media presented as real, including deepfakes of real people.',
          'Content that infringes someone else\'s copyright or other intellectual property.',
          'Sale or promotion of drugs, weapons, or other regulated or unlawful goods.',
        ]),
        'Strong language and adult subject matter in conversation are not in themselves prohibited. A broadcaster may mark a stream as containing mature language or themes so viewers know what they are joining. That marking is an advisory label only. It does not permit anything on the list above, and nudity is not permitted under any label.',
      ],
    },
    {
      id: 'automated',
      title: '2. Automated detection',
      body: [
        'Automated scanning runs at the moment content is created, before it becomes visible to anyone else.',
        list([
          'Direct and group messages are scanned before the message is written.',
          'Post text is scanned when the post is created.',
          'Images are scanned before they appear.',
          'Video is scanned by sampling keyframes across the clip.',
          'Media attached to paid or locked content is scanned before any access link can be issued, and scanning failure blocks access rather than allowing it.',
        ]),
        'Each scan returns one of three outcomes. "Pass" means the content is published normally. "Flag" means the content stays visible but enters the human review queue. "Block" means the content is hidden immediately, the author is notified, and the case enters the human review queue.',
        'The blocking threshold is a confidence of 0.85 or higher on a prohibited category. The single exception is content suspected of sexualising a minor, where any suspicion at or above a confidence of 0.30 blocks the content. That threshold is deliberately set low. We accept false positives in that category because the alternative is unacceptable.',
        'Every scan, including passes, is written to an immutable moderation log with the verdict, category, confidence and reason.',
      ],
    },
    {
      id: 'human',
      title: '3. Human review',
      body: [
        'Automated systems do not have the final word on anything contested. Human review is carried out by our moderator programme, whose members hold graded authority: junior moderators may approve or reject content and issue short mutes, senior moderators may issue temporary bans and resolve disputes, and only the most senior may permanently remove an account.',
        'Live broadcasts are additionally monitored while they are running. Live streaming is real time, so material can appear before any system removes it. Viewers can report a live stream while it is in progress and reports on live content are prioritised.',
        'Every moderator action is written to an audit log recording who acted, what they did, to whom, and why. Moderators cannot delete or edit that log.',
      ],
    },
    {
      id: 'reporting',
      title: '4. Reporting',
      body: [
        'Any user can report any piece of content, any account, any message and any live stream from within the product. Reports go to the human review queue.',
        `Reports can also be sent to ${OPERATOR.abuseEmail}. Reports concerning a minor, non-consensual intimate imagery, or an immediate threat to someone's safety are escalated ahead of the queue and are actioned on the same day they are received.`,
        'You do not need an account to report content that concerns a minor or an immediate risk to life. Email us.',
      ],
    },
    {
      id: 'enforcement',
      title: '5. Enforcement',
      body: [
        'What we do depends on what happened, whether it was deliberate, and what the account has done before.',
        list([
          'Content removal, on its own, for a first minor breach.',
          'Temporary restriction on posting, messaging, or broadcasting.',
          'Suspension of monetisation, including the ability to receive tips or sell access.',
          'Temporary suspension of the account.',
          'Permanent removal of the account.',
          'Withholding of funds where earnings are traceable to the breach, and referral to law enforcement where the conduct is criminal.',
        ]),
        'Sexual content, and any conduct that endangers a minor, skip the graduated scale and result in immediate removal.',
      ],
    },
    {
      id: 'appeals',
      title: '6. Appeals',
      body: [
        'If your content was removed or your account was restricted, you can appeal from within the product. An appeal is reviewed by a person who was not involved in the original decision.',
        'We aim to respond to appeals within seven days. If an appeal succeeds the content is restored, the strike is removed from your record, and any earnings withheld on that basis are released.',
        'Decisions in the minor-safety category are not reversed on appeal without positive evidence that the original decision was mistaken.',
      ],
    },
    {
      id: 'contact',
      title: '7. Contact',
      body: [
        `Content moderation questions: ${OPERATOR.abuseEmail}. We aim to acknowledge within two business days.`,
        `${OPERATOR.legalName}, ${OPERATOR.registeredAddress}.`,
      ],
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════
//                   ID&V AND CONSENT PROCEDURES
// ═════════════════════════════════════════════════════════════════════

export const IDV_AND_CONSENT_PROCEDURES = {
  ...base,
  label: 'ID&V and Consent Procedures',
  intro: [
    'This document sets out how VERGR verifies the identity of the people who earn money on the platform, and how we handle consent for anyone who appears in content published here.',
    'VERGR prohibits sexual content entirely, so we do not operate a performer-consent regime for adult material. These procedures exist because money moves between real people on this platform, and because a person who appears in a broadcast has rights in how they appear.',
  ],
  sections: [
    {
      id: 'who',
      title: '1. Who must be identity-verified',
      body: [
        'Identity verification is mandatory before any of the following:',
        list([
          'Being paid revenue share by VERGR in any amount.',
          'Converting earned balances into a redeemable asset.',
          'Receiving a payout as a moderator or programme participant.',
        ]),
        'Creating an account, buying platform currency, tipping another user, or broadcasting do not require identity verification. Verification is tied to taking money out, not to putting money in.',
      ],
    },
    {
      id: 'how',
      title: '2. How identity is verified',
      body: [
        'Verification is performed by Didit, a third-party identity verification provider, through a hosted flow. The check consists of a government-issued photographic identity document, a live selfie, and a liveness test that confirms a real person is present rather than a photograph or a recording.',
        'VERGR does not receive, process or store the identity documents themselves. We receive the outcome of the check and the minimum data needed to act on it. Identity documents are held by the verification provider under its own retention terms.',
        'A self-declared date of birth at signup is not identity verification and never substitutes for it.',
      ],
    },
    {
      id: 'tiers',
      title: '3. Graduated verification',
      body: [
        'Verification depth increases with the amount being paid out.',
        list([
          'Level 0, no verification: no payment permitted.',
          'Level 1, identity document and selfie: payment up to 50 US dollars per month.',
          'Level 2, adds proof of address: payment up to 2,500 US dollars per month, and eligibility for a faster payout schedule.',
          'Level 3, adds source of funds evidence: payment up to 15,000 US dollars per month.',
        ]),
        'Limits are enforced on the server against the calendar month. Earnings above the cap for the account\'s current level remain owed and carry into a later payment; they are never forfeited.',
      ],
    },
    {
      id: 'consent',
      title: '4. Consent of people appearing in content',
      body: [
        'You may only publish content featuring another identifiable person where that person has agreed to appear and to the content being published.',
        'This applies to recorded content, to live broadcasts, and to any clip taken from a broadcast. It applies to co-hosts and guests, who consent to appear by joining, and equally to anyone else visible or audible in your stream.',
        'Consent can be withdrawn. A person who appears in content published on VERGR may ask us to remove it, whether or not they hold an account. Requests are actioned on receipt where the person is identifiable, and we do not require the person to prove they never consented.',
        'Publishing content of an identifiable person who has not agreed to it is a breach of these procedures. Where such content is also intimate in nature it is handled under our CSAM, Non-Consensual and Illegal Content Procedures and results in immediate account removal.',
      ],
    },
    {
      id: 'records',
      title: '5. Records',
      body: [
        'We retain the verification outcome, the level attained, and the date, for as long as the account exists and for five years after closure, in order to meet financial record-keeping obligations.',
        `Requests about your verification record: ${OPERATOR.privacyEmail}.`,
      ],
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════
//                      AGE VERIFICATION PROCESS
// ═════════════════════════════════════════════════════════════════════

export const AGE_VERIFICATION_PROCESS = {
  ...base,
  label: 'Age Verification Process',
  intro: [
    'VERGR is an 18+ service. Nobody under the age of 18 may hold an account, appear as a broadcaster, or receive money through the platform.',
    'This document explains how we establish age, what happens when we get it wrong, and what we do when we find an underage account.',
  ],
  sections: [
    {
      id: 'signup',
      title: '1. At signup',
      body: [
        'Every account must supply a date of birth during registration. An entered date of birth below 18 years ends registration. The account is not created and cannot be created by returning and entering a different date on the same attempt.',
        'We treat a self-declared date of birth as a first filter, not as proof. It stops the casual case. It does not stop a determined one, and we do not present it as though it does.',
      ],
    },
    {
      id: 'verified',
      title: '2. Documentary verification',
      body: [
        'Documentary age verification, through a government identity document plus a live selfie and liveness check, is required before any person can be paid money by the platform. That check establishes age as well as identity, and is described in our ID&V and Consent Procedures.',
        'This means every person who earns money on VERGR has had their age confirmed against a government identity document. It is the point at which real-world consequences attach, and so it is the point at which we require real-world proof.',
      ],
    },
    {
      id: 'signals',
      title: '3. Ongoing signals',
      body: [
        'Age is not only checked at the door. We act on signals that arise later.',
        list([
          'Automated scanning of images and video assesses apparent age, and any content suspected of depicting a minor in a sexual context is blocked at a deliberately low confidence threshold.',
          'Reports from other users that an account holder appears to be a minor are prioritised in the review queue.',
          'Moderators reviewing live broadcasts may suspend a stream and require verification where the broadcaster appears to be underage.',
        ]),
      ],
    },
    {
      id: 'suspected',
      title: '4. When we suspect an account is underage',
      body: [
        'Where there is a credible indication that an account holder is under 18 we suspend the account immediately rather than investigating while it stays live. The account holder is told why and is given the opportunity to complete documentary verification.',
        'If verification is not completed, or confirms the person is under 18, the account is permanently closed. Content is removed. Any balance is handled under the Terms of Service, and no payout is made to a person confirmed to be a minor.',
        'Where the account was involved in content of a sexual nature, our CSAM, Non-Consensual and Illegal Content Procedures apply and reporting to authorities follows.',
      ],
    },
    {
      id: 'report',
      title: '5. Reporting an underage user',
      body: [
        `If you believe someone on VERGR is under 18, report the account in the product or email ${OPERATOR.abuseEmail}. You do not need an account to make this report.`,
        'Reports of this type are triaged the day they arrive.',
      ],
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════
//        ANTI-MODERN SLAVERY AND HUMAN TRAFFICKING STATEMENT
// ═════════════════════════════════════════════════════════════════════

export const ANTI_SLAVERY_STATEMENT = {
  ...base,
  label: 'Anti-Modern Slavery and Human Trafficking Statement',
  intro: [
    `This statement sets out the steps taken by ${OPERATOR.legalName} to ensure that modern slavery and human trafficking take place neither in our business nor on our platform.`,
    'We are a small technology company operating a digital platform. We have no manufacturing, no physical supply chain and no labour-intensive operations. The risk in our business is therefore not in procurement. It is in the possibility that our platform is used to exploit somebody, and that is where our controls are directed.',
  ],
  sections: [
    {
      id: 'business',
      title: '1. Our business and structure',
      body: [
        `${OPERATOR.legalName} is a limited liability company registered in the ${OPERATOR.formationState} under registration number ${OPERATOR.registrationNumber}, with its registered office at ${OPERATOR.registeredAddress}. We operate VERGR, a live streaming and social app.`,
        'Our suppliers are cloud infrastructure, payment processing and identity verification providers. These are established corporate vendors in low-risk sectors.',
      ],
    },
    {
      id: 'risk',
      title: '2. Where the risk actually is',
      body: [
        'We assess our principal modern slavery risk as the use of the platform itself as a channel for exploitation. Live streaming platforms that allow individuals to earn money from an audience carry a recognised risk that a person is being made to broadcast, or that their earnings are being taken from them by someone else.',
        'Specific risk indicators we treat seriously:',
        list([
          'A broadcaster who appears to be under the direction or control of another person off camera.',
          'Multiple accounts controlled from a single device or location, paid to a single destination.',
          'Earnings routed to a person other than the account holder.',
          'A broadcaster who appears distressed, coerced, confined, or unable to end a broadcast freely.',
          'Signs that a broadcaster is a minor.',
          'Recruitment of users into off-platform arrangements involving travel, accommodation or work.',
        ]),
      ],
    },
    {
      id: 'controls',
      title: '3. Controls',
      body: [
        list([
          'Sexual content and the offering of sexual services are prohibited outright. This removes the commercial activity most closely associated with trafficking on streaming platforms.',
          'Every person who is paid is identity-verified against a government document with a liveness check, so earnings are tied to a confirmed real individual rather than to an anonymous account.',
          'Payments are made only to a payout account registered by the verified account holder, in matching name, and are made on a fixed schedule rather than on demand, which gives time for a concern to be raised and acted on before money leaves.',
          'Automated monitoring flags patterns consistent with third-party control of multiple accounts.',
          'Moderators are briefed on coercion indicators in live broadcasts and can end a stream and suspend an account without waiting for a decision from anyone else.',
          'Accounts are blocked in territories subject to sanctions or where we cannot operate lawfully.',
        ]),
      ],
    },
    {
      id: 'response',
      title: '4. Response',
      body: [
        'Where we identify a credible indication of trafficking or forced labour, we suspend the accounts involved, freeze associated funds so that they cannot be moved by a controlling party, preserve evidence, and report to law enforcement in the relevant jurisdiction.',
        'We do not warn the account holder in advance where doing so could put a person at greater risk, or where it could alert a controlling party.',
        'We will always cooperate with a law enforcement request relating to a suspected trafficking victim, and we treat those requests as urgent.',
      ],
    },
    {
      id: 'training',
      title: '5. Training and review',
      body: [
        'Moderators receive guidance on the indicators listed above as part of their induction, and that guidance is refreshed when new patterns are identified.',
        'This statement is reviewed annually and on any material change to how the platform operates.',
      ],
    },
    {
      id: 'contact',
      title: '6. Contact',
      body: [
        `Concerns can be raised in confidence to ${OPERATOR.legalEmail}. If you believe a person is in immediate danger, contact your local emergency services first.`,
      ],
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════
//    CSAM, NON-CONSENSUAL OR ILLEGAL CONTENT PROCEDURES
// ═════════════════════════════════════════════════════════════════════

export const CSAM_AND_ILLEGAL_CONTENT_PROCEDURES = {
  ...base,
  label: 'CSAM, Non-Consensual and Illegal Content Procedures',
  intro: [
    'VERGR has zero tolerance for child sexual abuse material, for intimate imagery shared without consent, and for other illegal content. This document sets out exactly what we do when such material is detected or reported.',
    'These procedures override every other consideration on this platform, including any commercial or contractual relationship with the account involved.',
  ],
  sections: [
    {
      id: 'definitions',
      title: '1. Scope',
      body: [
        list([
          'Child sexual abuse material: any content that depicts, describes or sexualises a person under 18, or a person who appears to be under 18. Apparent age governs. We do not require proof of actual age before acting.',
          'Non-consensual intimate imagery: intimate or sexual imagery of a person shared without that person\'s consent, including material originally created consensually, and including material created or altered synthetically.',
          'Sexual extortion: threatening to publish intimate imagery of a person in order to obtain money, further imagery, or any other thing.',
          'Other illegal content: terrorist material, incitement to violence, sale of controlled goods, and content otherwise unlawful in a jurisdiction where we operate.',
        ]),
        'Sexual content of all kinds is prohibited on VERGR. The categories above are treated separately because they are criminal, not merely prohibited.',
      ],
    },
    {
      id: 'detection',
      title: '2. Detection',
      body: [
        'Images and video are scanned automatically before they become visible. Any content suspected of sexualising a minor is blocked at a confidence of 0.30 or above, far below the threshold used for any other category. This will block content that turns out to be innocent. That is the intended trade-off and we do not tune it upward to reduce false positives.',
        'Text in messages and posts is scanned for grooming and solicitation language.',
        'Media attached to paid or locked content is scanned before an access link can be issued. If a scan cannot be completed, access is refused rather than granted.',
      ],
    },
    {
      id: 'immediate',
      title: '3. Immediate actions on detection or report',
      body: [
        'On detection or credible report, in this order:',
        list([
          'The content is made inaccessible immediately. This happens automatically and does not wait for human confirmation.',
          'The account is suspended, and any other account we can associate with the same person is suspended.',
          'All associated funds are frozen and no payment can be processed.',
          'The content and surrounding account data are preserved in a secure, access-controlled hold for the purpose of law enforcement disclosure. Preservation happens even where the content is deleted from the user-facing product, and a user deletion request does not destroy preserved material in this category.',
          'The case is escalated to our most senior review level. Junior moderators cannot clear a case in this category.',
          'A report is made to the appropriate authority.',
        ]),
        'We do not notify the account holder of a suspected child safety report before reporting to authorities, because doing so risks destruction of evidence and further harm.',
      ],
    },
    {
      id: 'reporting',
      title: '4. Reporting to authorities',
      body: [
        'Confirmed or strongly suspected child sexual abuse material is reported to the National Center for Missing and Exploited Children (NCMEC), and to law enforcement in the jurisdiction of the account holder and of any identified victim.',
        'We provide the preserved content, account identifiers, registration and access records, payment records where relevant, and any other information lawfully requested.',
        'Reports are made promptly on confirmation, and we do not delay a report pending an internal appeal.',
      ],
    },
    {
      id: 'victims',
      title: '5. If you are the person in the content',
      body: [
        `Email ${OPERATOR.abuseEmail} with the words URGENT REMOVAL in the subject line. You do not need a VERGR account, you do not need to identify the account that posted it, and you will not be asked to send us a copy of the imagery.`,
        'We remove reported non-consensual intimate imagery on receipt, before completing any investigation. We would rather remove something wrongly and restore it than leave it up while we deliberate.',
        'If you are under 18, or the content shows you when you were under 18, tell us that. We will treat it under the child protection route above, which means it is reported to authorities as well as removed.',
        'We will not disclose your identity to the person who posted the content.',
      ],
    },
    {
      id: 'noappeal',
      title: '6. Appeals in this category',
      body: [
        'Removals in this category are not reversed on the basis that the account holder disagrees. An account holder who says the material was lawful must provide positive evidence, and the decision is made at senior review level.',
        'Where a report to an authority has already been made, we do not withdraw it. That is a matter for the authority.',
      ],
    },
    {
      id: 'contact',
      title: '7. Contact',
      body: [
        `Reports and law enforcement correspondence: ${OPERATOR.abuseEmail}.`,
        `${OPERATOR.legalName}, ${OPERATOR.registeredAddress}.`,
      ],
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════
//            CONTACTING LAW ENFORCEMENT GUIDELINES
// ═════════════════════════════════════════════════════════════════════

export const LAW_ENFORCEMENT_GUIDELINES = {
  ...base,
  label: 'Contacting Law Enforcement Guidelines',
  intro: [
    'This document is for law enforcement officers and government agencies seeking information from VERGR, and for users who want to understand when and how we contact authorities.',
    `All law enforcement correspondence should be sent to ${OPERATOR.legalEmail} with LAW ENFORCEMENT REQUEST in the subject line.`,
  ],
  sections: [
    {
      id: 'operator',
      title: '1. Who to serve',
      body: [
        `${OPERATOR.legalName}, a limited liability company registered in the ${OPERATOR.formationState} under registration number ${OPERATOR.registrationNumber}.`,
        `Registered address: ${OPERATOR.registeredAddress}.`,
        `Registered agent for service of process: ${OPERATOR.registeredAgent}, at the registered address above.`,
        `Email for legal process: ${OPERATOR.legalEmail}.`,
      ],
    },
    {
      id: 'when-we-contact',
      title: '2. When we contact law enforcement on our own initiative',
      body: [
        'We report proactively, without waiting to be asked, in the following circumstances:',
        list([
          'Child sexual abuse material, or any credible indication that a minor is being sexually exploited or groomed. Reported to NCMEC and to relevant national authorities.',
          'A credible threat to a person\'s life, including a credible statement of intent to commit suicide or serious self-harm, and threats of violence against an identified person.',
          'Indications of human trafficking, forced labour or coercive control of an account holder.',
          'Terrorist content or credible planning of a terrorist act.',
          'Where we identify proceeds of crime or a sanctions match in the course of monitoring payments.',
        ]),
        'In an emergency involving a risk to life we will contact the fastest appropriate authority directly rather than waiting for legal process, and we will disclose the minimum information needed to address the emergency.',
      ],
    },
    {
      id: 'requests',
      title: '3. Requests from law enforcement to us',
      body: [
        'We require valid legal process appropriate to the data sought. As a general rule:',
        list([
          'Basic subscriber information, meaning the account identifier, registration date, email address and registration country, requires a subpoena or its equivalent, or an emergency request.',
          'Access and transactional records require a court order or its equivalent.',
          'Content, meaning messages, posts and stored media, requires a search warrant or its equivalent.',
          'Requests from outside the United States should be made through a mutual legal assistance treaty or letter rogatory, unless the request is an emergency.',
        ]),
        'Include the account identifier or profile URL, the specific records sought, and the relevant date range. A request for "all data" on an account will be narrowed before it is answered.',
      ],
    },
    {
      id: 'emergency',
      title: '4. Emergency disclosure',
      body: [
        `Where there is an imminent risk of death or serious physical harm, mark the email EMERGENCY DISCLOSURE REQUEST and send it to ${OPERATOR.legalEmail}. State the nature of the emergency, the risk, and why the information is needed now.`,
        'We aim to respond to genuine emergency requests within hours, and we will disclose without legal process where we form a good-faith belief that an emergency involving danger to a person requires it.',
      ],
    },
    {
      id: 'preservation',
      title: '5. Preservation',
      body: [
        'We will preserve account records on request for 90 days pending service of legal process, extendable once on request. Send preservation requests to the same address, identifying the account precisely.',
        'Material in the child safety category is preserved automatically on detection, without a request.',
      ],
    },
    {
      id: 'notice',
      title: '6. Notice to users',
      body: [
        'Our policy is to notify a user that their information has been requested, so they may object, unless we are legally prohibited from doing so, or unless we believe notice would create a risk of harm to a person, of destruction of evidence, or of flight.',
        'We do not notify in the child safety, trafficking, or imminent-harm categories.',
      ],
    },
    {
      id: 'users',
      title: '7. For users reporting a crime',
      body: [
        'If you are in immediate danger, contact your local emergency services. We are not an emergency service and cannot dispatch help.',
        `To report criminal conduct on the platform, use the in-product report tool or email ${OPERATOR.abuseEmail}. Tell us if you have already made a police report and give us the reference, as it helps us respond to the resulting request quickly.`,
      ],
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════
//                   ANTI-MONEY LAUNDERING POLICY
// ═════════════════════════════════════════════════════════════════════

export const AML_POLICY = {
  ...base,
  label: 'Anti-Money Laundering Policy',
  intro: [
    `${OPERATOR.legalName} operates a platform on which users purchase Coins from us and spend them on our features and on access to creator content. Coins are a licence to use the platform: they cannot be transferred between users, cannot be redeemed for cash, and cannot be withdrawn. We sell to buyers as principal, and we pay creators a share of the revenue their content generates, on our own schedule, as we would any supplier. No user transfers money to any other user. This policy sets out the controls applied to prevent the platform being used for money laundering, terrorist financing or sanctions evasion.`,
    'The controls described here are implemented in the platform itself and are enforced on the server. They are not discretionary.',
  ],
  sections: [
    {
      id: 'principles',
      title: '1. Principles',
      body: [
        list([
          'Money can only leave the platform to a person whose identity has been verified against a government document.',
          'Money can only leave to a destination the verified account holder has registered in advance.',
          'The amount that can leave is capped according to the depth of verification completed.',
          'Payments in and payments out are reconciled daily against the total owed to creators, and a discrepancy freezes payouts rather than being absorbed.',
        ]),
      ],
    },
    {
      id: 'cdd',
      title: '2. Customer due diligence',
      body: [
        'Identity verification is mandatory before any creator can be paid. It consists of a government photographic identity document, a live selfie and a liveness check, performed by a third-party provider. A tax form appropriate to the creator jurisdiction is also collected before a first payment.',
        'Enhanced due diligence, in the form of documented source of funds, is required before a creator may be paid at the highest tier, and may be required at any point where activity is inconsistent with the account\'s profile.',
        'Payout limits by verification level. These cap what VERGR pays a creator in a calendar month. Users cannot withdraw, so there is no user-initiated limit to state:',
        list([
          'Unverified: no payment is made.',
          'Identity verified: up to 50 US dollars per month.',
          'Identity and address verified: up to 2,500 US dollars per month.',
          'Identity, address and source of funds verified: up to 15,000 US dollars per month.',
        ]),
        'Caps are enforced server-side by the payout engine against the calendar month. Earnings above the cap remain owed and carry into a later run rather than being paid.',
      ],
    },
    {
      id: 'geo',
      title: '3. Sanctions and geographic restrictions',
      body: [
        'We block access from territories subject to comprehensive sanctions, and from territories where we cannot lawfully provide the service. The blocked list is maintained in the platform and applied to account creation, payment and creator payout.',
        'Where a sanctions match arises we freeze the account and the associated balance, and we do not pay any revenue share pending resolution.',
      ],
    },
    {
      id: 'monitoring',
      title: '4. Monitoring',
      body: [
        'Creator revenue share is paid on a fixed schedule set by VERGR, not on demand. The interval between a creator earning and being paid is itself the review window, and a payout can be held or stopped inside it.',
        'Activity is monitored for patterns including:',
        list([
          'Purchase of Coins followed by immediate concentration on a single creator with no other use of the service.',
          'Structuring, meaning repeated transactions positioned just below a threshold.',
          'Multiple purchasing accounts concentrating spend on one creator payee.',
          'A purchasing account and a creator payee that appear to be controlled by the same person.',
          'Creator payout details that change shortly before a large scheduled payout.',
          'Activity inconsistent with the account\'s stated profile or its history.',
        ]),
        'A daily reconciliation compares the platform\'s recorded user balances and revenue against the custodial balance actually held. A material discrepancy freezes creator payouts automatically and raises an alert.',
      ],
    },
    {
      id: 'reporting',
      title: '5. Investigation and reporting',
      body: [
        'Flagged activity is reviewed by a member of staff independent of the flag. Where suspicion is not dispelled, the account is restricted, the balance frozen, and a report is made to the appropriate financial intelligence unit.',
        'We do not tell an account holder that they are the subject of a suspicious activity report.',
        'Records of verification, transactions and investigations are retained for five years from the closure of the account or the completion of the transaction, whichever is later.',
      ],
    },
    {
      id: 'responsibility',
      title: '6. Responsibility',
      body: [
        'Responsibility for this policy sits with the company\'s directors. The policy is reviewed annually and following any material change to payment methods, payout routes or applicable law.',
        `Questions: ${OPERATOR.legalEmail}.`,
      ],
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════
//     TRANSACTION MONITORING, ANTI-FRAUD AND CHARGEBACK POLICY
// ═════════════════════════════════════════════════════════════════════

export const ANTI_FRAUD_POLICY = {
  ...base,
  label: 'Transaction Monitoring, Anti-Fraud and Chargeback Policy',
  intro: [
    'This policy describes how VERGR monitors transactions, prevents fraud, and handles disputes and chargebacks.',
    'Our exposure is straightforward: someone may buy Coins with a stolen card and spend them on a creator they control, so that the value leaves as a creator payout before the chargeback lands. Most of the controls below exist to break that sequence.',
  ],
  sections: [
    {
      id: 'prevention',
      title: '1. Prevention at the point of purchase',
      body: [
        list([
          'Purchases are processed by our payment providers, who apply their own screening. Card details are never held by VERGR.',
          'Purchases from blocked territories are refused before payment is attempted.',
          'Prices are quoted and charged by the server. The client never determines what is charged, so a manipulated client cannot alter the amount.',
          'Payment settlement is reconciled against a single record per order so that a payment cannot be credited twice.',
        ]),
      ],
    },
    {
      id: 'velocity',
      title: '2. Monitoring',
      body: [
        'We monitor for the following, and act automatically on the strongest signals:',
        list([
          'A new account that purchases Coins and concentrates the whole balance on one creator within a short window.',
          'Multiple payment instruments used on one account, or one instrument used across many accounts.',
          'A cluster of accounts sharing a device fingerprint or network origin and concentrating spend on a single creator payee.',
          'Purchase volume inconsistent with the account\'s history.',
          'Creator payout details registered or changed shortly before a large scheduled payout.',
        ]),
        'Cases are reviewed by staff. Automated systems restrict, they do not permanently terminate.',
      ],
    },
    {
      id: 'holds',
      title: '3. Holds on outgoing funds',
      body: [
        'Every creator payout runs on a schedule VERGR sets, never on demand. Funds are not sent during that period and the request can be cancelled by the account holder.',
        'Payouts are only ever sent to a destination the verified creator account holder registered in advance. A newly registered destination is subject to additional delay.',
        'Where a purchase is disputed, or an account is under investigation, outgoing funds are frozen regardless of where they sit in the hold period.',
      ],
    },
    {
      id: 'chargebacks',
      title: '4. Chargebacks',
      body: [
        'A chargeback on a purchase of platform currency results in the following:',
        list([
          'The purchased currency is removed from the account. Where it has already been spent, the account goes to a negative balance which must be settled before any further payout.',
          'Payouts on the account are suspended pending resolution.',
          'Where the value was transferred to another account before the chargeback, we trace and freeze it at the receiving account where it has not yet been paid out.',
          'An account with a confirmed fraudulent chargeback is closed and is not permitted to return.',
        ]),
        'We contest chargebacks we believe to be illegitimate, and we retain the delivery evidence needed to do so: the purchase record, the delivery of the virtual currency to the account, and the subsequent in-platform activity.',
        'Purchases of virtual currency are delivered instantly and are consumed within the platform. Our Refund Policy governs when a refund is available. Requesting a chargeback rather than contacting us first delays resolution and results in the account being restricted while the dispute runs.',
      ],
    },
    {
      id: 'account-takeover',
      title: '5. Account takeover',
      body: [
        'Where we detect a sign-in pattern consistent with account takeover, we can require re-authentication, suspend outgoing transfers, and revoke active sessions.',
        'Two-factor authentication is available to all accounts and is required for administrative access.',
        `If you believe your account has been accessed by someone else, email ${OPERATOR.supportEmail} immediately. We will freeze outgoing funds while we investigate.`,
      ],
    },
    {
      id: 'contact',
      title: '6. Disputes and contact',
      body: [
        `Before raising a dispute with your bank or card issuer, contact ${OPERATOR.supportEmail}. Most disputes are resolved faster directly, and a chargeback restricts your account while it runs.`,
        `${OPERATOR.legalName}, ${OPERATOR.registeredAddress}.`,
      ],
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════


// ═════════════════════════════════════════════════════════════════════
// CREATOR REVENUE SHARE AGREEMENT
//
// This is the document a creator accepts at /creator/apply. It is the
// foundation of the principal model in docs/REVENUE_SHARE_PLAN.md: the
// argument only holds if there is a real supplier who really agreed, on a
// date, from an identified account. Every number in it is read out of the
// code rather than asserted.
// ═════════════════════════════════════════════════════════════════════

export const CREATOR_AGREEMENT = {
  ...base,
  label: 'Creator Revenue Share Agreement',
  intro: [
    `This agreement is between you and ${OPERATOR.legalName}, which operates VERGR. It applies once your creator application is approved, and it sets out how you earn, what you keep, and when you are paid.`,
    'Anyone can use VERGR without being a creator. You do not have to accept this to post, stream, join a squad or buy coins. It applies only if you want to earn.',
  ],
  sections: [
    {
      id: 'relationship',
      title: '1. What this is',
      body: [
        'You are an independent supplier of content services to VERGR. You are not our employee, partner or agent, and nothing here creates that relationship.',
        'When someone buys coins, they are buying from VERGR. When they spend those coins on your content, VERGR earns that revenue and owes you a share of it. You are paid by VERGR, not by the person who spent the coins.',
        'In practice this means one thing that matters to you: VERGR pays you. You are never chasing a viewer for money, and what you have earned does not depend on them.',
      ],
    },
    {
      id: 'share',
      title: '2. What you keep',
      body: [
        'Your share is set by a published ladder based on everything you have earned on VERGR to date. It starts at 50% and rises to 80%. It never goes down, and lifetime earnings never reset.',
        list([
          'Tier 1, from $0 earned: you keep 50%',
          'Tier 2, from $50: you keep 55%',
          'Tier 3, from $250: you keep 60%',
          'Tier 4, from $1,000: you keep 65%',
          'Tier 5, from $5,000: you keep 70%',
          'Tier 6, from $15,000: you keep 75%',
          'Tier 7, from $50,000: you keep 80%',
        ]),
        'There is no separate fee, commission or charge on top of this. The share is the whole arrangement. We do not charge you to be a creator, to see your earnings, or to be paid.',
        'Your current tier and your progress toward the next one are always visible in Creator Studio.',
      ],
    },
    {
      id: 'accrual',
      title: '3. How earnings accrue',
      body: [
        'Your share accrues at the moment revenue is earned, automatically. There is nothing to claim and nothing to convert.',
        'Accrued earnings are a debt VERGR owes you. They are not a balance you hold, not an account, not transferable to another person, and not spendable on VERGR.',
        'If someone supports you before your application is approved, that value is held and credited to you when you are approved. It is never taken and never lost.',
      ],
    },
    {
      id: 'payout',
      title: '4. When you are paid',
      body: [
        'VERGR calculates what is owed and pays it on a schedule. You do not request payments and cannot choose the timing or the amount.',
        'Everyone starts on a monthly schedule. It moves to twice monthly, then weekly, as your history with us lengthens: the requirements are days since your first payout, number of successful payouts, and identity verification level. Any active strike returns you to monthly until it expires.',
        'Before any payment can be sent you must have: no suspension, identity verified, a tax form on file, a payout account connected, a balance above the minimum, and an account at least 30 days old.',
        'Every requirement above is shown to you, with your current status against each one, in Creator Studio. You will never be left guessing why a payment has not arrived.',
        'Payments are made through a payout partner who becomes the payer of record. Their own identity checks apply and are separate from ours.',
      ],
    },
    {
      id: 'obligations',
      title: '5. What we expect from you',
      body: [
        list([
          'Follow the Acceptable Use Policy and every other VERGR policy. Earning does not create an exception to any of them.',
          'Only publish content you have the right to publish, including music, clips and anything featuring another person.',
          'Do not manufacture engagement or earnings, including self-funded transactions, coordinated tipping, or accounts created to inflate your own numbers.',
          'Keep your identity and tax information accurate and current.',
          'You are responsible for your own taxes. We report as the law requires, and we do not withhold on your behalf unless required to.',
        ]),
      ],
    },
    {
      id: 'suspension',
      title: '6. Strikes, suspension and removal',
      body: [
        'Policy violations result in strikes. Strikes expire after 180 days. While you hold any active strike your payout schedule returns to monthly. Three active strikes suspend payouts entirely.',
        'Suspension holds payment; it does not cancel what you have earned. Earnings already accrued remain owed to you and are paid once the suspension is resolved, unless they arose from fraud.',
        'Earnings obtained through fraud, manufactured engagement or stolen content may be withheld or reversed. This is the only circumstance in which accrued earnings are not paid.',
        'You can appeal any decision. Appeals are reviewed by a person.',
      ],
    },
    {
      id: 'changes',
      title: '7. Changes and ending this agreement',
      body: [
        'If we change the share ladder or the payout schedule we will tell you before it takes effect. A change never reduces a share you have already earned.',
        'You can stop being a creator at any time. Anything already accrued is still paid to you on the normal schedule.',
        'We may end this agreement for a serious or repeated policy breach. Everything owed to you is still paid, subject to the fraud exception above.',
      ],
    },
  ],
};

export const COMPLIANCE_DOCUMENTS = {
  content_moderation: CONTENT_MODERATION_POLICY,
  idv_consent:        IDV_AND_CONSENT_PROCEDURES,
  age_verification:   AGE_VERIFICATION_PROCESS,
  anti_slavery:       ANTI_SLAVERY_STATEMENT,
  csam:               CSAM_AND_ILLEGAL_CONTENT_PROCEDURES,
  law_enforcement:    LAW_ENFORCEMENT_GUIDELINES,
  aml:                AML_POLICY,
  anti_fraud:         ANTI_FRAUD_POLICY,
  creator_agreement:  CREATOR_AGREEMENT,
};
