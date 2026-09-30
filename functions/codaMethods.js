// Codapay payment methods Vergr offers, per country, with Coda's fee for each.
//
// Sources, both read 2026-09-25:
//   fees   Coda Portal -> Payment methods -> Export table as CSV (Integration type
//          Codapay, status PENDING). docs/processors/coda-payment-method-fees.md
//   ids    docs.coda.co/codapay/references/supported-payment-channels (payType)
//
// A method is listed here ONLY when both its fee and its Coda channel id are known.
// Anything we could not match (e.g. India UPI / cards, Kuwait cards, Toss Pay,
// PayPal Canada / Switzerland / Hungary) is left out rather than offered on a
// guessed fee or id. HK WeChat Pay is Coda "Gaming Only" and is left out.
//
// Row: [ISO country, payType, name, kind, fee %, tax % Coda deducts, fixed fee in local currency]
// kind: 'card' uses Coda's card component; everything else uses the hosted component.
//
// ⚠ PRICES ARE DERIVED FROM THESE FEES (codaPricing.js), so a wrong fee here is a
// wrong price. Update from a fresh portal export, never by hand-guessing.

const ROWS = [
  ['AR', 424, 'Card', 'card', 8.6, 0, 335],
  ['AU', 442, 'Card', 'card', 4.4, 10, 0.37], ['AU', 897, 'Google Pay / Apple Pay', 'wallet', 4.4, 10, 0.37], ['AU', 771, 'PayPal', 'wallet', 4.7, 0, 0.37],
  ['AT', 473, 'Card', 'card', 2.6, 20, 0.23], ['AT', 868, 'Google Pay / Apple Pay', 'wallet', 2.6, 20, 0.23], ['AT', 904, 'EPS', 'bank', 3.3, 20, 0.33],
  ['BD', 63, 'Robi', 'carrier', 29, 0, 0],
  ['BE', 455, 'Card', 'card', 2.6, 21, 0.23], ['BE', 871, 'Google Pay / Apple Pay', 'wallet', 2.6, 21, 0.23], ['BE', 784, 'PayPal', 'wallet', 3.1, 21, 0.23], ['BE', 905, 'Bancontact', 'wallet', 4.4, 21, 0.12],
  ['BO', 472, 'Card', 'card', 7.25, 0, 1.8],
  ['BR', 516, 'Pix', 'bank', 6.2, 0, 0.34], ['BR', 422, 'Card', 'card', 7.7, 0, 0.5], ['BR', 508, 'PicPay', 'wallet', 8.0, 0, 0], ['BR', 510, 'PayPal', 'wallet', 8.2, 0, 1.3], ['BR', 500, 'Boleto', 'cash', 9.5, 0, 1.6],
  ['KH', 419, 'Card', 'card', 5.45, 10, 0.25], ['KH', 454, 'Bakong (KHQR)', 'wallet', 3.2, 10, 0], ['KH', 451, 'Pi Pay', 'wallet', 3.5, 10, 0], ['KH', 450, 'Wing', 'wallet', 5.0, 10, 0], ['KH', 452, 'Paygo', 'wallet', 5.85, 10, 0],
  ['CA', 430, 'Card', 'card', 3.45, 0, 0.36], ['CA', 866, 'Google Pay / Apple Pay', 'wallet', 3.45, 0, 0.36],
  ['CL', 435, 'Card', 'card', 7.35, 0, 235], ['CL', 785, 'PayPal', 'wallet', 6.7, 0, 235],
  ['CO', 436, 'Card', 'card', 8.65, 19, 940], ['CO', 528, 'Nequi', 'wallet', 8.5, 19, 0], ['CO', 527, 'DaviPlata', 'wallet', 8.9, 19, 0], ['CO', 511, 'Bank transfer', 'bank', 9.0, 19, 0],
  ['CZ', 446, 'Card', 'card', 2.6, 21, 5.40], ['CZ', 872, 'Google Pay / Apple Pay', 'wallet', 2.6, 21, 5.40], ['CZ', 798, 'PayPal', 'wallet', 3.1, 21, 5.40],
  ['DK', 459, 'Card', 'card', 2.6, 25, 1.65], ['DK', 873, 'Google Pay / Apple Pay', 'wallet', 2.6, 25, 1.65], ['DK', 794, 'PayPal', 'wallet', 3.1, 25, 1.65], ['DK', 908, 'MobilePay', 'wallet', 4.0, 25, 1.95],
  ['EC', 438, 'Card', 'card', 7.65, 0, 0.25], ['EC', 854, 'PayPal', 'wallet', 6.7, 0, 0.25],
  ['EG', 417, 'Card', 'card', 5.8, 0, 6.45], ['EG', 338, 'Vodafone Cash', 'wallet', 5.75, 0, 0], ['EG', 339, 'Orange Money', 'wallet', 5.75, 0, 0], ['EG', 766, 'PayPal', 'wallet', 6.7, 0, 13.0], ['EG', 337, 'Fawry', 'cash', 7.75, 0, 0], ['EG', 751, 'Masary / Aman / Momken', 'cash', 8.3, 0, 3.95],
  ['FI', 463, 'Card', 'card', 2.6, 25.5, 0.23], ['FI', 796, 'PayPal', 'wallet', 3.1, 25.5, 0.23],
  ['FR', 1002, 'Card', 'card', 2.6, 20, 0.23], ['FR', 859, 'Google Pay / Apple Pay', 'wallet', 2.6, 20, 0.23], ['FR', 754, 'PayPal', 'wallet', 3.1, 20, 0.23],
  ['DE', 1007, 'Card', 'card', 2.6, 19, 0.23], ['DE', 874, 'Google Pay / Apple Pay', 'wallet', 2.6, 19, 0.23], ['DE', 762, 'PayPal', 'wallet', 3.6, 19, 0.23],
  ['GR', 456, 'Card', 'card', 2.6, 24, 0.23], ['GR', 790, 'PayPal', 'wallet', 3.1, 24, 0.23],
  ['GT', 856, 'PayPal', 'wallet', 6.7, 0, 2.0],
  ['HK', 431, 'Card', 'card', 5.1, 0, 2.05], ['HK', 861, 'Google Pay / Apple Pay', 'wallet', 5.1, 0, 2.05], ['HK', 313, 'FPS', 'bank', 2.3, 0, 0], ['HK', 311, 'Alipay HK', 'wallet', 4.6, 0, 0], ['HK', 777, 'PayPal', 'wallet', 4.7, 0, 2.05],
  ['HU', 444, 'Card', 'card', 2.6, 27, 81], ['HU', 875, 'Google Pay / Apple Pay', 'wallet', 2.6, 27, 81],
  ['ID', 400, 'Card', 'card', 5.55, 11, 4450], ['ID', 906, 'QRIS', 'bank', 2.65, 11, 0], ['ID', 240, 'DANA', 'wallet', 3.0, 11, 0], ['ID', 233, 'ShopeePay', 'wallet', 3.35, 11, 0], ['ID', 234, 'LinkAja', 'wallet', 3.35, 11, 0], ['ID', 223, 'DOKU Wallet', 'wallet', 3.4, 11, 0], ['ID', 230, 'OVO', 'wallet', 3.5, 11, 0], ['ID', 227, 'GoPay', 'wallet', 6.5, 11, 0], ['ID', 769, 'PayPal', 'wallet', 4.7, 11, 4450], ['ID', 220, 'Bank transfer', 'bank', 1.0, 11, 4100], ['ID', 221, 'Alfamart', 'cash', 7.65, 11, 0], ['ID', 226, 'Indomaret', 'cash', 9.95, 11, 0], ['ID', 23, 'XL', 'carrier', 22.0, 25.15, 0], ['ID', 22, 'Indosat', 'carrier', 28.85, 11, 0], ['ID', 26, 'Tri', 'carrier', 28.85, 11, 0], ['ID', 24, 'Telkomsel', 'carrier', 32.0, 11, 0],
  ['IE', 464, 'Card', 'card', 2.6, 23, 0.23], ['IE', 799, 'PayPal', 'wallet', 3.1, 23, 0.23],
  ['IT', 1001, 'Card', 'card', 2.6, 22, 0.23], ['IT', 876, 'Google Pay / Apple Pay', 'wallet', 2.6, 22, 0.23], ['IT', 755, 'PayPal', 'wallet', 3.1, 22, 0.23],
  ['JP', 407, 'Card', 'card', 4.8, 10, 39], ['JP', 911, 'Google Pay / Apple Pay', 'wallet', 4.8, 10, 39], ['JP', 767, 'PayPal', 'wallet', 4.7, 0, 39], ['JP', 371, 'PayPay', 'wallet', 8.2, 10, 0],
  ['KZ', 441, 'Card', 'card', 7.75, 0, 140],
  ['KR', 408, 'Card', 'card', 4.6, 10, 155], ['KR', 690, 'KakaoPay', 'wallet', 4.7, 10, 0], ['KR', 693, 'Naver Pay', 'wallet', 4.7, 10, 0], ['KR', 694, 'Payco', 'wallet', 4.7, 10, 0], ['KR', 696, 'T-Money', 'wallet', 9.8, 10, 0], ['KR', 175, 'Phone bill', 'carrier', 12.4, 10, 0], ['KR', 695, 'Culture Voucher', 'voucher', 13.0, 10, 0],
  ['LA', 420, 'Card', 'card', 8.05, 0, 5800], ['LA', 132, 'Lao Telecom', 'carrier', 24.0, 10, 0],
  ['MY', 421, 'Card', 'card', 5.0, 8, 1.10], ['MY', 862, 'Google Pay / Apple Pay', 'wallet', 5.0, 8, 1.10], ['MY', 242, 'MAE / DuitNow', 'bank', 2.5, 8, 0], ['MY', 241, 'ShopeePay', 'wallet', 2.7, 8, 0], ['MY', 236, 'GrabPay', 'wallet', 3.5, 8, 0], ['MY', 238, 'Boost', 'wallet', 3.5, 8, 0], ['MY', 237, "Touch 'n Go", 'wallet', 4.0, 8, 0], ['MY', 53, 'U Mobile', 'carrier', 28.0, 8, 0], ['MY', 51, 'Digi', 'carrier', 29.0, 8, 0], ['MY', 52, 'Celcom', 'carrier', 29.0, 8, 0],
  ['MX', 423, 'Card', 'card', 5.3, 0, 4.50], ['MX', 870, 'Google Pay / Apple Pay', 'wallet', 5.3, 0, 4.50], ['MX', 764, 'PayPal', 'wallet', 4.7, 0, 4.50], ['MX', 524, 'Mercado Pago', 'wallet', 5.3, 0, 0], ['MX', 503, 'Bank transfer', 'bank', 2.2, 0, 1.85], ['MX', 523, 'OXXO', 'cash', 8.4, 0, 0], ['MX', 509, 'Paysafecard', 'voucher', 13.75, 0, 0],
  ['MN', 650, 'MonPay', 'wallet', 9.5, 10, 0], ['MN', 649, 'Toki', 'wallet', 21.0, 10, 0], ['MN', 190, 'Unitel', 'carrier', 34.7, 10, 0],
  ['MA', 426, 'Card', 'card', 5.4, 0, 2.40],
  ['MM', 411, 'Card', 'card', 6.75, 0, 1100], ['MM', 380, 'WavePay', 'wallet', 11.5, 0, 0], ['MM', 101, 'ATOM', 'carrier', 38.5, 5, 0],
  ['NL', 1003, 'Card', 'card', 2.6, 21, 0.23], ['NL', 901, 'iDEAL', 'bank', 1.0, 21, 0.48], ['NL', 877, 'Google Pay / Apple Pay', 'wallet', 2.6, 21, 0.23], ['NL', 756, 'PayPal', 'wallet', 3.6, 21, 0.23],
  ['NZ', 443, 'Card', 'card', 5.0, 0, 0.45], ['NZ', 883, 'Google Pay / Apple Pay', 'wallet', 5.0, 0, 0.45], ['NZ', 795, 'PayPal', 'wallet', 4.7, 0, 0.45],
  ['NG', 433, 'Card', 'card', 7.25, 0, 365], ['NG', 603, 'Verve card', 'card', 4.9, 0, 0], ['NG', 600, 'Bank transfer', 'bank', 5.1, 0, 0], ['NG', 922, 'OPay', 'wallet', 5.4, 0, 0], ['NG', 920, 'Paga', 'wallet', 5.65, 0, 0],
  ['NO', 458, 'Card', 'card', 2.6, 25, 2.5], ['NO', 878, 'Google Pay / Apple Pay', 'wallet', 2.6, 25, 2.5], ['NO', 793, 'PayPal', 'wallet', 3.1, 25, 2.5], ['NO', 909, 'Vipps', 'wallet', 4.0, 25, 2.35],
  ['PK', 1009, 'Card', 'card', 7.25, 0, 74], ['PK', 394, 'Easypaisa', 'wallet', 7.5, 0, 0], ['PK', 395, 'JazzCash', 'wallet', 7.5, 0, 0],
  ['PY', 440, 'Card', 'card', 7.75, 0, 1950],
  ['PE', 437, 'Card', 'card', 5.2, 0, 0.95], ['PE', 789, 'PayPal', 'wallet', 4.7, 0, 0.95],
  ['PH', 410, 'Card', 'card', 5.4, 12, 15], ['PH', 864, 'Google Pay / Apple Pay', 'wallet', 5.4, 12, 15], ['PH', 252, 'GCash', 'wallet', 3.55, 12, 0], ['PH', 257, 'Maya', 'wallet', 3.55, 12, 0], ['PH', 255, 'GrabPay', 'wallet', 3.65, 12, 0], ['PH', 258, 'Coins.ph', 'wallet', 1.0, 12, 6.50], ['PH', 250, 'Bank transfer', 'bank', 1.0, 12, 15], ['PH', 251, 'Cash at retail', 'cash', 3.0, 12, 19], ['PH', 253, '7-Eleven', 'cash', 6.5, 12, 19], ['PH', 92, 'DITO', 'carrier', 16.0, 12, 0], ['PH', 91, 'Smart', 'carrier', 29.0, 12, 0],
  ['PL', 1005, 'Card', 'card', 2.6, 23, 0.95], ['PL', 903, 'BLIK', 'bank', 3.5, 23, 0.50], ['PL', 879, 'Google Pay / Apple Pay', 'wallet', 2.6, 23, 0.95], ['PL', 758, 'PayPal', 'wallet', 3.6, 23, 0.95],
  ['PT', 457, 'Card', 'card', 2.6, 23, 0.23], ['PT', 880, 'Google Pay / Apple Pay', 'wallet', 2.6, 23, 0.23], ['PT', 792, 'PayPal', 'wallet', 3.1, 23, 0.23], ['PT', 910, 'Multibanco', 'cash', 5.95, 23, 0.33],
  ['QA', 439, 'Card', 'card', 5.15, 0, 0.95], ['QA', 855, 'PayPal', 'wallet', 4.7, 0, 0.95],
  ['RO', 445, 'Card', 'card', 2.6, 21, 1.15], ['RO', 881, 'Google Pay / Apple Pay', 'wallet', 2.6, 21, 1.15],
  ['SA', 412, 'Card', 'card', 5.25, 15, 1], ['SA', 730, 'mada', 'card', 5.25, 15, 1], ['SA', 731, 'Apple Pay', 'wallet', 3.0, 15, 0], ['SA', 702, 'STC Pay', 'wallet', 3.05, 15, 0],
  ['SG', 427, 'Card', 'card', 3.7, 9, 0.33], ['SG', 263, 'PayNow', 'bank', 2.2, 9, 0], ['SG', 260, 'GrabPay', 'wallet', 4.5, 9, 0], ['SG', 264, 'PayPal', 'wallet', 4.2, 9, 0.33],
  ['SK', 471, 'Card', 'card', 2.6, 23, 0.23], ['SK', 857, 'PayPal', 'wallet', 3.1, 23, 0.23],
  ['ZA', 432, 'Card', 'card', 5.45, 0, 4.30],
  ['ES', 1000, 'Card', 'card', 2.6, 21, 0.23], ['ES', 882, 'Google Pay / Apple Pay', 'wallet', 2.6, 21, 0.23], ['ES', 759, 'PayPal', 'wallet', 3.1, 21, 0.23],
  ['LK', 414, 'Card', 'card', 7.95, 0, 82],
  ['SE', 449, 'Card', 'card', 3.0, 25, 2.5], ['SE', 869, 'Google Pay / Apple Pay', 'wallet', 3.0, 25, 2.5], ['SE', 782, 'PayPal', 'wallet', 3.1, 25, 2.5],
  ['CH', 448, 'Card', 'card', 3.6, 8.1, 0.21], ['CH', 867, 'Google Pay / Apple Pay', 'wallet', 3.6, 8.1, 0.21], ['CH', 902, 'TWINT', 'wallet', 4.3, 8.1, 0.11],
  ['TW', 428, 'Card', 'card', 5.15, 5, 8.20], ['TW', 301, 'LINE Pay', 'wallet', 4.2, 5, 0], ['TW', 302, 'JKO Pay', 'wallet', 8.0, 5, 0], ['TW', 81, 'FarEasTone', 'carrier', 18.7, 5, 0], ['TW', 82, 'Chunghwa Telecom', 'carrier', 18.7, 5, 0], ['TW', 303, 'GASH e-wallet', 'wallet', 18.8, 5, 0], ['TW', 300, 'GASH gift card', 'voucher', 20.8, 5, 0],
  ['TH', 413, 'Card', 'card', 4.75, 7, 3.30], ['TH', 349, 'PromptPay', 'bank', 2.4, 7, 0], ['TH', 348, 'K PLUS', 'bank', 3.0, 7, 0], ['TH', 331, 'Bank transfer / cash', 'bank', 4.0, 7, 0], ['TH', 346, 'ShopeePay', 'wallet', 5.25, 7, 0], ['TH', 342, 'TrueMoney', 'wallet', 7.5, 7, 0], ['TH', 344, '7-Eleven', 'cash', 7.5, 7, 0], ['TH', 773, 'PayPal', 'wallet', 4.7, 7, 8.30], ['TH', 332, 'Rabbit LINE Pay', 'wallet', 10.6, 7, 0], ['TH', 340, 'TrueMoney cash card', 'voucher', 20.05, 7, 0], ['TH', 347, 'One-2-Call cash card', 'voucher', 24.0, 7, 0], ['TH', 71, 'AIS', 'carrier', 29.5, 7, 0], ['TH', 70, 'dtac', 'carrier', 30.75, 7, 0], ['TH', 73, 'TrueMove H', 'carrier', 34.0, 0, 0],
  ['TR', 425, 'Card', 'card', 3.65, 20, 12],
  ['AE', 418, 'Card', 'card', 5.55, 5, 0.95], ['AE', 783, 'PayPal', 'wallet', 4.7, 0, 0.95],
  ['GB', 1004, 'Card', 'card', 3.5, 20, 0.20], ['GB', 865, 'Google Pay / Apple Pay', 'wallet', 3.5, 20, 0.20], ['GB', 760, 'PayPal', 'wallet', 4.4, 20, 0.20],
  ['US', 1006, 'Card', 'card', 4.0, 0, 0.25], ['US', 898, 'Google Pay / Apple Pay', 'wallet', 4.0, 0, 0.25], ['US', 780, 'PayPal / Venmo', 'wallet', 4.1, 0, 0.25], ['US', 899, 'Cash App', 'wallet', 4.75, 0, 0.28],
  ['UY', 434, 'Card', 'card', 7.35, 0, 11],
  ['VN', 416, 'Card', 'card', 6.1, 0, 6750], ['VN', 776, 'PayPal', 'wallet', 4.7, 0, 6750], ['VN', 352, 'VTCPay', 'wallet', 17.7, 0, 0], ['VN', 351, 'MoMo', 'wallet', 22.0, 0, 4800],
];

/** Coda's currency per country (read off Coda's own generated prices, 2026-09-25). */
const COUNTRY_CURRENCY = {
  AR: 'ARS', AU: 'AUD', AT: 'EUR', BD: 'BDT', BE: 'EUR', BO: 'BOB', BR: 'BRL', KH: 'USD', CA: 'CAD', CL: 'CLP',
  CO: 'COP', CZ: 'CZK', DK: 'DKK', EC: 'USD', EG: 'EGP', FI: 'EUR', FR: 'EUR', DE: 'EUR', GR: 'EUR', GT: 'GTQ',
  HK: 'HKD', HU: 'HUF', ID: 'IDR', IE: 'EUR', IT: 'EUR', JP: 'JPY', KZ: 'KZT', KR: 'KRW', LA: 'LAK', MY: 'MYR',
  MX: 'MXN', MN: 'MNT', MA: 'MAD', MM: 'MMK', NL: 'EUR', NZ: 'NZD', NG: 'NGN', NO: 'NOK', PK: 'PKR', PY: 'PYG',
  PE: 'PEN', PH: 'PHP', PL: 'PLN', PT: 'EUR', QA: 'QAR', RO: 'RON', SA: 'SAR', SG: 'SGD', SK: 'EUR', ZA: 'ZAR',
  ES: 'EUR', LK: 'LKR', SE: 'SEK', CH: 'CHF', TW: 'TWD', TH: 'THB', TR: 'TRY', AE: 'AED', GB: 'GBP', US: 'USD',
  UY: 'UYU', VN: 'VND',
};

/** ISO 4217 numeric codes Coda's init request takes. */
const CURRENCY_NUMERIC = {
  ARS: 32, AUD: 36, EUR: 978, BDT: 50, BOB: 68, BRL: 986, USD: 840, CAD: 124, CLP: 152, COP: 170, CZK: 203,
  DKK: 208, EGP: 818, GTQ: 320, HKD: 344, HUF: 348, IDR: 360, JPY: 392, KZT: 398, KRW: 410, LAK: 418, MYR: 458,
  MXN: 484, MNT: 496, MAD: 504, MMK: 104, NZD: 554, NGN: 566, NOK: 578, PKR: 586, PYG: 600, PEN: 604, PHP: 608,
  PLN: 985, QAR: 634, RON: 946, SAR: 682, SGD: 702, ZAR: 710, LKR: 144, SEK: 752, CHF: 756, TWD: 901, THB: 764,
  TRY: 949, AED: 784, GBP: 826, UYU: 858, VND: 704,
};

/** Currencies with no practical minor unit (one unit is under a US cent): whole numbers only. */
const WHOLE_CURRENCIES = new Set(['JPY', 'KRW', 'CLP', 'VND', 'PYG', 'IDR', 'HUF', 'MMK', 'LAK', 'MNT', 'KZT',
  'COP', 'ARS', 'NGN', 'LKR', 'PKR', 'BDT']);

const METHODS = ROWS.map(([country, payType, name, kind, feePct, taxPct, fixed]) => ({
  country, payType, name, kind, fee: feePct / 100, tax: taxPct / 100, fixed,
}));

function methodsFor(country) {
  const cc = String(country || '').toUpperCase();
  return METHODS.filter((m) => m.country === cc);
}

function methodFor(country, payType) {
  return methodsFor(country).find((m) => m.payType === Number(payType)) || null;
}

module.exports = { METHODS, COUNTRY_CURRENCY, CURRENCY_NUMERIC, WHOLE_CURRENCIES, methodsFor, methodFor };
