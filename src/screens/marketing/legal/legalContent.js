// VERGR legal documents — full text.
//
// This file is the single source of truth for the Terms of Service, Privacy
// Policy, Refund Policy, Acceptable Use Policy, and Cookie Policy. The
// marketing site renders this content; the signup flow + the
// TosVersionGate use LEGAL_VERSION to know when re-acceptance is required.
//
// Data shape:
//   {
//     label:     string — page title
//     updated:   string — human-readable "Last updated: ..." label
//     version:   number — bump when material terms change (forces re-accept)
//     intro:     string|array<string> — opening paragraph(s)
//     sections:  Array<{
//       id:      string  — anchor id (used for in-page nav and ToS deep links)
//       title:   string  — section heading
//       body:    Array<paragraph|list> — section content. A paragraph is a
//                          plain string; a list is { type: 'list', items: [] }.
//     }>
//   }
//
// Drafting notes (read before editing):
//   • All four documents must remain consistent. If you change a number,
//     a payout window, a payment minimum, or a rate here, you must change
//     it everywhere the platform uses it — in src/utils/vpSystem.js,
//     functions/coinLedger.js, functions/creatorPayouts.js, etc.
//   • Defined terms (capitalized in the prose) MUST appear in the Definitions
//     section of the Terms of Service. If you introduce a new defined term,
//     add it there too.
//   • Where the prose says "VERGR may", that is a unilateral right; where it
//     says "VERGR will", that is a binding obligation. Be careful which you use.
//   • This is platform-drafted compliance documentation, not a substitute for
//     review by qualified counsel before public launch.

export const LEGAL_VERSION = 5;
export const LEGAL_UPDATED = 'July 29, 2026';
export const LEGAL_EFFECTIVE = 'May 13, 2026';

// ─────────────────────────────────────────────────────────────────────
// Operator / contact details — used across documents. Update these if
// the legal entity, registered address, or contact email changes.
// ─────────────────────────────────────────────────────────────────────

export const OPERATOR = {
  // The operating entity behind VERGR. VERGR is a product/brand; the legal
  // entity that owns and operates it is Murmont LLC (Wyoming, USA).
  // `jurisdiction` is the GOVERNING LAW of the Terms and is deliberately
  // separate from `formationState` (where the company is incorporated) —
  // changing governing law is a material terms change and requires a
  // LEGAL_VERSION bump + forced re-acceptance. Do not conflate the two.
  legalName:       'Murmont LLC',

  // ⚠ DO NOT reintroduce "trading as" / "d/b/a" wording anywhere.
  //
  // Murmont LLC has NO registered trade name (no DBA / fictitious business name
  // filing in Wyoming), and the founder has decided not to file one. Claiming to
  // "trade as VERGR" asserts a registration that does not exist, and it was one
  // of the things Stripe asked us to substantiate during underwriting — an
  // unprovable claim in our own Terms is worse than no claim at all.
  //
  // A company may market a PRODUCT under a brand name without any trade-name
  // filing. So the accurate framing is ownership, not trading identity: Vergr is
  // a product operated by Murmont LLC. That needs no registration and is exactly
  // what the OPERATOR comment above already said.
  brandName:       'VERGR',
  /** Reads correctly in a sentence: "Murmont LLC, the operator of VERGR". */
  operatorPhrase:  'the operator of VERGR',
  // Wyoming Secretary of State entity number, from the filed Articles of
  // Organization. Published because acquirer and payment-provider compliance
  // checklists require a company registration number to be displayed on the
  // site, and because it is the number that lets anyone verify the entity
  // independently at wyobiz.wyo.gov.
  registrationNumber: '2023-001339075',
  formationState:  'State of Wyoming, United States of America',
  jurisdiction:    'Republic of South Africa',
  // ⚠ Ste 11930, NOT Ste 1200. Verified 2026-08-12 against the filed Articles of
  // Organization (WY SoS, filed 2 Oct 2023, entity 2023-001339075), which give
  // 1309 Coffeen Avenue STE 11930 as BOTH the mailing address and the principal
  // office address of the company.
  //
  // Ste 1200 appears in two places and is neither of those: it is the ORGANIZER's
  // address in Article V (Andrew Pierce, the formation agent), and it is on the
  // IRS CP 575 EIN notice because that agent filed the SS-4 under their own suite.
  // Publishing it as our registered address contradicts the state filing, which is
  // the record a card underwriter or a process server actually checks.
  registeredAddress: '1309 Coffeen Ave, Ste 11930, Sheridan, WY 82801, United States',
  supportEmail:    'support@vergr.app',
  privacyEmail:    'support@vergr.app',
  legalEmail:      'support@vergr.app',
  abuseEmail:      'support@vergr.app',
  copyrightEmail:  'support@vergr.app',
  website:         'https://vergr.app',
};

// ─────────────────────────────────────────────────────────────────────
// Geographic blocklist — kept in sync with src/utils/geoBlocks.js and
// functions/geo.js. When updating any one of these three, update all
// three. The legal documents reference this list authoritatively.
// ─────────────────────────────────────────────────────────────────────

// 2026-07-08: trimmed after the ticketed-events pivot unblocked the countries/
// states previously restricted only for skill-gaming-for-cash. Remaining =
// sanctions / crypto-illegal + MENA. No US state is restricted.
export const BLOCKED_COUNTRIES_DISPLAY = [
  'China', 'North Korea', 'Iran', 'Syria', 'Cuba',
  'Russia', 'Belarus', 'Venezuela',
  'Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Kuwait', 'Iraq',
];

export const BLOCKED_US_STATES_DISPLAY = [];

// ─────────────────────────────────────────────────────────────────────
// Helper to construct a list-typed body element.
// ─────────────────────────────────────────────────────────────────────

const list = (items) => ({ type: 'list', items });

// ═════════════════════════════════════════════════════════════════════
//                          TERMS OF SERVICE
// ═════════════════════════════════════════════════════════════════════

export const TERMS_OF_SERVICE = {
  label: 'Terms of Service',
  version: LEGAL_VERSION,
  updated: `Last updated: ${LEGAL_UPDATED}`,
  effective: `Effective: ${LEGAL_EFFECTIVE}`,
  intro: [
    `These Terms of Service ("Terms") constitute a legally binding agreement between you ("you", "your", "User") and ${OPERATOR.legalName}, a limited liability company formed in the ${OPERATOR.formationState} under registration number ${OPERATOR.registrationNumber}, with its registered address at ${OPERATOR.registeredAddress}, and the owner and operator of VERGR ("VERGR", "we", "us", or "our"), the operator of the website at ${OPERATOR.website} and any associated mobile, desktop, or other applications and services (collectively, the "Service"). The Service comprises a social and live streaming platform for gamers and creators that includes user profiles, social posts, clips and short-form video, direct and group messaging, live streaming (free and paid-access), squad communities, an internal virtual currency economy, creator monetisation features, and related functionality.`,
    `By creating an account, accessing, or otherwise using the Service, you confirm that you have read, understood, and agree to be bound by these Terms, by our Privacy Policy (available at /privacy), by our Acceptable Use Policy (incorporated in Section 14 and published at /acceptable-use), by our Cookie Policy (published at /cookies), and by our Refund Policy (incorporated in Section 9). If you do not agree to all of the foregoing, you must not create an account or use the Service.`,
    `IMPORTANT — READ CAREFULLY: These Terms include (i) extensive disclaimers and limitations of liability that cap the maximum amount VERGR can ever owe you at one hundred euros (€100) or three months of fees paid, whichever is lower (Section 22); (ii) a broad indemnification by you in favour of VERGR (Section 23); (iii) a binding arbitration clause and class-action waiver that affect how disputes between you and VERGR are resolved (Section 26); (iv) a representation by you that your use of the Service is lawful in your own jurisdiction, with sole responsibility for that determination resting on you and not on VERGR (Section 4A); and (v) acknowledgement that you participate at your own risk. These provisions materially limit your legal recourse against VERGR. If you do not accept them, do not use the Service.`,
  ],
  sections: [
    {
      id: 'definitions',
      title: '1. Definitions',
      body: [
        'In these Terms, capitalised terms have the meanings set out below. Other defined terms are introduced in context.',
        list([
          '"Account" means the account you create to access the Service.',
          '"Cash-Equivalent" means having ascertainable monetary value, including through conversion into another medium that does have monetary value (for example, Gems converted to cryptocurrency).',
          '"Coins" or "VC Coins" means the virtual currency identified within the Service as VC, used for in-Service purchases, Tips, paid stream access, creator memberships, Boosts, and other interactions.',
          '"Content" means any text, image, video, audio, livestream, comment, message, profile information, or other material you submit, transmit, post, host, display, or otherwise make available through the Service.',
          '"Eligible Earnings" means accrued revenue share that meets the conditions for payment under Section 8.2.',
          '"Gems" means the unit in which VERGR records accrued revenue share owed to a Creator, as described in Section 7.4. One Gem represents one United States cent (USD 0.01) of an amount payable by VERGR. Gems are not a currency, not stored value, and not transferable.',
          '"Identity Verification" means the government-identity, photographic, and liveness check performed by our third-party verification provider (Didit or a successor we identify in the Privacy Policy).',
          '"KYC" means know-your-customer compliance, including age verification, identity verification, and screening against international sanctions and watchlists.',
          '"Didit" means our Identity Verification provider (operated at didit.me).',
          '"Revenue Share Rate" means the percentage of the gross revenue generated by a Creator\'s content that VERGR pays to that Creator, determined by their lifetime earnings as set out in Section 11.2. It is the only deduction VERGR applies to Creator earnings.',
          '"Restricted Jurisdiction" means a country, state, province, region, or other jurisdiction listed at Section 4.3, or any other jurisdiction where the operation or use of the Service would be unlawful.',
          '"Service" means VERGR as defined in the introduction to these Terms.',
          '"Paid Stream" means a live broadcast to an audience for which the broadcasting User has set a price, access to which a viewer obtains either by a one-off purchase for that broadcast or through an active creator membership with that User.',
        '"1:1 Session" means a private, invitation-only live session between exactly two Users, reachable only by a link the host sends directly. A 1:1 Session is technically limited to a single viewer and is excluded from all discovery surfaces. It is not a broadcast and is not a Paid Stream, whether or not the host has set a price for entry.',
          '"User", "you", and "your" mean any natural person who creates or uses an Account or accesses the Service.',
          '"VP" or "Vergr Points" means the non-withdrawable engagement-tracking unit awarded for completing in-Service activities; VP have no monetary value and are not Cash-Equivalent.',
          '"Wallet" means the in-Service ledger that records your Coins, VP, and Gems.',
        ]),
      ],
    },
    {
      id: 'acceptance-modification',
      title: '2. Acceptance and Modification of Terms',
      body: [
        '2.1 Acceptance. By creating an Account or by accessing or using the Service in any way, you accept these Terms and form a binding agreement with VERGR. If you are accepting these Terms on behalf of an entity, you represent that you have authority to bind that entity.',
        '2.2 Updates. VERGR may update these Terms from time to time. When VERGR makes material changes we will (a) update the "Last updated" date at the top of these Terms; (b) increment the version number; (c) notify you by in-Service notice, email, or other reasonable means; and (d) where required by applicable law, request your express re-acceptance before further use of the Service.',
        '2.3 Continued use. Your continued use of the Service after the effective date of any change constitutes your acceptance of the updated Terms. If you do not accept the updated Terms you must stop using the Service and may close your Account in accordance with Section 21.',
        '2.4 No oral modifications. These Terms may not be modified except in writing, signed by an authorised representative of VERGR, or by VERGR posting an updated version in accordance with this Section 2.',
      ],
    },
    {
      id: 'service-description',
      title: '3. Description of the Service',
      body: [
        '3.1 What VERGR is. The Service is a social and live streaming platform for gamers and creators that combines (a) social networking features (profiles, posts, comments, clips and short-form video, direct and group messaging, squads, follow relationships); (b) live and on-demand video and audio streaming, including Paid Streams; (c) an internal virtual-currency economy comprising Coins, VP, and Gems; (d) creator monetisation features including tipping, paid memberships, paid stream access, and platform-funded engagement amplifications ("Boosts"); and (e) related ancillary functionality. The Service does not offer betting, wagering, prediction markets, prize competitions, or games of chance of any kind.',
        '3.2 What VERGR is not. The Service is not a gambling, sports-betting, casino, lottery, financial product, money-transmission, securities, banking, deposit-taking, or investment service. Coins, VP, and Gems are not legal tender, are not bank deposits, are not securities or investment contracts, and are not insured by any government or financial-regulator deposit-insurance scheme. The Service is not a means of transferring value between Users for general payment purposes outside of the in-Service features described in these Terms.',
        '3.3 No financial advice. Nothing in the Service constitutes financial, investment, legal, tax, or accounting advice. You are responsible for determining the tax treatment of your activity on the Service and for complying with the laws of your jurisdiction.',
        '3.4 Evolving Service. The Service is under active development. VERGR may add, remove, modify, or temporarily suspend features at any time without prior notice, except where these Terms or applicable law require prior notice.',
      ],
    },
    {
      id: 'eligibility',
      title: '4. Eligibility, Registration, and Account',
      body: [
        '4.1 Minimum age. You must be at least eighteen (18) years of age, or the higher age of majority in your jurisdiction, to create an Account or use the Service. The Service is strictly not available to persons under 18, and we do not knowingly collect information from anyone under 18. If VERGR becomes aware that an Account belongs to a person under the required age, the Account will be closed, the Account-holder\'s data will be deleted in accordance with our Privacy Policy, and any balance in the Wallet will be forfeited or returned at VERGR\'s discretion, subject to applicable law.',
        '4.2 Identity Verification. Identity Verification is required before VERGR can pay accrued revenue share to you. This is the feature that legally requires an 18+-verified adult participant: the outbound payout rail (anti-money-laundering / processor compliance). Other features of the Service — registering an Account, browsing, purchasing Coins, sending or receiving tips, buying access to a Paid Stream, paying for a subscription, and earning revenue share — do not require Identity Verification, although a user must still self-declare an age of at least eighteen (18) at signup and must reside in a non-Restricted Jurisdiction. Identity Verification is performed by Didit and includes capture of a government-issued photo ID, a selfie with liveness check, and screening against age and sanctions criteria. Verification is one-time per User; results are recorded in your Account record. VERGR may require additional or re-verification at any time, including in connection with elevated transaction volumes, fraud signals, or regulatory changes.',
        '4.3 Restricted Jurisdictions. The Service is not offered, and you may not access or use the Service, if you are located in, ordinarily resident in, or accessing the Service from, a Restricted Jurisdiction. As of the Effective Date, Restricted Jurisdictions include the following countries — ' + BLOCKED_COUNTRIES_DISPLAY.join(', ') + (BLOCKED_US_STATES_DISPLAY.length ? ' — and, for users located in the United States, the following states — ' + BLOCKED_US_STATES_DISPLAY.join(', ') : '') + '. VERGR may update the Restricted Jurisdiction list at any time. The current list is published in these Terms and in our Privacy Policy. Attempting to circumvent geographic restrictions by means of a virtual private network, proxy, anonymisation service, false declaration of residence, or any other method constitutes a material breach of these Terms.',
        '4.4 Sanctions. You represent and warrant that you are not (a) located in, ordinarily resident in, or a national of any country subject to comprehensive sanctions by the United Nations, the European Union, the United Kingdom, the United States Office of Foreign Assets Control ("OFAC"), or any other applicable sanctions authority; (b) identified on any sanctions list maintained by any such authority; or (c) owned or controlled by a person identified on any such list. You agree not to use the Service for the benefit of any such person. VERGR may screen Account-holders, transactions, and counterparties against sanctions lists at any time and may suspend or terminate Accounts that present a sanctions risk.',
        '4.5 Account registration. To register an Account you must provide accurate, current, and complete information, including a valid email address, a password, your date of birth, your username, and your display name. You must agree to these Terms and the Privacy Policy at the time of registration. You are responsible for keeping the information in your Account accurate and up to date.',
        '4.6 One Account per person. Each person may hold only one Account. You may not register multiple Accounts; you may not allow another person to use your Account; and you may not create an Account on behalf of another person without that person\'s express authorisation and lawful capacity to consent. Creating additional Accounts to circumvent a suspension, gain an unfair advantage, manipulate the economy, or evade fees is a material breach of these Terms.',
        '4.7 Account security. You are responsible for maintaining the confidentiality of your Account credentials, including your password and any second-factor authentication device, and for all activity that occurs on your Account. You must notify VERGR immediately at ' + OPERATOR.supportEmail + ' if you suspect unauthorised access. VERGR is not liable for any loss arising from unauthorised access to your Account where such access was not caused by VERGR\'s breach of these Terms or applicable law.',
        '4.8 Username and identity. Your username must not impersonate another person, infringe a third party\'s rights, or contain unlawful, abusive, or deceptive content. VERGR may reclaim, rename, or reassign usernames in cases of impersonation, trademark complaint, inactivity, or violation of these Terms.',
      ],
    },
    {
      id: 'user-representations',
      title: '4A. User Representations, Warranties, and Acknowledgements',
      body: [
        '4A.1 Eligibility representations. Each time you access or use the Service, you represent and warrant to VERGR that, at that moment: (a) you are at least eighteen (18) years of age, or the higher age of majority required by the laws of your jurisdiction; (b) you are not located in, ordinarily resident in, or accessing the Service from any Restricted Jurisdiction (Section 4.3); (c) your use of the Service is fully lawful in the jurisdiction in which you are located; (d) you are not subject to any sanctions list maintained by the United Nations, the European Union, the United Kingdom, the United States Office of Foreign Assets Control ("OFAC"), or any other applicable sanctions authority; (e) you have not been previously suspended or removed from the Service; (f) all information you provide to VERGR is accurate, current, and complete; and (g) you have read, understood, and agree to be bound by these Terms, the Privacy Policy, the Acceptable Use Policy, and any other policies published on the Service.',
        '4A.2 Sole responsibility for local compliance. YOU, AND NOT VERGR, ARE SOLELY AND EXCLUSIVELY RESPONSIBLE FOR DETERMINING WHETHER YOUR ACCESS TO AND USE OF THE SERVICE — INCLUDING WITHOUT LIMITATION YOUR PURCHASE AND USE OF COINS, YOUR RECEIPT OF REVENUE SHARE AS A CREATOR, AND ANY OTHER ECONOMIC ACTIVITY — IS LAWFUL IN YOUR JURISDICTION OF RESIDENCE, NATIONALITY, OR PHYSICAL LOCATION AT THE TIME OF USE. VERGR MAKES NO REPRESENTATION OR WARRANTY THAT THE SERVICE OR ANY FEATURE OF IT IS LAWFUL IN YOUR JURISDICTION. The list of Restricted Jurisdictions published in these Terms is non-exhaustive and reflects VERGR\'s good-faith efforts only; your jurisdiction may impose restrictions, age requirements, tax obligations, licensing requirements, or other obligations that are not enumerated here, and YOU are responsible for identifying and complying with them.',
        '4A.3 No reliance. You acknowledge that VERGR has not provided you with any legal, tax, financial, accounting, regulatory, or investment advice in connection with the Service, and that you have not relied on any such advice from VERGR in deciding to use the Service. If you require advice in any of these areas, you must consult an appropriately qualified professional in your jurisdiction.',
        '4A.4 Anti-circumvention representation. You represent and warrant that you have not used and will not use any virtual private network ("VPN"), proxy, anonymisation service, Tor, false declaration of residence or nationality, falsified identification document, or any other technique to circumvent the geographic restrictions, age restrictions, identity-verification requirements, or any other access controls applied by the Service. You acknowledge that any such circumvention is a material breach of these Terms, voids the protections of Section 11 (Service Availability) in your favour, may result in immediate termination and forfeiture of all balances, and renders any subsequent civil or regulatory consequence YOUR sole responsibility — not VERGR\'s.',
        '4A.5 Risk acknowledgement. You acknowledge and accept that (a) Coins are spent on access to features and are consumed when used, so a Coin you spend is not returned to you; (b) Coins are a limited, revocable licence to access features, are non-transferable, have no cash value, and cannot be redeemed, exchanged, or withdrawn for money; (c) VP has no real-world value and may be reduced or eliminated by VERGR with notice; (d) the Service may be modified, restricted, or discontinued at any time without compensation; (e) third-party processors (our payment processor, Didit, and any others VERGR may identify in the Privacy Policy) may delay, decline, freeze, or reverse transactions for their own compliance reasons over which VERGR has no control; (f) regulatory action in your jurisdiction may affect your ability to use the Service; and (g) you participate at your own risk.',
        '4A.6 Tax responsibility. You are solely responsible for determining whether your use of the Service gives rise to any tax obligation in your jurisdiction (income tax, value-added tax, capital-gains tax, withholding tax, or otherwise) and for reporting and paying any such tax. VERGR does not act as a tax agent, does not withhold tax on your behalf, and does not provide tax reporting documents except where compelled by applicable law. You acknowledge that the tax treatment of creator revenue share varies significantly by jurisdiction and is your responsibility to research.',
        '4A.7 Survival of representations. The representations and warranties in this Section 4A are made at signup and renewed each time you access the Service. They survive termination of your Account and these Terms.',
      ],
    },
    {
      id: 'service-use',
      title: '5. Permitted Use and Licence',
      body: [
        '5.1 Licence to use the Service. Subject to your compliance with these Terms, VERGR grants you a limited, personal, non-exclusive, non-transferable, non-sublicensable, revocable licence to access and use the Service for your own non-commercial enjoyment, and, where applicable, your participation as a creator, host, or squad operator within the in-Service economy.',
        '5.2 Reservation of rights. All rights not expressly granted to you under these Terms are reserved by VERGR. The Service, including all software, code, designs, trademarks, logos, audio, video, text, and other content owned by VERGR (collectively, "VERGR IP"), is the property of VERGR or its licensors and is protected by intellectual-property and other laws. You acquire no ownership interest in any VERGR IP.',
        '5.3 No reverse engineering. You must not reverse engineer, decompile, disassemble, or otherwise attempt to derive the source code, algorithms, or trade secrets underlying the Service, except to the extent such restriction is prohibited by applicable law.',
        '5.4 No commercial exploitation. You must not sell, lease, sublicense, distribute, or otherwise commercially exploit the Service or any part of it without VERGR\'s prior written consent, except as expressly permitted under these Terms (for example, by participating in the creator monetisation features).',
      ],
    },
    {
      id: 'no-gambling',
      title: '6. No Gambling (Important — Read Carefully)',
      body: [
        '6.1 No gambling of any kind. VERGR does not offer, facilitate, or promote betting, wagering, prediction markets, sports betting, casino games, slot mechanics, lotteries, raffles, sweepstakes, prize competitions, scratch cards, loot boxes, or any other product or feature in which a User stakes money, Coins, or anything of value on an uncertain outcome. There is no betting against the house and no betting between Users. No feature of the Service meets the legal definition of gambling in any jurisdiction in which the Service is offered.',
        '6.2 No games of chance and no randomised rewards. The Service contains no chance-based prize-distribution mechanic and no randomised-reward mechanic. Coins are never awarded at random, and no purchase made through the Service produces an uncertain or randomised outcome.',
        '6.3 Every Coin purchase is a known-value purchase. Coins are spent on goods and services with a stated price and a certain outcome: Tips to creators, access to a Paid Stream, creator memberships, subscription plans, and Boosts. In every case the User knows before paying what they receive in exchange. Nothing on the Service is staked, risked, or subject to forfeiture on the result of a game or event.',
        '6.4 Prohibited User conduct. Users may not use the Service, or any feature of it, to organise, advertise, solicit, or settle gambling, betting, wagering, or any staking arrangement, whether between Users or with third parties, including in live stream chat, direct messages, group chats, squad chats, or posted Content. Doing so is a material breach of these Terms and of the Acceptable Use Policy, and may result in immediate and permanent termination of the Account.',
        '6.5 Reporting. If you encounter any attempt to use the Service for gambling or staking, report it using the in-Service report function or by writing to ' + OPERATOR.supportEmail + '. Reports are reviewed by VERGR\'s moderation team.',
      ],
    },
    {
      id: 'virtual-currency',
      title: '7. Virtual Currencies (Coins, VP, Gems)',
      body: [
        '7.1 No real-world value. Coins and VP are virtual items provided through the Service. They are not money, are not legal tender, are not currency, are not securities, are not a substitute for any sovereign or private currency, are not redeemable for cash, and have no value outside the Service. Gems are different in kind: they are not a virtual item you hold but a record of an amount VERGR owes you under the Creator Revenue Share Agreement in Section 11, payable in accordance with Section 8.',
        '7.2 Coins (VC). Coins are a limited, revocable, non-exclusive, non-transferable licence to access features of the Service. They are not money, not a currency, not a stored-value or prepaid instrument, and have no value outside the Service. Coins are purchased from VERGR, and spending Coins in the Service is a payment to VERGR, not to any other User. Coins may be acquired by (a) purchase with fiat currency or cryptocurrency through the payment processors VERGR integrates; or (b) award by VERGR in connection with promotions, refunds, or rebates at VERGR\'s discretion. Coins may be spent on tips, access to a Paid Stream, paid memberships, locked content, subscription plans, Boosts, and other in-Service features. Coins cannot be sold, traded, gifted, or transferred to another person, cannot be redeemed for cash, and cannot be withdrawn. Coins are non-refundable once delivered, except where required by applicable consumer-protection law or as expressly stated in our Refund Policy (Section 9).',
        '7.3 VP (Vergr Points). VP is an engagement-tracking unit awarded for completing in-Service activities such as creator quests, daily logins, content milestones, and referrals. VP have no monetary value, are not Cash-Equivalent, are not redeemable for fiat currency or cryptocurrency, may not be converted into Coins or Gems, may not be transferred between Users, and may not be withdrawn. VP exist solely to recognise engagement and unlock progression within the Service.',
        '7.4 Gems. Gems are the unit in which VERGR records revenue share that it owes to a Creator. One (1) Gem represents one United States cent (USD 0.01) of accrued revenue share. Gems are a record of an amount payable by VERGR to you under Section 11; they are not a currency, not a stored-value or prepaid instrument, not a deposit, not funds held by VERGR on your behalf or for your benefit, and not transferable to any other person. Gems accrue automatically at the moment revenue is earned, at your Revenue Share Rate at that moment, in accordance with Section 11.3. You are not required to take any action to convert anything, and there is no separate conversion step or conversion fee. Accrued amounts are paid to you on the schedule set out in Section 8.',
        '7.5 No promises about future value. VERGR makes no representation that Coin prices, Revenue Share Rates, payment schedules, minimum payment amounts, or any other economic parameter of the in-Service economy will remain unchanged. VERGR may modify these parameters in accordance with Section 11.5, which requires notice and never applies retrospectively to revenue already accrued. Coins and VP are not investments and should not be acquired or held in the expectation of an increase in value.',
        '7.6 Non-transferability and non-resale. Except through the in-Service mechanisms described in these Terms, you must not sell, trade, transfer, lend, gift, or otherwise dispose of Coins, VP, or Gems to any other person or for any consideration outside the Service. Real-money trading ("RMT") of in-Service virtual items through any external venue is strictly prohibited and is grounds for permanent termination of your Account and forfeiture of balances.',
        '7.7 Account closure or termination. On voluntary closure of your Account, unspent Coins and VP are forfeited and not redeemable. Eligible Gem balances at the time of closure will be paid out in accordance with Section 8, subject to your having completed Identity Verification and the standard payout windows, holds, and limits. On involuntary termination of your Account by VERGR for cause (Section 21.3), all Coins, VP, and Gems may be forfeited.',
        '7.8 Insolvency. In the event that VERGR ceases operations, files for protection from creditors, or is wound up, Coins and VP will not be refunded. Accrued revenue share owed to a Creator is an ordinary commercial debt and will be treated in accordance with applicable insolvency law; it is not held in trust or in a segregated account and is not protected by any deposit-protection scheme. VERGR will give Creators not less than thirty (30) days\' notice, where practicable, of any voluntary winding up.',
      ],
    },
    {
      id: 'payouts',
      title: '8. Payment of Revenue Share',
      body: [
        '8.1 What this Section covers. This Section describes how and when VERGR pays you amounts of revenue share that have accrued to you under Section 11. It replaces the former user-initiated withdrawal process. You do not request a payment and you do not choose when one is made; VERGR calculates what it owes you and pays it on the schedule below, in the same way that any business pays its suppliers.',
        '8.2 Eligibility to be paid. VERGR will pay accrued revenue share to you once all of the following are true: (a) you have completed Identity Verification to at least Level 1; (b) you have provided a valid tax form appropriate to your jurisdiction and it remains current; (c) you have connected a payout account through our payments partner and the details on it match your verified identity; (d) you are not located in a Restricted Jurisdiction and are not subject to sanctions; (e) your Account is not suspended, frozen, or under fraud review; and (f) your accrued balance meets the minimum in Section 8.4.',
        '8.3 Payment schedule. Payments are made on a recurring schedule that depends on the maturity of your Account. Standard: monthly, on the first day of each calendar month; this applies to every Account by default. Established: twice monthly, on the first and fifteenth day of each calendar month, once your Account has completed at least ninety (90) days since its first payment, received at least three (3) successful payments, reached Identity Verification Level 2, and has no active Strikes. Priority: weekly, on Mondays, once your Account has completed at least one hundred and eighty (180) days since its first payment, received at least twelve (12) successful payments, reached Identity Verification Level 2, and has no active Strikes. Where a scheduled date falls on a weekend or a banking holiday, payment is initiated on the next business day.',
        '8.4 Minimum payment amount and roll-over. The minimum payment amount is one hundred United States dollars (USD 100), and it is the same at every stage of the schedule in Section 8.3. If your accrued balance is below the minimum on a scheduled date, no payment is made on that date and the full accrued amount carries forward to the next scheduled date. Amounts below the minimum are never forfeited, never expire, and are never reduced by any holding, dormancy, inactivity, or maintenance charge.',
        '8.5 How payment is made. Payments are made through a third-party payments partner, which acts as the payer of record and disburses funds to the payout account you have connected. Supported payout methods and countries are published in the in-Service payout setup flow and may change from time to time. The partner is identified by category as a recipient of your payout data in the Privacy Policy.',
        '8.6 Fees on payment. VERGR does not deduct any fee from a scheduled payment. Your Revenue Share Rate under Section 11.2 is the only deduction that applies to your earnings, and it has already been applied at the time the revenue accrued. VERGR bears the cost charged by the payments partner for making each payment. Your own bank or payment provider may apply its own receiving or currency-conversion charges, over which VERGR has no control and from which VERGR receives nothing.',
        '8.7 Statements. VERGR issues a statement for each payment, available in the Service, showing the period covered, the gross revenue your content generated in that period broken down by source, the Revenue Share Rate applied, any adjustments made under Section 8.9, the net amount paid, the method, and the payment reference. Statements are your record of amounts paid to you and are retained in the Service for at least seven (7) years.',
        '8.8 Strikes and their effect on payment. A Strike is recorded against your Account where (a) a moderation action against your Content is upheld after the appeal window has closed; (b) chargebacks on purchases that funded your earnings exceed the rate threshold VERGR applies for fraud control; (c) a fraud review is upheld against your Account; (d) a payment fails because the details you supplied were false or did not match your verified identity; or (e) you attempt to circumvent the Service, including by real-money trading, by soliciting payment off-platform in order to avoid the Revenue Share Rate, or by operating multiple Accounts to reach a higher rate tier. A dismissed report is not a Strike, an isolated chargeback below the threshold is not a Strike, and a Strike that is reversed on appeal is removed together with its effects. A Strike expires one hundred and eighty (180) days after it is recorded. One active Strike reduces your payment schedule by one stage. Two active Strikes return your schedule to Standard. Three active Strikes suspend payment pending review by VERGR. Suspension of payment does not stop revenue share from accruing to you and does not forfeit any accrued amount; amounts continue to accrue and are held until the review concludes. Forfeiture occurs only on termination for cause under Section 21.3, which is decided by a person and not automatically.',
        '8.9 Set-off, adjustment, and clawback. VERGR may set off against amounts accrued to you, or recover from a future payment: (a) amounts corresponding to a purchase that was refunded, reversed, or charged back after the related revenue share accrued to you; (b) amounts that accrued from activity found to be in breach of these Terms, including cheating, collusion, multi-accounting, or real-money trading; and (c) amounts paid to you in error. VERGR will notify you of any adjustment and will show it on the statement for the period in which it is applied.',
        '8.10 Holds and review. VERGR may delay or withhold a payment where (a) it has reasonable grounds to suspect fraud, money laundering, sanctions evasion, or other unlawful conduct; (b) it is required to do so by court order, regulator, or applicable law; (c) Identity Verification or supplementary information has not been completed or is inconsistent with the payout account; or (d) the pattern of activity appears designed to evade a reporting threshold. Where a payment is delayed or withheld, VERGR will notify you and, where it is lawful to do so, tell you why.',
        '8.11 Taxes. You are responsible for the tax treatment of amounts paid to you. VERGR does not withhold income tax except where required by applicable law. VERGR will collect the tax documentation described in Section 8.2(b) before the first payment, and will report amounts paid to you to the relevant tax authority where the law requires it. You must keep your tax information current; an out-of-date form will stop payment until it is corrected.',
        '8.12 No interest and no deposit. Amounts accrued to you but not yet paid do not earn interest. They are an amount owed by VERGR to you under a commercial contract. They are not a deposit, are not held in trust or in a segregated account for you, are not client money, and are not insured by any deposit-protection scheme.',
        '8.13 Closure and cessation. On voluntary closure of your Account, accrued revenue share is paid in the next scheduled payment run following closure, provided the eligibility conditions in Section 8.2 are met, disregarding the minimum in Section 8.4. On termination of your Account by VERGR for cause under Section 21.3, accrued amounts may be forfeited. In the event that VERGR ceases operations, accrued amounts owed to Creators rank as ordinary commercial debts and are treated in accordance with applicable insolvency law; VERGR will give Creators not less than thirty (30) days\' notice, where practicable, of any voluntary winding up.',
      ],
    },
    {
      id: 'refunds',
      title: '9. Refund Policy (Inbound Purchases)',
      body: [
        '9.1 General rule — no refunds. Because Coins are virtual items delivered immediately and consumed within the Service, and because the Service offers digital content and services performed immediately on your acceptance, Coin purchases and subscription payments are not refundable once the Coins have been credited to your Wallet or the subscription period has begun, except where required by applicable consumer-protection law or as expressly stated below.',
        '9.2 EU/UK cooling-off — express waiver. Where you are a consumer in the European Union, the European Economic Area, or the United Kingdom and would otherwise have a fourteen (14) day right of withdrawal under Directive 2011/83/EU or its UK equivalent, you expressly acknowledge and agree that, by completing a purchase of Coins or activating a subscription, (a) you request that performance begin immediately during the cooling-off period; and (b) you accept that your right of withdrawal will be lost once the Coins are delivered or the subscription period begins. This waiver is presented to you at checkout in accordance with the legislation.',
        '9.3 Erroneous charges. If you are charged in error — including duplicate charges, charges to which the wrong Account was credited, or charges initiated by an unauthorised user of your payment method — you may request a refund within thirty (30) days of the charge by writing to ' + OPERATOR.supportEmail + '. We will investigate and, where the charge is confirmed as erroneous, refund the amount to the original payment method.',
        '9.4 Undelivered Paid Streams. If you purchase access to a Paid Stream and the broadcast is cancelled by the creator or by VERGR, or does not take place, the purchase is refunded to your Wallet in full. Once the broadcast has taken place and access has been delivered, the purchase is final except as required by law.',
        '9.5 Subscription cancellation. You may cancel a paid subscription at any time from your Account settings. Cancellation takes effect at the end of the current billing period; you retain access to subscription benefits until that date. No partial refunds are issued for unused subscription time.',
        '9.6 Processor terms. Where a purchase is processed by a third-party payment provider, that provider\'s additional terms may apply to refund eligibility. We are not responsible for refund decisions made by the provider; however, we will cooperate reasonably with bona fide refund requests.',
        '9.7 Chargebacks. Initiating a chargeback or successful payment dispute against a VERGR purchase has consequences including reversal of the corresponding Coins, debit of any amounts already spent from those Coins, account suspension or termination, and chargeback fees. Disputes about purchases should be raised with VERGR support before being escalated to your card issuer.',
      ],
    },
    {
      id: 'paid-streams',
      title: '10. Paid Live Streams',
      body: [
        '10.1 What a Paid Stream is. A broadcasting User may set a price for access to a live broadcast. A viewer obtains access either by a one-off purchase of that broadcast, or through an active creator membership with that User where the creator has included Paid Streams in the membership. Access is to the live broadcast only; it does not convey any ownership of, or licence to redistribute, the Content.',
        '10.2 Creator responsibilities. A creator offering a Paid Stream is responsible for (a) accurately describing what the broadcast will contain before a viewer pays; (b) actually delivering the broadcast at or around the stated time; (c) ensuring the Content complies with the Acceptable Use Policy; and (d) complying with all applicable laws, including any tax obligations arising from their earnings.',
        '10.3 Content standards. A Paid Stream is a broadcast to an audience, and the Broadcast Content Standards in Section 2 of the Acceptable Use Policy apply to it in the same way they apply to a free public stream. Charging for entry does not change which standards apply to a broadcast. VERGR moderates Paid Streams on the same basis as free ones, and the Universal Prohibitions in Section 1 of that policy apply to every part of the Service without exception.',
        '10.4 Pricing and revenue share. The creator sets the price in Coins, and the price is shown to the viewer before purchase. The sale is made by VERGR as principal. VERGR pays the creator their Revenue Share Rate of the amount received, in accordance with Section 11. No separate platform fee is deducted on top of that rate.',
        '10.5 Refunds. If a Paid Stream is cancelled or does not take place, the purchase is refunded in full under Section 9.4. Dissatisfaction with a broadcast that did take place is not a ground for refund, save where required by applicable consumer-protection law.',
        '10.6 Reporting. A viewer may report a Paid Stream at any time from within the broadcast, including while it is live. Reports are routed to VERGR\'s moderation team and are actioned on the same basis as reports about free Content.',
      ],
    },
    {
      id: 'one-to-one-sessions',
      title: '10A. 1:1 Sessions',
      body: [
        '10A.1 What a 1:1 Session is. A 1:1 Session is a private live session between exactly two Users. It is reachable only through a link the host sends directly to the person they are inviting, it is limited by the Service to a single viewer, and it does not appear in search, discovery, recommendations, or any public listing. The host may make entry free or set a price in Coins.',
        '10A.2 Both participants must be adults. Every Vergr Account holder is 18 or over, and a 1:1 Session is available only between Account holders. A host who has any reason to believe the other participant is under 18 must end the session immediately and report it.',
        '10A.3 Universal Prohibitions apply. Section 1 of the Acceptable Use Policy applies to a 1:1 Session exactly as it applies everywhere else on the Service, without exception and regardless of whether entry was paid. That includes, without limitation, any content involving a minor, intimate imagery of a person who has not consented to it being shown or distributed, recording or capturing another participant without their consent, coercion, and the offering or arranging of in-person sexual services, prostitution, or any form of human trafficking.',
        '10A.4 Consent to record. Neither participant may record, screen-capture, stream onward, or otherwise reproduce a 1:1 Session without the other participant\'s express consent. Doing so is a material breach of these Terms and may also be a criminal offence in the participant\'s jurisdiction.',
        '10A.5 Reporting. Either participant may report a 1:1 Session, or the other participant, at any time from inside the session itself, including while it is running. Reports go to VERGR\'s moderation team. A report may be made whether or not money changed hands, and a host who has been paid has no right to prevent, discourage, or retaliate against a report.',
        '10A.6 Refunds. If a paid 1:1 Session does not take place, the purchase is refunded in full under Section 9.4. Where a session is ended early because of a breach of the Acceptable Use Policy by the host, VERGR may refund the participant and withhold the corresponding earnings.',
      ],
    },
    {
      id: 'creator-monetization',
      title: '11. Creator Revenue Share Agreement',
      body: [
        '11.1 The relationship between you and VERGR. This Section is the agreement under which VERGR pays you for content and services you supply through the Service. It applies to you whenever you earn through the Service, and it takes precedence over any other description of monetisation in these Terms. You supply content and services to VERGR. VERGR sells access to that content and to related features to other Users as principal, in its own name and on its own account. A User who buys Coins buys them from VERGR, and a User who spends Coins in the Service is paying VERGR. VERGR owes you a share of the revenue that your content and services generate, calculated and paid under this Section. VERGR does not hold, transmit, or transfer money on your behalf, does not act as your agent in any sale, and does not receive money from any User for your account. You are an independent supplier and not an employee, worker, partner, joint venturer, or agent of VERGR.',
        '11.2 Your Revenue Share Rate. Your Revenue Share Rate is the percentage of the gross revenue generated by your content that VERGR pays to you. It is determined by the total gross revenue your content has generated over the lifetime of your Account, as follows: fifty percent (50%) from zero; fifty-five percent (55%) from USD 50; sixty percent (60%) from USD 250; sixty-five percent (65%) from USD 1,000; seventy percent (70%) from USD 5,000; seventy-five percent (75%) from USD 15,000; and eighty percent (80%) from USD 50,000. Your rate only ever increases as your lifetime total grows, and reaching a higher rate is permanent for as long as your Account remains in good standing. Your current rate and your progress toward the next are shown in the Service.',
        '11.3 When revenue share accrues, and the absence of any other deduction. Revenue share accrues to you automatically at the moment a User completes a qualifying transaction on your content, at your Revenue Share Rate at that moment. It is recorded in Gems as described in Section 7.4. Your Revenue Share Rate is the only deduction VERGR applies to your earnings. VERGR does not apply a separate platform fee, transaction fee, or payment fee in addition to it, and does not deduct the cost of making a payment to you. A rate increase applies to revenue earned after it takes effect and does not retrospectively change amounts already accrued.',
        '11.4 What generates revenue share. Revenue share accrues on: tips sent to you or to your content; paid memberships to your channel or squad; purchases of access to your locked content and content packs; purchases of access to your paid live streams and 1:1 sessions; purchases of tickets and passes to events you host; sales through your Vergr.me storefront, which is subject to the separate rate published for that feature; and any further monetisation feature VERGR introduces, at the rate published for it. Revenue share does not accrue on Coins spent on Boosts or on other platform features that do not pay a Creator, and it does not accrue on VP, which has no monetary value under Section 7.3.',
        '11.5 Changes to rates. VERGR may change the Revenue Share Rate table in Section 11.2, or the rate published for a particular feature, on not less than thirty (30) days\' written notice to you through the Service or by email. A change never applies retrospectively to revenue already accrued. If you do not accept a change, your remedy is to stop supplying content and to close your Account under Section 8.13, and any amount already accrued to you remains payable.',
        '11.6 Your obligations. You must: supply content you are entitled to supply and that complies with the Acceptable Use Policy; provide accurate identity, tax, and payout information and keep it current; not solicit or accept payment from a User outside the Service for content or access that is offered through the Service, which is a circumvention of this agreement and a Strike under Section 8.8; not operate more than one Account in order to reach a higher Revenue Share Rate; and comply with all laws applicable to you, including tax, social security, and any licensing or registration requirement in your jurisdiction.',
        '11.7 Tips. A tip is a payment by a User to VERGR for a named, priced feature associated with your content, including on-stream acknowledgement of the sending User and the display of their message and any associated animation. VERGR pays you your Revenue Share Rate of the amount received. A tip is not a gift or a transfer of money from one User to another, and no User transfers money to any other User through the Service.',
        '11.8 Boosts. A Boost is a fifty-coin (50 Coin) platform-driven amplification of a live stream that increases the stream\'s visibility in discovery feeds, makes it eligible for push notifications, and biases its surfacing toward Users likely to engage. Boosts are required for free-tier creators to launch a public stream once they have at least one hundred (100) followers, and are optional for paid-tier creators. The first fifty (50) Coins of tips received during a Boosted stream refund the Boost cost. Boost behaviour and parameters may be tuned by VERGR. A Boost is a purchase of a platform service by you and does not generate revenue share for any Creator.',
        '11.9 No employment. Nothing in these Terms or in the creator-monetisation features creates an employment, agency, partnership, joint-venture, or franchise relationship between you and VERGR. You control how, when, and whether you produce content. You are responsible for your own tax, social-security, insurance, and licensing obligations, and for any equipment, connectivity, or software you use.',
        '11.10 Creator quests. Quests award VP only, never Coins and never revenue share. VP are non-withdrawable and have no monetary value, as set out in Section 7.3.',
        '11.11 Records. VERGR maintains records of the revenue your content generates, the rate applied, the amounts accrued, and the amounts paid, and makes them available to you as statements under Section 8.7. If you believe a statement is wrong, you may raise it with VERGR within ninety (90) days of the statement date and VERGR will investigate and correct any error it finds.',
        '11.12 Termination of this agreement. Either party may end this agreement at any time: you by closing your Account or by ceasing to supply content, and VERGR by giving notice or by terminating your Account under Section 21. Amounts accrued to you before termination remain payable under Section 8.13, except where they are forfeited on termination for cause. Sections 8.9, 11.6, 11.11, and any provision that by its nature should survive, survive termination.',
      ],
    },
    {
      id: 'content',
      title: '12. User Content',
      body: [
        '12.1 Ownership. You retain all ownership rights in the Content you submit to the Service. VERGR does not claim ownership of your Content.',
        '12.2 Licence to VERGR. You grant VERGR a worldwide, non-exclusive, royalty-free, transferable, sublicensable licence to host, store, cache, copy, reproduce, modify (only for technical purposes such as transcoding, resizing, and watermarking), display, perform, publish, distribute, translate, and create derivative works of your Content for the purposes of operating, providing, promoting, and improving the Service, including its marketing materials, in any medium now known or later developed. This licence continues for as long as your Content remains on the Service; on deletion of Content by you, VERGR will take reasonable steps to remove that Content from public-facing surfaces but may retain copies in backups and logs for a reasonable period.',
        '12.3 Promotional use. The licence in Section 12.2 includes a right for VERGR to feature public Content (live streams, clips, posts, highlights) in VERGR-operated promotional channels (social media, advertising, blog posts, in-Service discovery) without further consent, subject to your privacy settings at the time of capture.',
        '12.4 Representations. You represent and warrant that (a) you own or have all necessary rights to your Content; (b) your Content does not infringe any third-party intellectual-property, privacy, publicity, or other right; (c) your Content does not contain material that is defamatory, harassing, sexually explicit involving minors, or otherwise unlawful under any applicable law; and (d) your Content complies with the Acceptable Use Policy (Section 14).',
        '12.5 No obligation to host. VERGR has no obligation to host any particular Content. VERGR may, in its discretion, decline to host, remove, restrict, refuse to surface, age-gate, label, or take other action with respect to any Content for any reason consistent with these Terms and applicable law.',
        '12.6 DMCA / copyright complaints. VERGR responds to notices of alleged copyright infringement in accordance with applicable law, including the United States Digital Millennium Copyright Act ("DMCA") and equivalent legislation in other jurisdictions. To submit a notice of alleged infringement, send a written notice to ' + OPERATOR.copyrightEmail + ' that contains: (a) a physical or electronic signature of the rights-holder or authorised agent; (b) identification of the copyrighted work claimed to be infringed; (c) identification of the material that is alleged to be infringing and reasonably sufficient information for VERGR to locate it on the Service (for example, the URL); (d) your contact details (address, telephone, email); (e) a statement that you have a good-faith belief that the use is not authorised; and (f) a statement, under penalty of perjury, that the information in the notice is accurate and that you are authorised to act on behalf of the rights-holder. Counter-notices may be submitted by the User whose material was removed; VERGR will follow the counter-notice procedures provided under the DMCA. Repeat infringers will have their Accounts terminated.',
      ],
    },
    {
      id: 'live-streaming',
      title: '13. Live Streaming',
      body: [
        '13.1 Eligibility. Live streaming on public surfaces requires a minimum follower count (currently one hundred (100) followers) for free-tier users plus the Boost charge described in Section 11.3. Paid tiers may stream public without the follower gate. Squad-only voice and video streaming is available to all Users.',
        '13.2 Streaming quality. Maximum stream rendition is determined by your subscription tier (free: 480p at 30 frames per second; Lite: 720p at 60 frames per second; Pro: 1080p at 60 frames per second). VERGR may adjust these limits.',
        '13.3 Content rules. Live streams are subject to all content rules in Section 12 and the Acceptable Use Policy. Sexual content, illegal content, content harmful to minors, hate speech, harassment, gambling promotion (other than information about VERGR\'s skill-based competitions), and other prohibited conduct are not permitted.',
        '13.4 Moderation. VERGR may end, suspend, or restrict streams in real time where they violate these Terms, applicable law, or third-party rights, including in response to reports from Users, automated detection, or manual moderation. Severe or repeated violations may result in account suspension or termination.',
        '13.5 Recording and storage. Live streams may be recorded by VERGR for moderation, dispute, and platform purposes. Recordings of public streams may be retained and used in accordance with the licence in Section 12.2; private streams are retained only as required to operate the Service and per the Privacy Policy.',
      ],
    },
    {
      id: 'aup',
      title: '14. Acceptable Use Policy',
      body: [
        '14.1 Prohibited conduct. You must not, and must not attempt to:',
        list([
          'violate any law, regulation, or third-party right;',
          'create, transmit, or store Content that is unlawful, fraudulent, threatening, defamatory, harassing, obscene, sexually explicit involving minors, hate speech, or that depicts or promotes graphic real-world violence, self-harm, or terrorism. Violence depicted in video games is not covered by this restriction;',
          'impersonate another person or misrepresent your affiliation with any person or entity;',
          'use the Service to facilitate gambling, betting, lotteries, or chance-based prize draws outside of the skill-based competitions VERGR itself organises;',
          'use the Service to launder money, finance terrorism, evade sanctions, or otherwise process the proceeds of crime;',
          'exploit bugs, use unauthorised third-party software, scripts, bots, or automation to manipulate engagement metrics, the economy, or any other part of the Service;',
          'organise, advertise, solicit, or settle any gambling, betting, wagering, or staking arrangement through the Service, whether between Users or with third parties;',
          'manipulate, falsify, or attempt to influence match-result reporting, including reporting false outcomes;',
          'engage in real-money trading of Coins, VP, Gems, Accounts, or in-Service items outside the in-Service mechanisms in these Terms;',
          'create or use multiple Accounts to evade restrictions, gain unfair advantages, manipulate the economy, abuse promotional offers, or evade fees;',
          'access another User\'s Account without authorisation, or share your Account credentials with another person;',
          'use the Service to send unsolicited bulk communications ("spam"), to phish, or to deliver malware;',
          'circumvent geographic restrictions by means of a virtual private network, proxy, anonymisation service, false declaration of residence, or similar method;',
          'reverse engineer, decompile, disassemble, or attempt to extract source code from the Service, except as permitted by applicable law;',
          'remove, alter, or obscure any proprietary notice on the Service or in VERGR Content;',
          'interfere with the Service or any related infrastructure, including by uploading viruses, performing denial-of-service or distributed-denial-of-service attacks, port-scanning, vulnerability-scanning, load-testing, or stress-testing without VERGR\'s prior written authorisation;',
          'use automated means (scrapers, crawlers, harvesters) to extract data from the Service except in accordance with VERGR\'s API documentation and any applicable rate limits;',
          'use the Service in any way intended to harm or defraud another User.',
        ]),
        '14.2 Enforcement. Violations of this Section 14 are material breaches of these Terms. VERGR may, in its discretion and consistent with applicable law, remove offending Content, restrict features of an Account, suspend an Account temporarily, terminate an Account permanently, forfeit balances, withhold pending payouts, and refer matters to law enforcement. In appropriate cases VERGR will pursue civil and criminal remedies.',
      ],
    },
    {
      id: 'reports-moderation',
      title: '15. Reports, Investigations, and Moderation',
      body: [
        '15.1 Reporting. You may report Content, Accounts, or conduct that you believe violates these Terms by using the in-Service reporting tools or by writing to ' + OPERATOR.abuseEmail + '.',
        '15.2 Investigations. VERGR may investigate reports, suspected violations of these Terms, or suspected unlawful conduct, including by reviewing Content, Account records, IP addresses, device identifiers, Wallet activity, communications metadata, and other available data. We will cooperate with law enforcement and respond to lawful requests in accordance with applicable law and our Privacy Policy.',
        '15.3 Moderation outcomes. VERGR may, without prior notice, remove or restrict Content; restrict features available to an Account; require additional verification; suspend an Account temporarily; terminate an Account permanently; or take other proportionate action. Where lawful and appropriate we will notify the affected User of the action and the reason. An Account-holder who believes a moderation decision was made in error may appeal by writing to ' + OPERATOR.supportEmail + '.',
      ],
    },
    {
      id: 'third-party-services',
      title: '16. Third-Party Services',
      body: [
        '16.1 Integrations. The Service integrates with third-party services including but not limited to Steam (Valve Corporation), Discord, Twitch, YouTube, Battle.net, Riot Games, Epic Games Services, Xbox Live (via OpenXBL), Didit (Identity Verification), a third-party payment processor (cryptocurrency payments and payouts), Cloudflare, Google Firebase, and Hetzner. Use of those integrations is subject to the third party\'s own terms and privacy policies, in addition to these Terms.',
        '16.2 No endorsement. References to third-party services within the Service are not endorsements. VERGR does not control and is not responsible for the conduct of third-party services or content available through them.',
        '16.3 Disconnection. You may disconnect a linked third-party service from your Account at any time in your Account settings, subject to any consequences described in the in-Service flow (for example, your stats from that platform no longer appearing on your profile).',
      ],
    },
    {
      id: 'fees',
      title: '17. Fees and Pricing',
      body: [
        '17.1 Coin pack pricing. Coin packs are priced in the local currency of the payment processor at the time of purchase. The Service maintains a minimum per-Coin price floor (the "Economy Floor") that may be revised by VERGR with notice. Prices shown at checkout are inclusive of any sales tax or VAT charged by the processor.',
        '17.2 Subscriptions. Lite and Pro subscriptions are priced at the rates published in the in-Service subscription flow. Prices may be revised by VERGR with at least thirty (30) days\' notice to active subscribers, who may cancel before the change takes effect.',
        '17.3 What VERGR earns. VERGR sells Coins and in-Service features to Users as principal and pays Creators a share of the revenue their content generates. VERGR\'s earnings are the difference between the two. A Creator\'s Revenue Share Rate is between fifty percent (50%) and eighty percent (80%) depending on their lifetime earnings, as set out in Section 11.2, and it is the only deduction applied to Creator earnings. VERGR does not charge a separate tip fee, sale fee, or payment fee in addition to that rate. Sales through a Vergr.me storefront are subject to the separate rate published for that feature. These rates may be revised in accordance with Section 11.5.',
        '17.4 Network fees. Cryptocurrency network fees on payouts are paid by the receiver, as set out in Section 8.6.',
        '17.5 Currency. Prices are quoted in euros (€) for marketing purposes; charges at checkout are levied in the currency presented by the payment processor for your region.',
      ],
    },
    {
      id: 'privacy',
      title: '18. Privacy',
      body: [
        '18.1 Privacy Policy. Our processing of personal data is described in the Privacy Policy at /privacy. The Privacy Policy is incorporated into and forms part of these Terms.',
        '18.2 Identity Verification provider. Identity Verification is performed by Didit. Didit receives the documents and selfie you submit, processes the verification, and returns the result to VERGR. Didit retains the verification record under its own policy; VERGR stores only the result and the verification reference.',
        '18.3 Communications. We may send you Service-related notices, security alerts, and administrative messages. Marketing communications may be sent only where lawful and may be opted out of through your Account settings.',
      ],
    },
    {
      id: 'service-availability',
      title: '19. Service Availability and Changes',
      body: [
        '19.1 No availability guarantee. The Service is provided strictly on an "AS IS" and "AS AVAILABLE" basis. VERGR makes no representation or warranty, express or implied, that the Service will be uninterrupted, error-free, secure, free of viruses or other harmful components, accurate, timely, or that any particular feature will be available at any particular time, in any particular jurisdiction, or to any particular User.',
        '19.2 Maintenance and outages. VERGR may take all or part of the Service offline for scheduled or emergency maintenance, security incidents, infrastructure failures, third-party-provider outages, or any other operational reason, in each case without prior notice and without compensation to you.',
        '19.3 Modification and discontinuation. VERGR may add, remove, modify, restrict, suspend, or discontinue the Service or any feature of it at any time, in any jurisdiction or in all jurisdictions, with or without prior notice and with or without cause, in its sole and absolute discretion. Without limiting the foregoing, VERGR may make such changes in response to (a) changes in applicable law or regulation in any jurisdiction; (b) directions or guidance from regulators, payment processors, infrastructure providers, app stores, or other third parties; (c) commercial considerations; (d) abuse, fraud, or security incidents; or (e) any other reason VERGR considers appropriate.',
        '19.4 Geographic suspension. Without limiting Section 19.3, VERGR may suspend or terminate the Service for Users located in any particular jurisdiction at any time, in response to changes in local law, regulator action, or VERGR\'s own risk assessment, in each case without prior notice. Where this occurs, eligible Gem balances at the time of suspension will be handled in accordance with Section 7.7 and Section 8.',
        '19.5 No liability for unavailability. To the maximum extent permitted by applicable law, VERGR shall not be liable to you or any third party for any unavailability, suspension, modification, or discontinuation of the Service or any feature of it, regardless of the reason and regardless of the duration. The VERGR Parties\' obligation in this regard is limited to acting in good faith.',
      ],
    },
    {
      id: 'disclaimers',
      title: '20. Disclaimers',
      body: [
        '20.1 NO WARRANTIES. To the MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, VERGR AND THE VERGR PARTIES DISCLAIM ALL WARRANTIES, REPRESENTATIONS, AND CONDITIONS OF ANY KIND, whether express, implied, statutory, or otherwise, in respect of the Service, including without limitation any implied warranty or condition of merchantability, fitness for a particular purpose, satisfactory quality, title, accuracy, non-infringement, security, availability, uninterrupted operation, freedom from errors, freedom from viruses or harmful components, and any warranty or condition arising from course of dealing, course of performance, or usage of trade.',
        '20.2 NO WARRANTY OF LAWFULNESS IN YOUR JURISDICTION. Without limiting Section 20.1, VERGR MAKES NO WARRANTY OR REPRESENTATION THAT THE SERVICE, OR ANY FEATURE OF IT, IS LAWFUL IN ANY PARTICULAR JURISDICTION. The lawfulness of your use of the Service depends on the laws of your jurisdiction and your personal circumstances; YOU are responsible for determining this and complying with applicable law (see Section 4A.2).',
        '20.3 Reliance is at your own risk. Any reliance you place on any Content, advice, recommendation, statistic, leaderboard, rating, valuation, projection, or information available through the Service is at your own risk. VERGR does not guarantee the accuracy, completeness, currency, or reliability of any User-submitted Content, conversion rates, earnings estimates, or any other information on the Service.',
        '20.4 Statutory rights. Nothing in these Terms excludes or limits any warranty, condition, or right that may not be excluded or limited under mandatory applicable consumer-protection law in your jurisdiction. Those rights apply to you despite these Terms, but only to the minimum extent required by law.',
      ],
    },
    {
      id: 'termination',
      title: '21. Suspension and Termination',
      body: [
        '21.1 Termination by you. You may close your Account at any time from your Account settings or by writing to ' + OPERATOR.supportEmail + '. Closure takes effect within a reasonable time. The consequences of closure are described in Section 7.7.',
        '21.2 Termination by VERGR for convenience. VERGR may terminate your access to the Service for any reason on thirty (30) days\' notice, except where these Terms or applicable law permit immediate termination for cause. On termination for convenience, eligible Gem balances at termination will be paid out in accordance with Section 8.',
        '21.3 Termination by VERGR for cause. VERGR may suspend or terminate your Account immediately and without prior notice if (a) you materially breach these Terms or the Acceptable Use Policy; (b) you initiate a chargeback or successful payment dispute in bad faith; (c) you fail Identity Verification or cannot provide additional KYC documents we reasonably require; (d) you are or become a Restricted Person under Section 4.4; (e) your activity exposes VERGR or other Users to risk of loss, regulatory action, or reputational harm; or (f) we are required to do so by court order, regulator, or applicable law.',
        '21.4 Effect of termination. On termination, your access to the Service ends; your right to use Coins, VP, and Gems lapses except as expressly preserved by Section 7.7; the licence in Section 12.2 survives in respect of Content already published; and any provisions of these Terms that by their nature should survive termination (including Sections 7.1, 8.8, 12.2, 14, 22, 23, 25, 26, 27, and 28) shall survive.',
      ],
    },
    {
      id: 'liability',
      title: '22. Limitation of Liability',
      body: [
        '22.1 Excluded damages. To the MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, in no event will VERGR, ' + OPERATOR.legalName + ', its founder Damien Ashton, and each of their respective directors, officers, employees, agents, affiliates, contractors, developers, licensors, and successors (collectively, the "VERGR Parties") be liable to you or any third party for any indirect, incidental, special, consequential, punitive, exemplary, aggravated, or vindictive damages of any kind whatsoever, including without limitation damages for loss of profits, loss of revenue, loss of business opportunity, loss of goodwill, loss of reputation, loss of data, loss of cryptocurrency or virtual currency, loss of use, business interruption, regulatory fines or penalties imposed on you, tax liabilities, or any other intangible loss, arising out of or in any way related to (i) your access to or use of, or inability to access or use, the Service; (ii) any conduct or content of another User or third party on the Service; (iii) any unauthorised access to or alteration of your transmissions or content; (iv) any action or inaction by a third-party payment, identity-verification, or infrastructure provider; (v) any regulatory action taken against you in your jurisdiction; or (vi) any other matter relating to the Service — even if VERGR has been advised of the possibility of such damages and even if any remedy fails of its essential purpose.',
        '22.2 Hard cap on liability. To the maximum extent permitted by applicable law, the TOTAL CUMULATIVE AGGREGATE LIABILITY of the VERGR Parties to you for any and all claims, whether in contract, tort (including negligence), strict liability, statute, or any other theory of liability, arising out of or in connection with these Terms or your use of the Service will NOT EXCEED THE LESSER of (a) the total amount paid by you to VERGR in the three (3) months immediately preceding the event giving rise to the claim, and (b) one hundred euros (€100). This cap is per claimant in aggregate across all claims, not per claim.',
        '22.3 Statutory rights. Nothing in this Section 22 excludes or limits any liability that cannot be excluded or limited under applicable law (for example, liability for fraud, fraudulent misrepresentation, gross negligence, willful misconduct, death or personal injury caused by negligence, or any other liability whose exclusion is prohibited by mandatory consumer-protection law in your jurisdiction). To the extent any such law applies, the limitations in this Section 22 apply to the maximum extent permitted by that law.',
        '22.4 Allocation of risk. You acknowledge and agree that the limitations in this Section 22 are a fundamental basis of the bargain between you and VERGR, that VERGR would not provide the Service to you without these limitations, that the price you pay (if any) reflects this allocation of risk, and that you have had a reasonable opportunity to consult independent advice before accepting these Terms.',
        '22.5 No liability for third-party processors. The Service relies on third-party processors and infrastructure providers (including without limitation our payment processor, Didit, Google Firebase, Cloudflare, Hetzner Online GmbH, and any of their successors or replacements). VERGR is not responsible for, and the VERGR Parties shall have no liability arising from, any act, omission, decision, delay, freeze, reversal, decline, or termination by any such third party. Where such a third party affects your transaction or your access to the Service, your sole and exclusive remedy is to pursue any rights you may have against that third party directly.',
        '22.6 No liability for regulatory action affecting you. If a regulator, court, or other authority in your jurisdiction takes any action affecting your ability to use the Service or affecting your funds, balances, or activity on the Service, that action is not VERGR\'s responsibility, and the VERGR Parties shall have no liability to you arising from it. You acknowledge that the regulatory landscape for competitive gaming, virtual currencies, and cryptocurrency varies by jurisdiction and is your responsibility to monitor.',
      ],
    },
    {
      id: 'no-advice',
      title: '22A. No Professional Advice',
      body: [
        'The Service, including without limitation any content, communication, recommendation, ranking, tip, leaderboard, statistic, valuation, conversion rate, projection, or other information made available to you on or through the Service, is provided for INFORMATIONAL AND ENTERTAINMENT PURPOSES ONLY and does not constitute legal, financial, investment, tax, accounting, regulatory, medical, psychological, or any other form of professional advice. You should not rely on any such content as a substitute for professional advice in the relevant field. If you require professional advice — including but not limited to advice on whether your use of the Service is lawful in your jurisdiction, advice on the tax treatment of your VERGR activity, advice on the financial implications of receiving creator revenue share, or advice on any other matter — you must consult an appropriately qualified professional in your jurisdiction at your own expense. The VERGR Parties disclaim any and all liability arising from your reliance on Service content as advice.',
      ],
    },
    {
      id: 'indemnity',
      title: '23. Indemnification',
      body: [
        '23.1 Your indemnity. To the MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, you agree to indemnify, defend, and hold harmless VERGR, ' + OPERATOR.legalName + ', its founder Damien Ashton, and each of their respective directors, officers, employees, agents, affiliates, contractors, developers, licensors, and successors (the "VERGR Indemnitees") from and against ANY AND ALL claims, demands, actions, proceedings, investigations (whether civil, criminal, regulatory, administrative, or otherwise), losses, judgments, awards, settlements, fines, penalties, liabilities, costs, and expenses (including all reasonable attorneys\' fees, expert fees, investigation costs, and disbursements) of any kind arising out of, related to, or in connection with:',
        list([
          'your access to, use of, or inability to use the Service;',
          'any Content you submit, post, transmit, upload, or make available through the Service;',
          'your violation or alleged violation of these Terms, the Privacy Policy, the Acceptable Use Policy, the Cookie Policy, or any other policy of VERGR;',
          'your violation or alleged violation of any applicable law, regulation, or ordinance in any jurisdiction (including without limitation any gambling, gaming, virtual-currency, cryptocurrency, anti-money-laundering, tax, consumer-protection, or competition law);',
          'your infringement or alleged infringement of any intellectual-property, privacy, publicity, contract, or other right of any third party;',
          'any dispute, controversy, or claim between you and any other User of the Service, including without limitation payment disputes, tip disputes, content disputes, and harassment claims;',
          'any tax, duty, levy, charge, or other governmental imposition arising from your activity on the Service in any jurisdiction;',
          'any chargeback, payment dispute, or reversal initiated by you against any purchase made through the Service;',
          'any circumvention or attempted circumvention by you of the Service\'s geographic, age, identity-verification, or other access controls (including without limitation use of a VPN, proxy, or false declaration of residence);',
          'any fraud, misrepresentation, or willful misconduct by you in connection with the Service;',
          'any regulatory inquiry, investigation, or action commenced against any VERGR Indemnitee by reason of your activity, your jurisdiction, or your conduct.',
        ]),
        '23.2 Defence. The VERGR Indemnitees may, at their option and at your expense, assume exclusive defence and control of any matter for which you are required to indemnify them; in that case, you agree to cooperate fully with their defence. You may not settle any claim affecting a VERGR Indemnitee without that Indemnitee\'s prior written consent. The VERGR Indemnitees may, at their option, decline to assume defence and require you to defend the matter at your own expense using counsel reasonably acceptable to the affected Indemnitee.',
        '23.3 Survival. This Section 23 survives the termination of these Terms and your Account indefinitely with respect to events that occurred during your use of the Service.',
        '23.4 No contribution from VERGR. You agree that the VERGR Indemnitees shall not be required to contribute to any settlement, judgment, or other payment for which you are required to indemnify them, even if the underlying claim alleges joint or concurrent fault.',
      ],
    },
    {
      id: 'force-majeure',
      title: '24. Force Majeure',
      body: [
        'VERGR is not liable for any failure or delay in performing its obligations under these Terms to the extent the failure or delay is caused by events beyond its reasonable control, including acts of God, natural disasters, pandemics or other public-health emergencies, war, civil disturbance, terrorism, government action, labour disputes, electrical or telecommunications outages, internet failures, distributed-denial-of-service attacks, or failures of third-party services on which the Service depends.',
      ],
    },
    {
      id: 'general',
      title: '25. General',
      body: [
        '25.1 Entire agreement. These Terms, together with the Privacy Policy, the Acceptable Use Policy, and any other policies expressly incorporated by reference, constitute the entire agreement between you and VERGR with respect to the Service and supersede all prior agreements between you and VERGR.',
        '25.2 No waiver. Failure by VERGR to enforce any provision of these Terms is not a waiver of that provision or any other provision.',
        '25.3 Severability. If any provision of these Terms is held by a court of competent jurisdiction to be invalid, illegal, or unenforceable, that provision will be enforced to the maximum extent permitted, and the remaining provisions will remain in full force and effect.',
        '25.4 Assignment. You may not assign or transfer these Terms, by operation of law or otherwise, without VERGR\'s prior written consent. VERGR may assign these Terms in its sole discretion, including in connection with a merger, acquisition, or sale of assets. Any purported assignment in violation of this Section 25.4 is void.',
        '25.5 Notices. Notices to you may be given by email to the address associated with your Account, by in-Service notice, or by posting on the Service. Notices to VERGR must be sent to ' + OPERATOR.legalEmail + '.',
        '25.6 No third-party beneficiaries. These Terms confer no rights on any third party, except as expressly stated.',
        '25.7 Relationship. Nothing in these Terms creates a partnership, joint venture, agency, employment, or franchise relationship between you and VERGR.',
        '25.8 Headings. Headings are for convenience only and do not affect interpretation.',
        '25.9 Language. These Terms are written in English. Where VERGR provides translations of these Terms, those translations are for convenience only and the English version controls in the event of a conflict.',
      ],
    },
    {
      id: 'dispute-resolution',
      title: '26. Dispute Resolution and Binding Arbitration',
      body: [
        '26.1 Informal resolution. You and VERGR agree to attempt to resolve any dispute informally before commencing formal proceedings. Before commencing arbitration, you must send a written notice of dispute to ' + OPERATOR.legalEmail + ' describing the nature of the dispute and the relief sought. VERGR will attempt to resolve the dispute by responding within sixty (60) days. If the dispute is not resolved within sixty (60) days of the notice, either party may commence arbitration.',
        '26.2 Arbitration. Any dispute, controversy, or claim arising out of or in connection with these Terms or the Service, including any question regarding their existence, validity, or termination, that is not resolved informally under Section 26.1, will be referred to and finally resolved by binding arbitration under the rules of the Arbitration Foundation of Southern Africa ("AFSA"), seated in Johannesburg, Republic of South Africa, by one or more arbitrators appointed in accordance with those rules.',
        '26.3 Class-action waiver. You and VERGR agree that each may bring claims against the other only in your or its individual capacity and not as a plaintiff or class member in any purported class or representative proceeding. Unless both you and VERGR otherwise agree, the arbitrator may not consolidate more than one person\'s claims, and may not preside over any form of representative or class proceeding.',
        '26.4 Exceptions to arbitration. Either party may bring (a) a claim in small-claims court if eligible; (b) an action in any court of competent jurisdiction for injunctive or other equitable relief in respect of intellectual-property infringement, breach of confidentiality, or other matter in which damages are an inadequate remedy.',
        '26.5 Costs and fees. The parties will bear their own costs of arbitration except as the arbitrator may determine; where required by applicable law, VERGR will pay arbitration filing fees that exceed those that would be payable in court.',
      ],
    },
    {
      id: 'governing-law',
      title: '27. Governing Law',
      body: [
        'These Terms are governed by and construed in accordance with the laws of the ' + OPERATOR.jurisdiction + ', without giving effect to its conflict-of-laws rules. Subject to Section 26, the courts of Johannesburg, Republic of South Africa, have exclusive jurisdiction over any dispute that is not subject to arbitration. Nothing in these Terms deprives you of the protection of mandatory consumer-protection laws of your country of residence where you are entitled to those protections under applicable law.',
      ],
    },
    {
      id: 'contact',
      title: '28. Contact',
      body: [
        'If you have questions about these Terms, please contact us:',
        list([
          'Email (legal): ' + OPERATOR.legalEmail,
          'Email (support): ' + OPERATOR.supportEmail,
          'Email (privacy): ' + OPERATOR.privacyEmail,
          'Registered address: ' + OPERATOR.legalName + ', ' + OPERATOR.registeredAddress,
        ]),
      ],
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════
//                          PRIVACY POLICY
// ═════════════════════════════════════════════════════════════════════

export const PRIVACY_POLICY = {
  label: 'Privacy Policy',
  version: LEGAL_VERSION,
  updated: `Last updated: ${LEGAL_UPDATED}`,
  effective: `Effective: ${LEGAL_EFFECTIVE}`,
  intro: [
    `This Privacy Policy explains how ${OPERATOR.legalName}, a limited liability company formed in the ${OPERATOR.formationState} with its registered address at ${OPERATOR.registeredAddress}, the owner and operator of VERGR ("VERGR", "we", "us", "our"), and acting as the data controller for the personal information described below, collects, uses, discloses, retains, and protects personal information when you use the VERGR competitive gaming social platform at ${OPERATOR.website} and any associated applications (collectively, the "Service"). It also explains the rights you have in relation to your personal information.`,
    `This Privacy Policy is incorporated into and forms part of our Terms of Service. By creating an Account or otherwise using the Service you confirm that you have read this Privacy Policy and that, where required by applicable law, you consent to the processing of your personal information as described here.`,
    `VERGR is the controller of personal information processed in connection with the Service. Contact details are in Section 14 below.`,
  ],
  sections: [
    {
      id: 'scope',
      title: '1. Scope',
      body: [
        '1.1 This Privacy Policy applies to personal information collected through the Service. It does not apply to (a) information you provide to third parties through linked services such as Steam, Discord, Twitch, YouTube, Battle.net, Riot Games, Epic Games Services, or Xbox Live, which are governed by those third parties\' own privacy policies; (b) personal information collected by VERGR in capacities other than as operator of the Service.',
        '1.2 "Personal information" means information about an identified or identifiable natural person, including the categories of data set out in Section 2.',
      ],
    },
    {
      id: 'data-we-collect',
      title: '2. Personal Information We Collect',
      body: [
        '2.1 Information you provide directly:',
        list([
          'Account information — email address, password (stored as a salted, hashed value), display name, username, profile image, banner, biography, date of birth, country, communications-preference flags, and other profile fields you choose to populate.',
          'Identity-verification information: government-issued photo identification, selfie image, liveness-check data, derived attributes (full name, date of birth, country, document type and number, address where present on the document). This information is collected by our Identity Verification provider, Didit, on our behalf. Didit shares the verification result and limited derived attributes with us, as described in Section 6.1 below.',
          'Linked-account information — username, user identifier, and any other identifiers exposed by third-party gaming and social platforms you choose to link (Steam, Discord, Twitch, YouTube, Battle.net, Riot Games, Epic Games Services, Xbox Live via OpenXBL).',
          'Payment information — card or wallet identifiers, billing address, transaction amounts, and other data required to process a purchase, as collected by our payment processors. We do not store full primary-account-number ("PAN") data; tokens or last-four digits may be stored to enable receipts and dispute investigations.',
          'Payout information — the payout account details you connect through our payments partner, your tax documentation, the legal name and country associated with it, and the amounts and metadata of payments made to you.',
          'Phone number — if you choose to add one, your phone number in international format and a one-way cryptographic hash of it (used for friend matching and referral verification).',
          'Contact matching (optional) — if you use the "find friends" feature, the phone numbers of contacts you select are hashed on your device and only those one-way hashes are sent to our servers to check for matches against registered Users. Raw contact names and numbers are never uploaded, never stored, and are discarded from memory after the match check. The feature requires that you have first saved your own phone number, and it only runs when you actively invoke it.',
          'Content — posts, comments, messages, clips, livestream recordings, profile content, support messages, reports, appeals, and other content you submit.',
          'Communications — emails, support tickets, in-app chats with support, and the metadata associated with them.',
          'Other voluntary disclosures — any other information you choose to provide.',
        ]),
        '2.2 Information collected automatically:',
        list([
          'Device and usage information — IP address; approximate location derived from IP (country, region, city); device type, operating system, browser type and version; screen resolution; language; time zone; device identifiers and advertising identifiers where available.',
          'Session and activity data — pages and screens visited; features used; clicks, taps, scrolls; timestamps; referring URLs; in-app events such as purchases, Tips sent and received, streams watched, and content published.',
          'Activity and economy events — streams started and watched, content published, paid stream access purchases, Wallet movements, Tips sent and received.',
          'Cookies and similar technologies — see Section 9.',
          'Stream-quality and moderation data — bitrate, dropped frames, viewer counts, chat messages and reactions, automated-moderation outcomes.',
        ]),
        '2.3 Information from third parties:',
        list([
          'Identity-verification results from Didit (Section 6.1).',
          'Payment-status events from our payment processor (Section 6.2).',
          'Public profile information from linked gaming platforms when you connect them (e.g. Steam username and avatar).',
          'Sanctions, fraud, and watch-list information from screening providers we may use.',
          'Referral information when a User signs up via another User\'s referral link.',
          'Imported community history — when a community owner migrates a group from another platform (Discord or WhatsApp), the imported messages retain their original author names, avatars, and timestamps. Original authors may delete their own imported messages, and the group owner may remove any of them; imported messages are attributed to a Vergr account only through an explicit, user-initiated claim.',
        ]),
      ],
    },
    {
      id: 'purposes-legal-bases',
      title: '3. Purposes of Processing and Legal Bases',
      body: [
        '3.1 We process personal information for the following purposes, on the legal bases identified. Where you are protected by the EU General Data Protection Regulation 2016/679 ("GDPR") or the UK GDPR, the indicated lawful basis applies under Article 6 GDPR.',
        list([
          'Account creation and operation — necessary for the performance of our Terms of Service (Article 6(1)(b) GDPR).',
          'Identity Verification, age verification, KYC, sanctions screening, and fraud prevention — necessary for compliance with legal obligations (Article 6(1)(c) GDPR) and our legitimate interests in operating a lawful, fraud-resistant service (Article 6(1)(f) GDPR).',
          'Payment processing and Gem payouts — performance of contract with you (Article 6(1)(b) GDPR) and legal obligations under anti-money-laundering and tax law (Article 6(1)(c) GDPR).',
          'Provision of in-Service features — performance of contract (Article 6(1)(b) GDPR).',
          'Customer support — performance of contract (Article 6(1)(b) GDPR) and legitimate interests (Article 6(1)(f) GDPR).',
          'Service improvement, analytics, debugging, and capacity planning — legitimate interests in operating and improving the Service (Article 6(1)(f) GDPR).',
          'Security, abuse-prevention, and platform-integrity investigations — legitimate interests in protecting Users and the Service (Article 6(1)(f) GDPR).',
          'Marketing and promotional communications — your consent (Article 6(1)(a) GDPR), withdrawable at any time, or legitimate interests where permitted by applicable law (e.g. soft-opt-in for existing customers).',
          'Legal and regulatory compliance — legal obligations (Article 6(1)(c) GDPR) and, where applicable, the establishment, exercise, or defence of legal claims (Article 9(2)(f) GDPR where special-category data is involved).',
        ]),
        '3.2 Special-category data. Identity documents may include data that under the GDPR is treated as special-category (for example, an image revealing racial or ethnic origin). Where we process such data we rely on the legal bases in Article 9(2)(f) (establishment, exercise, or defence of legal claims), Article 9(2)(g) (substantial public interest, including AML and fraud prevention, where applicable), or your explicit consent (Article 9(2)(a)).',
      ],
    },
    {
      id: 'how-we-use',
      title: '4. How We Use Personal Information',
      body: [
        'We use personal information to:',
        list([
          'create and manage your Account;',
          'verify your age and identity (via Didit) and screen for sanctions and watch-list matches;',
          'process Coin purchases and subscription payments through our processors, and pay creator revenue share;',
          'provide the Service, including hosting profiles, posts, comments, messages, livestreams, clips, squads, and the Wallet;',
          'enforce eligibility: a self-declared age of at least 18 and a non-Restricted Jurisdiction at signup, and Identity Verification through Didit before VERGR pays a creator their revenue share;',
          'detect, prevent, and respond to fraud, cheating, collusion, account-takeover, harassment, abuse, and other violations of the Terms of Service;',
          'communicate with you about the Service, including transactional notices, security alerts, dispute-resolution updates, and material changes to these documents;',
          'send you marketing communications where permitted by law and where you have not opted out;',
          'comply with legal obligations, respond to lawful requests, and exercise or defend legal claims;',
          'improve, debug, and operate the Service, including performance, capacity, A/B testing, and analytics;',
          'show you content relevant to your interests, including discovery and recommendations.',
        ]),
      ],
    },
    {
      id: 'sharing',
      title: '5. How We Share Personal Information',
      body: [
        'We do not sell personal information. We share personal information only as set out below.',
        '5.1 Other Users. Public profile information, public posts, public livestreams, leaderboards, and similar content are visible to other Users by design. Direct messages are visible to their intended recipients. Wallet balances, payout histories, identity-verification details, and contact information (other than the username) are private.',
        '5.2 Processors and service providers. We share personal information with processors and service providers who help us operate the Service, including those listed in Section 6, on the basis of data-processing agreements that limit their use to providing the relevant service to us.',
        '5.3 Legal disclosures. We may disclose personal information where we are required to do so by law, court order, regulator, or government authority of competent jurisdiction; where disclosure is necessary to protect VERGR, Users, or others from imminent harm; or to investigate or prosecute fraud or other unlawful conduct.',
        '5.4 Successor in interest. In the event of a merger, acquisition, sale of assets, restructuring, or insolvency, personal information may be transferred to a successor or acquirer. Where the GDPR or UK GDPR applies, you will be notified of any such transfer and any change in controller.',
        '5.5 Aggregate and de-identified data. We may share information that has been aggregated or de-identified such that it can no longer reasonably be used to identify you (for example, "X percent of Users watched at least one live stream last quarter").',
      ],
    },
    {
      id: 'subprocessors',
      title: '6. Subprocessors and Third-Party Recipients',
      body: [
        '6.1 Identity Verification: Didit (didit.me). We instruct Didit to perform Identity Verification on your government ID and selfie. Didit receives the documents and selfie you submit, performs the verification, retains the verification record under its own retention policy, and returns the verification result and limited derived attributes (verified yes/no, age, country, document type) to us. Didit\'s privacy notice is available at https://didit.me/privacy-policy.',
        '6.2 Payment processors:',
        list([
          'A third-party payment processor that handles inbound Coin and subscription purchases, and the outbound payment of creator revenue share. The processor collects the payment and routing data needed to execute each transaction and processes it under its own privacy policy.',
        ]),
        '6.3 Infrastructure:',
        list([
          'Google LLC (Firebase) — application backend, authentication, database (Firestore), cloud functions, hosting, and push notifications. Firebase processes personal information on our behalf in connection with these services. Google\'s data-processing terms apply.',
          'Cloudflare, Inc. — content delivery network, DDoS mitigation, R2 object storage for user-uploaded media, and DNS. Cloudflare may process IP addresses and other technical data to provide the service.',
          'Hetzner Online GmbH (Germany) — hosting for live-streaming ingest, transcoding, signaling, and related infrastructure.',
        ]),
        '6.4 Linked platforms (only when you connect them):',
        list([
          'Valve Corporation (Steam) — Steam OpenID sign-in and Game State Integration for CS2 and Dota 2.',
          'Discord Inc., Twitch Interactive Inc., Google LLC (YouTube), Activision Blizzard (Battle.net), Riot Games Inc., Epic Games Inc., Microsoft Corporation (Xbox Live, via OpenXBL Ltd).',
        ]),
        '6.5 Other:',
        list([
          'Email delivery — transactional emails (verification, receipts, security alerts) may be sent through a transactional-email provider.',
          'Customer-support — support ticketing may be operated through a support-desk provider.',
          'Analytics — product analytics may be processed through a privacy-respecting analytics provider; we will identify the provider in this Privacy Policy when one is engaged.',
        ]),
        '6.6 Sanctions and fraud screening — third-party screening services may be used in connection with Identity Verification and ongoing fraud monitoring.',
      ],
    },
    {
      id: 'international-transfers',
      title: '7. International Transfers',
      body: [
        '7.1 Personal information may be processed in countries other than the country where you live. In particular, some of our processors are established outside the European Economic Area (Cloudflare, Google LLC) or in jurisdictions that the European Commission has not deemed to provide an adequate level of data protection.',
        '7.2 Safeguards. Where personal information of EEA or UK data subjects is transferred to a third country that is not the subject of an adequacy decision, we rely on appropriate safeguards, principally the European Commission\'s Standard Contractual Clauses (2021/914) and, for transfers from the United Kingdom, the UK International Data Transfer Addendum, supplemented by transfer-impact assessments where required.',
        '7.3 You may request a copy of the safeguards in place for transfers of your personal information by writing to ' + OPERATOR.privacyEmail + '.',
      ],
    },
    {
      id: 'retention',
      title: '8. Data Retention',
      body: [
        '8.1 We retain personal information only as long as necessary for the purposes set out in this Privacy Policy or as required by applicable law. Specific retention periods are:',
        list([
          'Account profile data — for the lifetime of the Account. After Account closure, profile data is removed from public-facing surfaces within thirty (30) days; residual copies may persist in backups and logs for a reasonable period thereafter (typically up to ninety (90) days).',
          'Identity Verification records: for as long as the Account is open and for a minimum of five (5) years after closure (to satisfy anti-money-laundering record-keeping obligations). Didit retains the raw documents under its own policy; we retain only the result, the verification reference, and limited derived attributes.',
          'Financial records — Wallet movements, purchases, payouts, and tax-relevant records are retained for a minimum of seven (7) years from the date of the transaction, to satisfy tax and accounting obligations.',
          'Transaction records — purchases, Tips, paid stream access, and creator payouts are retained for at least five (5) years to support dispute resolution, accounting, and integrity investigations.',
          'Support communications — for as long as the Account is open and for a reasonable period thereafter (typically two (2) years).',
          'Live-stream recordings — public stream recordings are retained for as long as the recording remains published; on deletion, residual copies may persist in backups for a reasonable period. Recordings retained for moderation or evidentiary purposes may be held longer.',
          'Server, application, and security logs — typically thirty (30) to ninety (90) days; longer for logs implicated in security or fraud investigations.',
          'Cookies — see Section 9.3.',
        ]),
        '8.2 At the end of the applicable retention period, personal information is deleted, anonymised, or aggregated such that it can no longer reasonably be used to identify you.',
        '8.3 Notwithstanding the foregoing, where personal information is the subject of a legal hold or is necessary for the establishment, exercise, or defence of legal claims, we may retain it for as long as required for that purpose.',
      ],
    },
    {
      id: 'cookies',
      title: '9. Cookies and Similar Technologies',
      body: [
        '9.1 What we use. We use cookies, local storage, session storage, and similar technologies for the following purposes:',
        list([
          'strictly necessary — to keep you signed in, remember your security preferences, route your requests, and prevent fraud;',
          'preferences — to remember your locale, theme, and similar interface preferences;',
          'performance and analytics — to understand how Users use the Service, to debug issues, and to measure performance;',
          'security — to detect bot traffic, denial-of-service attempts, and account-takeover attempts.',
        ]),
        '9.2 Choice. Strictly-necessary cookies are required to use the Service and are set without consent where the law permits. For other categories, you may manage your preferences from the in-Service cookie banner or your browser settings. Disabling certain categories may degrade the functionality of the Service.',
        '9.3 Retention. Cookies are retained for periods ranging from the duration of a single session (session cookies) to up to twenty-four (24) months (persistent cookies). Specific durations are listed in the cookie banner.',
        '9.4 Do Not Track. We do not currently respond to "Do Not Track" browser signals because there is no commonly accepted standard for them.',
      ],
    },
    {
      id: 'security',
      title: '10. Security',
      body: [
        '10.1 We implement administrative, technical, and physical safeguards designed to protect personal information against unauthorised access, alteration, disclosure, loss, or destruction. Measures include encryption in transit (TLS), encryption at rest for designated data, role-based access controls, principle-of-least-privilege provisioning, regular access reviews, secure software-development practices, and periodic security testing.',
        '10.2 No security measure is impenetrable. You are responsible for keeping your Account credentials confidential, enabling two-factor authentication where available, and notifying us promptly of any suspected compromise.',
        '10.3 In the event of a personal-data breach that is likely to result in a risk to your rights and freedoms, we will notify the competent supervisory authority and, where required, you, in accordance with applicable law.',
      ],
    },
    {
      id: 'your-rights',
      title: '11. Your Rights',
      body: [
        '11.1 Subject to applicable law, you may have the following rights in respect of your personal information:',
        list([
          'access — to obtain a copy of personal information we hold about you;',
          'rectification — to have inaccurate or incomplete personal information corrected;',
          'erasure — to have personal information deleted, in certain circumstances;',
          'restriction — to have processing restricted, in certain circumstances;',
          'portability — to receive personal information you provided in a structured, commonly used, machine-readable format and (where technically feasible) to have it transmitted to another controller;',
          'objection — to object to processing based on our legitimate interests, including for direct marketing;',
          'withdrawal of consent — where processing is based on consent, you may withdraw consent at any time, without affecting the lawfulness of processing carried out before withdrawal;',
          'not be subject to a decision based solely on automated processing, including profiling, which produces legal effects concerning you or similarly significantly affects you, except as permitted by applicable law.',
        ]),
        '11.2 To exercise any of these rights, write to ' + OPERATOR.privacyEmail + '. We may need to verify your identity before fulfilling a request. We will respond within the time limits required by applicable law (typically one (1) month under the GDPR, extendable by two (2) further months where necessary).',
        '11.3 Lodging a complaint. If you are in the EEA or the UK, you have the right to lodge a complaint with your local data-protection supervisory authority. A list of authorities is available at https://edpb.europa.eu/about-edpb/board/members_en (EEA) and at https://ico.org.uk (UK).',
        '11.4 California residents. California residents have rights under the California Consumer Privacy Act ("CCPA") as amended by the California Privacy Rights Act ("CPRA"), including rights of access, deletion, correction, and to opt out of "sale" or "sharing" of personal information. We do not sell personal information for monetary consideration. To exercise CCPA rights, write to ' + OPERATOR.privacyEmail + '.',
      ],
    },
    {
      id: 'automated-decisions',
      title: '12. Automated Decision-Making',
      body: [
        '12.1 We use automated systems to (a) detect suspicious activity such as multi-accounting, fraud, payment abuse, and manipulation of engagement metrics; (b) screen for sanctions matches; (c) moderate Content (text, images, livestreams); (d) limit access by age, jurisdiction, and Identity Verification status; and (e) rank discovery feeds.',
        '12.2 Automated decisions that significantly affect you — such as suspension of your Account, blocking a payout, or removing your Content — are reviewed by a human moderator before taking effect, except where immediate automated action is necessary to prevent imminent harm or where applicable law permits.',
        '12.3 You may request human review of any automated decision that significantly affects you by writing to ' + OPERATOR.supportEmail + '.',
      ],
    },
    {
      id: 'children',
      title: '13. Children',
      body: [
        '13.1 The Service is for adults only. We do not knowingly collect personal information from anyone under the age of eighteen (18). If we become aware that we have inadvertently collected information from a person under 18, we will take reasonable steps to delete that information.',
        '13.2 If you are a parent or guardian and believe your child has provided us with personal information without your consent, please contact us at ' + OPERATOR.privacyEmail + '.',
      ],
    },
    {
      id: 'contact',
      title: '14. Contact and Complaints',
      body: [
        'Privacy contact:',
        list([
          'Email: ' + OPERATOR.privacyEmail,
          'Postal address: available on written request to ' + OPERATOR.privacyEmail,
          'Controller: ' + OPERATOR.legalName + ', ' + OPERATOR.jurisdiction,
        ]),
        'We do not currently have a representative in the EEA or the United Kingdom under Article 27 GDPR / Article 27 UK GDPR. If we appoint one, this Privacy Policy will be updated with their details.',
      ],
    },
    {
      id: 'changes',
      title: '15. Changes to this Privacy Policy',
      body: [
        'We may update this Privacy Policy from time to time. Material changes will be announced through in-Service notice or email. The date at the top of this Privacy Policy is the date of the most recent revision. Your continued use of the Service after the effective date of a change means you accept the updated Privacy Policy.',
      ],
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════
//                         ACCEPTABLE USE POLICY
// (also embedded in Terms of Service §14; published separately for clarity
// and to satisfy processor-compliance requirements that an AUP exist as a
// standalone document.)
// ═════════════════════════════════════════════════════════════════════

export const ACCEPTABLE_USE_POLICY = {
  label: 'Acceptable Use Policy',
  version: LEGAL_VERSION,
  updated: `Last updated: ${LEGAL_UPDATED}`,
  intro: [
    `This Acceptable Use Policy ("AUP") sets out the conduct that is not permitted on the VERGR Service. It supplements and forms part of the Terms of Service. Violations may result in Content removal, feature restrictions, Account suspension or termination, forfeiture of balances, and referral to law enforcement.`,
  ],
  sections: [
    {
      id: 'overview',
      title: '1. Overview',
      body: [
        'You are responsible for everything that happens on your Account. Behaviour that harms other Users, damages the Service, breaks the law, or compromises competitive integrity is not allowed. This AUP is non-exhaustive — VERGR may take action against conduct that, in its reasonable judgment, violates the spirit of these rules even if not specifically enumerated.',
      ],
    },
    {
      id: 'universal-prohibitions',
      title: '2. Universal Prohibitions (everywhere on Vergr, no exceptions)',
      body: [
        'The following are prohibited on every part of the Service, without exception. They apply to public content, to live broadcasts, to private messages, to group and squad chats, to 1:1 Sessions, and to anything sold behind a price. There is no surface of Vergr on which any of this is permitted, and paying or being paid changes nothing about it. Violations are removed on sight, end accounts, and where the conduct is criminal are referred to law enforcement.',
        list([
          'Any sexual content involving, depicting, or sexualising a person under 18, in any format, real, drawn, or generated. This is reported to NCMEC as described in our Child Safety Standards.',
          'Intimate or sexual imagery of any person who has not given their consent for it to be shown, shared, or sold, including imagery obtained by deception, hacking, or from a former partner ("revenge porn"), and including content the sender did not create and has no right to distribute.',
          'Recording, screen-capturing, or retransmitting another person in a private message, group, squad chat, or 1:1 Session without their express consent.',
          'Offering, requesting, arranging, or paying for in-person sexual services, prostitution, escorting, or any form of human trafficking or sexual exploitation.',
          'Coercing, blackmailing, or extorting another person, including threatening to publish someone\'s images or messages ("sextortion").',
          'Content that depicts or promotes real-world violence, self-harm, terrorism, or cruelty to people or animals.',
          'Content that is unlawful, fraudulent, or that infringes another person\'s intellectual-property, privacy, or publicity rights.',
          'Disclosing another person\'s private personal information ("doxxing") without their consent.',
          'Malicious code, phishing, scams, and fraud.',
        ]),
        'If you encounter any of the above, report it. Every surface of the Service, including private conversations and 1:1 Sessions, carries a report control, and a report can be made whether or not you paid for the content or were paid for it.',
      ],
    },
    {
      id: 'broadcast-content-standards',
      title: '3. Content Standards',
      body: [
        'These standards apply to everything you publish, send or broadcast on VERGR. Every surface, every audience size, free or paid, public or private. Paying for something does not change what is permitted, and neither does sending it to one person instead of a thousand.',
        'You must not post, upload, livestream, send, or otherwise transmit Content that:',
        list([
          'is sexually explicit or sexually suggestive. Nudity, sexual acts, and material that is pornographic or primarily sexual in nature are prohibited. This extends to sexually explicit language, gestures and emoji, and to offering, requesting or arranging sexual services or sexual interactions of any kind through the Service. This is enforced automatically: media is scanned before it becomes visible and nudity is blocked;',
          'sexualises, or appears to sexualise, any person under the age of eighteen (18). This is absolute, it is assessed on apparent age, and confirmed material is preserved and reported to the relevant authorities. See our CSAM, Non-Consensual and Illegal Content Procedures;',
          'is intimate or sexual imagery of a person who has not consented to it being shown, shared or sold, including imagery obtained by deception or hacking, imagery of a former partner, and synthetic or altered imagery of a real person;',
          'is unlawful, fraudulent, threatening, defamatory, libellous, harassing, hateful, or sexually violent;',
          'shows graphic real-world violence, meaning actual gore, mutilation, killing, execution, torture, or serious injury filmed or photographed in real life, outside a clearly newsworthy context. Violence in video games, game footage, trailers and game art is expressly allowed and is not covered by this rule;',
          'depicts real-world cruelty to people or animals, or promotes self-harm or suicide;',
          'infringes any third party\'s intellectual-property, privacy, or publicity right;',
          'discloses another person\'s private personal information ("doxxing") without consent;',
          'promotes illegal goods or services, including controlled substances, weapons, and unlicensed gambling;',
          'is deceptive, misleading, or constitutes scam, phishing, or fraud;',
          'contains malicious code, viruses, or other harmful payloads.',
        ]),
        'Recording, screen-capturing, or retransmitting another person in a 1:1 Session, direct message, group, or squad chat without their express consent is prohibited.',
        'Coercing, blackmailing, or extorting another person, including threatening to publish someone\'s images or messages, is prohibited and results in immediate termination.',
        'If you encounter any of the above, report it. Every surface of the Service, including private conversations, carries a report control, and a report can be made whether or not you paid for the Content or were paid for it.',
      ],
    },
    {
      id: 'mature-themes',
      title: '3A. Mature Language and Themes',
      body: [
        'VERGR is an 18+ Service and we do not police ordinary adult conversation. Swearing, dark humour, discussion of adult subject matter, and games with mature ratings are all part of normal use here.',
        'You may mark a live stream as containing mature language or themes so that viewers know what they are joining. Marking a stream is an advisory label for the audience. It is a courtesy, not a permission.',
        'A mature marking does not permit anything prohibited by Section 3. In particular it does not permit nudity or sexual content, which are prohibited on every surface of the Service regardless of labelling, audience, payment, or consent between the people involved.',
        'VERGR may apply or correct a mature marking itself, including automatically. Deliberately mislabelling Content, in either direction, is a breach of these Terms.',
      ],
    },
    {
      id: 'conduct-rules',
      title: '4. Conduct Rules',
      body: [
        'You must not:',
        list([
          'harass, bully, intimidate, or threaten any User, moderator, host, or VERGR employee;',
          'impersonate another person or misrepresent your affiliation with any person, organisation, or entity;',
          'organise, advertise, solicit, or settle gambling, betting, wagering, or any staking arrangement, anywhere on the Service, including in live stream chat, direct messages, group chats, and squad chats;',
          'create or use multiple Accounts to evade restrictions, manipulate the economy, abuse promotions, or evade fees;',
          'access another User\'s Account without authorisation, share credentials, or sell or rent your Account;',
          'engage in real-money trading of Coins, VP, Gems, items, or Accounts outside the in-Service mechanisms;',
          'use the Service to launder money, finance terrorism, evade sanctions, or process the proceeds of crime;',
          'circumvent geographic restrictions by VPN, proxy, false declarations, or other means;',
          'manipulate ratings, leaderboards, polls, or any other in-Service signal;',
          'use the Service to send unsolicited bulk communications, malware, or phishing attempts.',
        ]),
      ],
    },
    {
      id: 'technical-rules',
      title: '5. Technical Rules',
      body: [
        'You must not:',
        list([
          'reverse engineer, decompile, disassemble, or attempt to extract source code from the Service, except as permitted by applicable law;',
          'use automated means (scrapers, crawlers, harvesters) to extract data from the Service except in accordance with VERGR\'s API documentation and rate limits;',
          'interfere with the Service or its infrastructure, including by denial-of-service, port-scanning, vulnerability-scanning, load-testing, or stress-testing without prior written authorisation;',
          'circumvent rate limits, paywalls, age gates, geographic restrictions, or other access controls;',
          'remove or alter any proprietary notice on the Service or in VERGR Content;',
          'introduce malware or other harmful code into the Service.',
        ]),
      ],
    },
    {
      id: 'enforcement',
      title: '6. Enforcement',
      body: [
        'Violations of this AUP are material breaches of the Terms of Service. VERGR may, in its discretion and consistent with applicable law, remove offending Content, restrict features of an Account, suspend an Account temporarily, terminate an Account permanently, forfeit balances, withhold pending payouts, and refer matters to law enforcement. In appropriate cases VERGR will pursue civil and criminal remedies.',
      ],
    },
    {
      id: 'reporting',
      title: '7. Reporting Violations',
      body: [
        'Every surface of the Service carries a report control, including the ones nothing scans automatically. You can report a post, a comment, a profile, a squad, a live stream, a direct message conversation, a group or squad chat, an individual piece of purchased media, and a 1:1 Session. In a live stream or a 1:1 Session the control is available while the session is running, not only afterwards.',
        'A report can be made whether or not money changed hands. Being paid does not give anyone the right to prevent, discourage, or retaliate against a report, and attempting to do so is itself a violation of this policy.',
        'Reports are confidential. The person reported is not told who filed the report.',
        'Response targets. We aim to act within the following times of a report reaching us:',
        list([
          'Child sexual abuse or exploitation: reviewed immediately on receipt, and acted on within 24 hours. Confirmed material is reported to NCMEC as described in our Child Safety Standards.',
          'Non-consensual intimate imagery, recording someone without consent, coercion or sextortion: within 24 hours.',
          'Everything else: within 72 hours.',
        ]),
        'Where content is reported under one of the 24-hour categories, we may restrict access to it while the review is in progress rather than after it concludes.',
        'You can also write to ' + OPERATOR.abuseEmail + '. For child-safety matters specifically, see our Child Safety Standards, which set out a dedicated route and our legal reporting obligations.',
      ],
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════
//                            COOKIE POLICY
// ═════════════════════════════════════════════════════════════════════

export const COOKIE_POLICY = {
  label: 'Cookie Policy',
  version: LEGAL_VERSION,
  updated: `Last updated: ${LEGAL_UPDATED}`,
  intro: [
    `This Cookie Policy explains how VERGR uses cookies and similar technologies on the Service. It supplements the Privacy Policy.`,
  ],
  sections: [
    {
      id: 'what-are-cookies',
      title: '1. What are Cookies?',
      body: [
        'Cookies are small text files placed on your device by a website you visit. They are widely used to make websites work, to make them work more efficiently, and to provide information to the website operator. Similar technologies include local storage, session storage, web beacons, and pixel tags. References in this Cookie Policy to "cookies" include these similar technologies.',
      ],
    },
    {
      id: 'categories',
      title: '2. Categories of Cookies We Use',
      body: [
        '2.1 Strictly necessary — required for the Service to function: authentication, security, session continuity, fraud prevention. These cookies are set without consent where applicable law permits.',
        '2.2 Preferences — remember your locale, theme, interface preferences, and other non-essential settings.',
        '2.3 Performance and analytics — help us understand how Users use the Service, debug issues, measure performance, and improve features.',
        '2.4 Security — detect bots, denial-of-service attempts, account-takeover attempts, and similar abuse.',
      ],
    },
    {
      id: 'managing',
      title: '3. Managing Cookies',
      body: [
        'You can manage non-essential cookies through the in-Service cookie banner the first time you visit and from your browser settings at any time afterward. Disabling certain categories may degrade Service functionality.',
        'For more information about cookies and how to control them, see https://www.allaboutcookies.org.',
      ],
    },
    {
      id: 'changes',
      title: '4. Changes to this Policy',
      body: [
        'We may update this Cookie Policy. Material changes will be announced through in-Service notice. The "Last updated" date at the top reflects the most recent revision.',
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// Child Safety Standards — REQUIRED by Google Play for apps in the Social
// category (Child Safety Standards policy). Play checks that the URL loads,
// mentions CSAE/child safety, and names the app or developer as they appear
// on the store listing, so DO NOT rename VERGR or Murmont LLC out of it.
//
// Every commitment below is one the product already keeps: 18+ only (Terms
// 4.1), Gemini CSAM screening at a 0.30 confidence threshold with fail-safe
// blocking (functions/contentAi.js), and in-app reporting on posts, comments,
// profiles and streams into the Vanguard queue. Do not add a commitment here
// that isn't implemented — this page is the thing Google measures us against.
// ─────────────────────────────────────────────────────────────────────

export const CHILD_SAFETY_STANDARDS = {
  label: 'Child Safety Standards',
  version: LEGAL_VERSION,
  updated: `Last updated: ${LEGAL_UPDATED}`,
  intro: [
    `VERGR is operated by ${OPERATOR.legalName}. These are our published standards against child sexual abuse and exploitation ("CSAE"), including child sexual abuse material ("CSAM"), as required by the Google Play Child Safety Standards policy.`,
    `VERGR is an adult-only service. Nobody under 18 is permitted to hold an account. We have zero tolerance for CSAE of any kind, and we act on it whether it is detected automatically, reported by a user, or referred to us by an authority.`,
    `If you came here looking for the limits of what you can get away with, there are none to find. There is no warning, no strike system, and no appeal. Accounts are terminated permanently, balances are forfeited, records are preserved, and reports go to law enforcement in your own country. Section 5 sets out what happens; Section 6 sets out what we and our providers hold about you when it does.`,
  ],
  sections: [
    {
      id: 'age',
      title: '1. VERGR is an 18+ Service',
      body: [
        '1.1 Minimum age. You must be at least 18 years old, or the higher age of majority in your jurisdiction, to create a VERGR account. This is stated in Section 4.1 of our Terms of Service and is a condition of use, not a recommendation.',
        '1.2 Age declaration at signup. Every user must declare an age of at least 18 when registering. Accounts are also age-rated 18+ on Google Play, and we do not knowingly collect information from anyone under 18.',
        '1.3 Verified identity for financial features. Before VERGR pays a creator their revenue share, that creator must complete identity verification through our verification provider, which includes a government-issued photo ID and a liveness-checked selfie screened against age criteria.',
        '1.4 Enforcement. If we become aware that an account belongs to a person under 18, the account is closed and the account holder\'s data is deleted in accordance with our Privacy Policy.',
      ],
    },
    {
      id: 'prohibited',
      title: '2. Prohibited Conduct',
      body: [
        'The following are strictly prohibited on VERGR and result in immediate removal of the content, permanent termination of the account, and referral to law enforcement where applicable:',
        '2.1 Creating, uploading, storing, sharing, linking to, requesting, or soliciting child sexual abuse material, in any format, including text, images, video, audio, live streams, direct messages, and generated or synthetic media.',
        '2.2 Sexualising a minor in any way, including through commentary, roleplay, captions, usernames, avatars, or profile content.',
        '2.3 Grooming: any attempt to establish contact or build a relationship with a minor for the purpose of sexual exploitation or abuse.',
        '2.4 Sextortion: threatening to expose intimate imagery in order to obtain further imagery, money, or any other benefit.',
        '2.5 Trafficking, advertising, or facilitating access to a minor for sexual purposes.',
        '2.6 Using VERGR to direct anyone to off-platform CSAE material or communities.',
        'These prohibitions apply regardless of whether the material is fictional, artistic, animated, AI-generated, or claimed to be legal in the user\'s jurisdiction.',
        '2.7 No defence. None of the following is a defence, a mitigating factor, or a reason for us to reduce any consequence: that the account was shared or compromised; that the material was received rather than sent; that it was posted as a joke, a test, bait, or to report someone else; that it was not opened or viewed; that the account was new; that a VPN, proxy, or false location was used; or that the conduct is not criminal where the user claims to be. Attempting any of the above is treated identically to completing it.',
      ],
    },
    {
      id: 'detection',
      title: '3. How We Detect CSAE',
      body: [
        '3.1 Automated screening. Content posted to public surfaces of VERGR — posts, images, video clips, live-stream frames, and public chat — is screened by an automated moderation system before or immediately after publication. CSAM detection is fail-safe: any suspicion at or above a low confidence threshold results in a block, deliberately accepting false positives rather than risk a miss.',
        '3.2 Zero-tolerance routing. Automated CSAM signals do not queue for routine review. Matching content is blocked and the account is escalated immediately.',
        '3.3 Human review. Our moderation team, the Vanguard, reviews escalations and user reports. Child-safety reports are prioritised above all other report types.',
        '3.4 Private messaging. Direct and group messages are private and are not subject to routine automated scanning. They remain fully in scope of these standards: we act on every report we receive about a private conversation, and we can and do preserve and disclose message content to law enforcement where legally required.',
      ],
    },
    {
      id: 'reporting',
      title: '4. How to Report Child Sexual Abuse and Exploitation',
      body: [
        '4.1 In the app. Every post, comment, profile, and live stream carries a Report control. Open the "…" menu on the item and choose Report. Reports are received by our moderation team without you leaving the app.',
        '4.2 By email. You can also write to us at ' + OPERATOR.supportEmail + '. Put "CHILD SAFETY" in the subject line so it is routed with priority.',
        '4.3 What happens next. Child-safety reports are triaged ahead of the normal queue. Confirmed violations result in immediate content removal, permanent account termination, preservation of the relevant records, and reporting to the appropriate authority.',
        '4.4 Report to authorities directly. If a child is in immediate danger, contact your local emergency services first. You can also report to the National Center for Missing & Exploited Children at https://report.cybertip.org, or to your national hotline through INHOPE at https://www.inhope.org.',
      ],
    },
    {
      id: 'response',
      title: '5. Consequences — Read This Before You Do Anything Stupid',
      body: [
        'There is no warning system here, no strike count, and no appeal on the merits. The first violation is the last one.',
        '5.1 Removal and termination. Confirmed CSAE content is removed immediately. The responsible account is permanently terminated, not suspended. We take active steps to prevent the same person registering again, including blocking the verified identity, the phone number, the payment instrument, and the device behind the account.',
        '5.2 Forfeiture. Any Coins or other balance held by the account is frozen at once and forfeited. Any unpaid creator revenue share is forfeited. Nothing is refunded. Money paid to us by an account terminated under this policy is not returned under any circumstances, and we will contest any chargeback attempted on it.',
        '5.3 Criminal referral. As a United States company, ' + OPERATOR.legalName + ' reports apparent child sexual abuse material to the National Center for Missing & Exploited Children (NCMEC) as required by 18 U.S.C. § 2258A. NCMEC forwards reports to law enforcement in the country where the offender is located. We do not notify the account holder before we report, and we do not need a court order, a complaint, or the offender\'s consent to do it.',
        '5.4 We escalate beyond the minimum. Where the conduct involves contact with, or targeting of, a specific child, we also report directly to the national law-enforcement authority or hotline in the offender\'s own jurisdiction through the INHOPE network, in addition to the NCMEC report. We respond to every subsequent law-enforcement request, subpoena, preservation order, and mutual legal assistance request without requiring the requesting authority to litigate for our cooperation.',
        '5.5 Reservation of civil and criminal remedies. ' + OPERATOR.legalName + ' expressly reserves every civil and criminal remedy available to it, in any competent jurisdiction, against any person who breaches this policy — including claims for breach of contract, for the cost of investigation and remediation, and for damage to the Service and to its users. We further reserve the right to assist any victim, guardian, or authority pursuing a claim against that person, including by providing evidence and testimony. Termination of an account is the beginning of that process, not the end of it.',
        '5.6 We do not shield offenders. We will not decline a lawful request to protect a user. We will not argue jurisdiction, cost, or inconvenience as a reason not to cooperate. We will not accept payment, pressure, or a threat of litigation in exchange for withholding a report, and any attempt to obtain one will itself be reported.',
      ],
    },
    {
      id: 'identity',
      title: '6. You Are Not Anonymous Here',
      body: [
        'People who do this assume the platform holds nothing that can identify them. On VERGR that assumption is wrong, and the record is unusually complete.',
        '6.1 What we hold. Depending on the account, this can include a verified telephone number; payment and payout records, including every destination address funds were sent to; IP addresses and approximate location captured at signup and during use; device identifiers; and the full content and timing of the activity in question.',
        '6.2 Verified identity. Where an account completed identity verification, a government-issued photo identity document and a liveness-checked selfie were captured by our verification provider and are retained by that provider. We hold the verification result and a derived identity signature. That signature is what lets us recognise and block the same person on a new account, and the underlying document is obtainable from the provider through lawful process.',
        '6.3 Deleting the account does not remove it. Where content or conduct is subject to a child-safety investigation, we preserve the relevant records notwithstanding any deletion request, account closure, or right-to-erasure request. Data-protection law provides for exactly this: the obligation to retain evidence of a crime overrides a deletion request.',
        '6.4 It leaves our hands. That record is what accompanies a NCMEC report and what is produced to law enforcement. Once it has been reported it is out of our control and no longer something we could withdraw even if we wanted to.',
        '6.5 Evasion is recorded too. Attempts to delete evidence, close the account, transfer a balance, or re-register after termination are themselves preserved and included in the report.',
      ],
    },
    {
      id: 'contact',
      title: '7. Child Safety Point of Contact',
      body: [
        `Our designated point of contact for child-safety matters, including questions about these standards and our CSAM prevention practices, is reachable at ${OPERATOR.supportEmail}.`,
        `Postal address: ${OPERATOR.legalName}, ${OPERATOR.registeredAddress}.`,
        'Law-enforcement requests and preservation requests should be sent to the same address and will be routed to the point of contact.',
      ],
    },
    {
      id: 'compliance',
      title: '8. Compliance with Child Safety Laws',
      body: [
        '8.1 We comply with applicable child-safety laws in the jurisdictions in which VERGR is available, including United States federal reporting obligations and, where applicable, the child-protection provisions of the EU Digital Services Act and the UK Online Safety Act.',
        '8.2 We block access to VERGR from jurisdictions where we cannot lawfully operate the service. The current list is published in our Terms of Service.',
        '8.3 These standards are reviewed at least annually and whenever we launch a feature that materially changes how users can contact one another or share media.',
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// Export bundle keyed by URL slug. The LegalScreen component picks one
// of these via its `type` prop.
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// Refund and Cancellation Policy — standalone page.
//
// This restates Section 9 of the Terms as a dedicated, linkable document.
// Payment providers expect a refund policy reachable from the footer and
// from checkout without reading the full Terms. Keep the two in sync: if
// you change a window or a rule here, change Section 9 as well.
// ─────────────────────────────────────────────────────────────────────
export const REFUND_POLICY = {
  label: 'Refund and Cancellation Policy',
  updated: `Last updated: ${LEGAL_UPDATED}`,
  version: LEGAL_VERSION,
  intro: [
    'This policy explains when a purchase on VERGR can be refunded, how to cancel a subscription, and how to contact us about a charge. It restates Section 9 of our Terms of Service as a standalone page.',
    `If anything below is unclear, or you believe you have been charged in error, write to ${OPERATOR.supportEmail} before contacting your bank. We answer refund enquiries within five (5) business days.`,
  ],
  sections: [
    {
      id: 'what-you-buy',
      title: '1. What you are buying',
      body: [
        'VERGR sells two things directly to members: Coins, and paid subscriptions (Lite and Pro).',
        'Coins are in-app currency. They are spendable only inside VERGR, on tips to creators, creator memberships, access to paid live streams, unlocking paid posts, and post boosts. Coins are not an investment, are not tradeable between members for money, and cannot be cashed out by the member who bought them.',
        'Creator earnings are a separate matter. Where VERGR pays a creator their revenue share, that is a payout, not a purchase, and this policy does not apply to it.',
      ],
    },
    {
      id: 'general-rule',
      title: '2. General rule',
      body: [
        'Coins are delivered to your Wallet immediately on purchase and are consumed inside the Service. For that reason, Coin purchases and subscription payments are not refundable once the Coins have been credited or the subscription period has begun, except where required by applicable consumer-protection law or as expressly stated in this policy.',
        'Coins that you have already spent cannot be refunded. Once a tip has been sent to a creator, a membership has been joined, or a paid stream or post has been unlocked, that Coin spend is final.',
      ],
    },
    {
      id: 'cooling-off',
      title: '3. EU and UK cooling-off',
      body: [
        'Where you are a consumer in the European Union, the European Economic Area, or the United Kingdom, you would ordinarily have a fourteen (14) day right of withdrawal under Directive 2011/83/EU or its UK equivalent.',
        'By completing a purchase of Coins or activating a subscription, you request that performance begin immediately, and you accept that your right of withdrawal is lost once the Coins are delivered or the subscription period begins. This waiver is presented to you at checkout as the legislation requires.',
      ],
    },
    {
      id: 'erroneous-charges',
      title: '4. Charges made in error',
      body: [
        `If you are charged in error — a duplicate charge, a charge credited to the wrong account, or a charge made by someone using your payment method without permission — request a refund within thirty (30) days of the charge by writing to ${OPERATOR.supportEmail}.`,
        'Tell us the date, the amount, and the last four digits of the payment method. We will investigate and, where the charge is confirmed as erroneous, refund it to the original payment method.',
      ],
    },
    {
      id: 'subscriptions',
      title: '5. Cancelling a subscription',
      body: [
        'You can cancel a paid subscription at any time from Settings, under Subscription. No email or support ticket is required.',
        'Cancellation takes effect at the end of the current billing period. You keep your subscription benefits until that date, and you are not billed again. Partial refunds are not issued for unused subscription time.',
        'Coins and VP already granted as part of a subscription month remain in your Wallet after cancellation.',
      ],
    },
    {
      id: 'we-cancel',
      title: '6. If we cancel something you paid for',
      body: [
        'If a paid live stream or ticketed event is cancelled before it starts, everyone who paid for access is refunded in full, in Coins, to their Wallet.',
        'If a creator membership is ended by the creator mid-period, the remainder of that period is refunded to the member in Coins.',
      ],
    },
    {
      id: 'processors',
      title: '7. Payment providers',
      body: [
        'Where a purchase is processed by a third-party payment provider, that provider\'s terms may also affect refund eligibility. We are not responsible for a decision made by the provider, but we will cooperate with any genuine refund request.',
      ],
    },
    {
      id: 'chargebacks',
      title: '8. Chargebacks',
      body: [
        'Please contact us before disputing a charge with your bank. Most disputes are a misunderstanding we can resolve quickly.',
        'A chargeback raised without contacting us first has consequences: the corresponding Coins are reversed, any amount already spent from those Coins is debited, the account may be suspended or terminated, and chargeback fees may be applied.',
      ],
    },
    {
      id: 'contact',
      title: '9. Contact',
      body: [
        `Refund and billing enquiries: ${OPERATOR.supportEmail}.`,
        `${OPERATOR.legalName}, ${OPERATOR.operatorPhrase}. ${OPERATOR.registeredAddress}.`,
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS = {
  terms:            TERMS_OF_SERVICE,
  refunds:          REFUND_POLICY,
  child_safety:     CHILD_SAFETY_STANDARDS,
  privacy:          PRIVACY_POLICY,
  acceptable_use:   ACCEPTABLE_USE_POLICY,
  cookies:          COOKIE_POLICY,
};
