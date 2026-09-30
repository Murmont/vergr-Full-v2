// Help articles for the Google PLAY build only (IS_PLAY_BUILD).
//
// The Play build sells Coins through Google Play Billing only: no card, no
// crypto, no custom amount (founder decision, 2026-09-11, until Vergr enrolls
// in Google's alternative-billing programs once the EIN arrives). The web
// articles below describe our own checkout, so inside the Play app they are
// either replaced with a Google Play version (PLAY_BODIES) or hidden
// (PLAY_HIDDEN). ./index.js applies this; web, desktop, sideload and Huawei
// are untouched.
//
// Rules for this file:
//   - Never point a Play user at another way to pay (the website, card, crypto).
//     Outside Google's programs that is steering, which Play does not allow.
//   - Never quote a price: Google Play sets it per market, in local currency.
//   - Never link to a slug in PLAY_HIDDEN.
//   - When a web article in PLAY_BODIES changes, check its Play twin here.
//
// Pure data, no imports, so the help prerender can load it in plain node.

export const PLAY_HIDDEN = [
  'can-i-buy-coins-with-a-card',
  'can-i-buy-coins-with-cryptocurrency',
  'why-can-i-not-pay-with-google-pay-or-apple-pay',
  // Describes card-issuer disputes and consequences wired to our own checkout.
  // A Google Play purchase is disputed with Google, not with a card issuer.
  'what-is-a-chargeback-and-what-happens-if-i-file-one',
];

const UPDATED = '2026-09-11';

export const PLAY_BODIES = {
  'how-do-i-buy-vc-coins': {
    summary: 'Open the Shop, pick a Coin pack and pay through Google Play. Your Coins land in your wallet as soon as Google Play confirms the payment.',
    updated: UPDATED,
    body: [
      { p: 'Buying Coins takes about a minute. You pick a pack, Google Play takes the payment, and the Coins show up in your wallet.' },
      { h2: 'How to buy' },
      {
        steps: [
          'Open the Shop from the wallet or the top of the app.',
          'Choose a Coin pack. It goes into your basket.',
          'Tap Buy with Google Play.',
          "Confirm in Google Play's purchase sheet. Your Coins appear once the payment is confirmed.",
        ],
      },
      { h2: 'Payment' },
      { p: "In the app, every purchase goes through Google Play and uses the payment methods on your Google Play account. Google Play shows the price in your currency before you confirm." },
      { h2: 'Packs' },
      { p: 'There are eight pack sizes, and the bigger packs give you more Coins for your money. The top two packs also include bonus VP.' },
      { note: 'Coins are for spending inside VERGR. They cannot be transferred or redeemed for money.' },
      {
        cta: [
          { to: '/platform/help/what-coin-packs-are-available-and-what-do-they-cost', label: 'All packs' },
          { to: '/platform/help/what-are-vc-coins', label: 'What are Coins?' },
        ],
      },
    ],
  },

  'what-payment-methods-can-i-use-to-buy-coins': {
    summary: 'In the Android app, Coins are paid for through Google Play, using the payment methods on your Google Play account.',
    updated: UPDATED,
    body: [
      { p: "Purchases in the app go through Google Play. Whatever payment methods your Google Play account has, such as a card or Google Play balance, are the ones you can use, and Google Play shows you the choices in its purchase sheet." },
      { h2: 'Adding or changing a payment method' },
      { p: 'Payment methods are managed in Google Play, not in VERGR. Open the Google Play Store, go to Payments and subscriptions, and add or update a method there. It is available for your next purchase straight away.' },
      { note: 'VERGR never sees or stores your card details. Google Play handles the payment.' },
      {
        cta: [
          { to: '/platform/help/how-do-i-buy-vc-coins', label: 'How to buy Coins' },
          { to: '/platform/help/my-payment-failed-what-do-i-do', label: 'If a payment fails' },
        ],
      },
    ],
  },

  'what-coin-packs-are-available-and-what-do-they-cost': {
    summary: 'There are eight Coin packs, from the 78-Coin Starter up to the 21,500-Coin Ascendant pack. Bigger packs give more Coins for your money, and the largest two include bonus VP. Google Play shows each price in your currency.',
    updated: UPDATED,
    body: [
      { h2: 'The packs' },
      {
        list: [
          'Starter, 78 Coins.',
          'Gamer, 400 Coins.',
          'Pro, 815 Coins.',
          'Elite, 1,650 Coins.',
          'Legend, 4,180 Coins.',
          'Champion, 8,450 Coins.',
          'Titan, 12,800 Coins plus 1,500 bonus VP.',
          'Ascendant, 21,500 Coins plus 3,000 bonus VP.',
        ],
      },
      { h2: 'Prices' },
      { p: 'Google Play sets the price of each pack in your currency, including any tax, and shows it on the pack and again before you confirm.' },
      { h2: 'Getting the best value' },
      { p: 'The bigger the pack, the more Coins you get for your money, and the top two packs add bonus VP, which ranks you up faster. VP never changes what a creator is paid.' },
      {
        cta: [
          { to: '/platform/help/which-coin-pack-is-the-best-value', label: 'Best value pack' },
          { to: '/platform/help/how-do-i-buy-vc-coins', label: 'How to buy' },
        ],
      },
    ],
  },

  'what-is-the-minimum-amount-of-coins-i-can-buy': {
    summary: 'The Starter Pack, 78 Coins, is the smallest purchase in the app.',
    updated: UPDATED,
    body: [
      { p: 'Coins come in eight packs, and the Starter Pack is the smallest. Google Play shows its price in your currency.' },
      { h2: 'Is 78 Coins enough to do anything?' },
      { p: 'Yes. Tips start small, and a Starter Pack is enough to tip a streamer several times. When you know you will stick around, the larger packs give you more Coins for your money.' },
      { note: 'Coins never expire, so there is no pressure to size a purchase around a deadline.' },
      {
        cta: [
          { to: '/platform/help/what-coin-packs-are-available-and-what-do-they-cost', label: 'All packs' },
        ],
      },
    ],
  },

  'is-there-a-custom-coin-amount': {
    summary: 'Not in the Android app. Coins come in eight packs sold through Google Play.',
    updated: UPDATED,
    body: [
      { p: 'Google Play sells fixed packs, so the app offers the eight Coin packs and no custom amount. Pick the pack closest to what you need: Coins never expire, so anything left over simply carries on to your next tip or pass.' },
      {
        cta: [
          { to: '/platform/help/what-coin-packs-are-available-and-what-do-they-cost', label: 'All packs' },
          { to: '/platform/help/which-coin-pack-is-the-best-value', label: 'Best value pack' },
        ],
      },
    ],
  },

  'is-buying-coins-secure': {
    summary: "Yes. Google Play takes the payment, so VERGR never sees your card details, and VERGR's server confirms every purchase with Google before crediting any Coins.",
    updated: UPDATED,
    body: [
      { h2: 'How the payment is protected' },
      {
        list: [
          "You pay in Google Play's own purchase sheet. Your card details stay with Google.",
          'Before any Coins are credited, VERGR checks the purchase with Google, and each purchase can only ever be credited once.',
          'Every purchase appears in your wallet history, and Google Play keeps a receipt in your order history.',
        ],
      },
      { h2: 'Protecting your account' },
      {
        list: [
          'Your wallet can be locked behind a PIN and two-factor authentication in Wallet Security settings.',
          'If you see a charge you do not recognise, contact support@vergr.app and Google Play.',
        ],
      },
      { note: 'Only ever buy Coins inside the app. Nobody from VERGR will ever ask you to pay through a link in a DM.' },
      {
        cta: [
          { to: '/platform/help/what-payment-methods-can-i-use-to-buy-coins', label: 'Payment methods' },
          { to: '/platform/help/my-payment-failed-what-do-i-do', label: 'If a payment fails' },
        ],
      },
    ],
  },

  'my-payment-failed-what-do-i-do': {
    summary: 'A failed Google Play purchase does not charge you. Check the payment method on your Google Play account, then try again. If it keeps failing, add or switch a method in Google Play.',
    updated: UPDATED,
    body: [
      { h2: 'What to check' },
      {
        list: [
          'The payment method on your Google Play account is valid, not expired, and has enough funds.',
          'Your bank has not blocked the payment. A quick approve in your banking app often fixes it.',
          'You are signed in to the Google account you normally pay with.',
        ],
      },
      { h2: 'What to do' },
      {
        steps: [
          'Open the Google Play Store, go to Payments and subscriptions, and check your payment methods.',
          'Try the purchase again.',
          'Still failing? Add or choose a different payment method in Google Play, then retry.',
          'If nothing works, contact support@vergr.app with the time of the attempt. Google Play Help can also explain why a payment was declined.',
        ],
      },
      { note: 'If Google Play DID charge you but no Coins arrived, see the article linked below.' },
      {
        cta: [
          { to: '/platform/help/i-paid-but-my-coins-did-not-arrive-what-do-i-do', label: 'Paid but no Coins?' },
        ],
      },
    ],
  },

  'i-paid-but-my-coins-did-not-arrive-what-do-i-do': {
    summary: 'Close and reopen the app while signed in: it re-checks every purchase Google Play still holds for you and credits it. If a confirmed charge still has no Coins after that, contact support@vergr.app.',
    updated: UPDATED,
    body: [
      { p: 'Coins normally land within seconds of Google Play confirming the payment. If the confirmation reaches VERGR late, the purchase is not lost: Google Play keeps it on your account until VERGR has credited it.' },
      { h2: 'What to do, in order' },
      {
        steps: [
          'Close the app completely and open it again, signed in to the same VERGR account. The app re-checks outstanding Google Play purchases and credits them.',
          'Check your wallet history. If the purchase shows there, the Coins are in.',
          'Check your Google Play order history to confirm the charge went through.',
          'Still nothing? Email support@vergr.app with the date, the pack, and the Google Play order number (it starts with GPA). Confirmed purchases are always credited.',
        ],
      },
      {
        cta: [
          { to: '/platform/help/is-buying-coins-secure', label: 'How purchases are protected' },
        ],
      },
    ],
  },

  'can-i-get-a-refund-on-a-coin-purchase': {
    summary: "Purchases in the Android app are made through Google Play, so refund requests go to Google Play. Coins are delivered instantly, and a refunded purchase removes its Coins from your wallet.",
    updated: UPDATED,
    body: [
      { h2: 'How to ask for a refund' },
      { p: "Google Play handles payment for purchases made in the app, including refunds. Open your Google Play order history, find the purchase, and use Google Play's refund request. You can also email support@vergr.app and we will help." },
      { h2: 'Charged in error?' },
      {
        list: [
          'Charged twice for one purchase.',
          'Coins credited to the wrong account.',
          'A purchase you did not make.',
        ],
      },
      { p: 'For any of those, contact Google Play and email support@vergr.app with the date and the Google Play order number.' },
      { h2: 'Bought the wrong pack?' },
      { p: 'Nothing is lost: Coins do not expire, and everything on VERGR that costs Coins draws from the same balance, so an over-purchase simply lasts longer.' },
      {
        cta: [
          { to: '/platform/help/i-paid-but-my-coins-did-not-arrive-what-do-i-do', label: 'Coins did not arrive?' },
        ],
      },
    ],
  },

  'what-are-vc-coins': {
    summary: 'VC Coins are the in-app currency on VERGR. You use them to tip creators, buy access to paid streams, join memberships, and boost your reach.',
    updated: UPDATED,
    body: [
      { p: 'VC, or Coins, are the currency that powers what you do inside VERGR.' },
      { h2: 'What you can do with Coins' },
      {
        list: [
          'Tip a creator on a stream, a post, or their profile.',
          'Buy a pass to a paid live stream.',
          'Join a creator membership or a squad.',
          'Boost a stream or a post for more reach.',
        ],
      },
      { h2: 'How you get Coins' },
      {
        list: [
          'Buy them in the Shop through Google Play.',
          'Get tipped while you stream or post.',
        ],
      },
      { h2: 'Are Coins real money?' },
      { p: 'Coins are an in-app credit, not cash, and they cannot be redeemed for money. Earning is separate: when people pay for your content, Vergr pays you a share of that revenue.' },
      {
        cta: [
          { to: '/platform/help/how-do-i-buy-vc-coins', label: 'How to buy Coins' },
          { to: '/platform/help/how-do-coins-and-vp-work-together', label: 'How Coins and VP work' },
        ],
      },
    ],
  },

  'my-payment-will-not-go-through-what-do-i-do': {
    summary: 'In the Android app, payments go through Google Play. Check the payment method on your Google Play account, approve the payment if your bank asks, and try again. A failed Google Play purchase does not charge you.',
    updated: UPDATED,
    body: [
      { h2: 'Quick fixes' },
      {
        steps: [
          'Open the Google Play Store, go to Payments and subscriptions, and make sure your payment method is valid and up to date.',
          'Check your banking app for a declined or blocked payment and approve it.',
          'Try the purchase again, or add a different payment method in Google Play and retry.',
        ],
      },
      { h2: 'Still stuck?' },
      { p: 'Contact support@vergr.app with the time of the attempt. Google Play Help can also tell you why a payment was declined.' },
      {
        cta: [
          { to: '/platform/help/my-payment-failed-what-do-i-do', label: 'Failed payments in detail' },
          { to: '/platform/help/i-paid-but-my-coins-did-not-arrive-what-do-i-do', label: 'Paid but no Coins' },
        ],
      },
    ],
  },
};
