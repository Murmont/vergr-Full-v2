# Play Console — Lite & Pro subscription setup

Work top to bottom. Prices come from `docs/play/play-prices-by-market.csv`
(columns `sub_lite` / `sub_pro`), which is the source of truth: each figure is
grossed up for that market's VAT **and** Google's 15% service fee so the net
matches the web sale. Do not recompute them.

---

## 0. Prerequisites

Products will not work until all three are true:

- **Payments profile** set up (Setup → Payments profile).
- **An AAB uploaded to at least Internal testing.** Play returns no products for
  an app with no release on any track. This is the most common cause of
  "item unavailable".
- **The AAB is the store build**: `npm run android:build:store`. The billing
  bridge is only compiled into that build. A sideload APK reports `unsupported`
  and silently falls back to PayRam.

---

## 1. Create the Lite subscription

**Monetize → Products → Subscriptions → Create subscription**

| Field | Value |
|---|---|
| Product ID | `sub_lite` |
| Name | `Vergr Lite` |

> The product ID is permanent. It can never be edited or reused, even after
> deletion. It must be exactly `sub_lite` — `functions/playBilling.js:67` maps
> that string to the tier and `nativeBilling.js:156` builds it as `sub_${tier}`.

**Benefits** — add four:

```
No ads
Go live from day one at 720p
1.5x VP + monthly VP and coins
1GB uploads, scheduled posts
```

**Description** (internal only, never shown to users):

```
Removes ads and the streaming follower gate, raises quality to 720p, 1GB
uploads, scheduled posts and DMs, chat auto-translate, and Creator Studio
analytics.
```

| Field | Value |
|---|---|
| Product tax category | `Digital app sales` (default) |
| Compliance settings | `Service` |
| Age rating | Same rating the app carries. Never lower. |
| Payment location restriction | `No country / region restricted` |

Save.

---

## 2. Create the Pro subscription

Same page, same process.

| Field | Value |
|---|---|
| Product ID | `sub_pro` |
| Name | `Vergr Pro` |

**Benefits:**

```
Broadcast in 1080p
90-day replays of your streams
2x VP + monthly VP and coins
5GB uploads, 4K photos
```

**Description:**

```
Everything in Lite plus 1080p streaming, past broadcasts saved as 90-day
replays, 5GB uploads with 4K photos, the full vergr.me design kit with lead
capture, and advanced analytics.
```

Tax category, compliance, age rating and payment location: identical to Lite.

Save.

---

## 3. Base plan (do this for each product)

**Add base plan**

| Field | Value |
|---|---|
| Base plan ID | `monthly` (permanent, like the product ID) |
| Type | Auto-renewing |
| Billing period | Monthly |
| Grace period | 7 days |
| Free trial | None |

Then set prices (section 4), then **Activate the base plan**.

> A saved-but-inactive base plan is invisible to the app. This is the second
> most common setup failure after "no release on any track".

---

## 4. Prices per market

In the base plan, choose **Set price per country/region** and enter these
literally. One row per country, Lite and Pro side by side.

**Do not let Play auto-convert these 40.** Auto-conversion works off USD FX and
ignores VAT, which is precisely how the 25%+ VAT markets lose money.

| Country | Currency | Lite | Pro |
|---|---|---|---|
| Australia | AUD | 9.89 | 18.99 |
| Austria | EUR | 6.99 | 12.99 |
| Belgium | EUR | 6.99 | 12.99 |
| Bulgaria | BGN | 13.99 | 25.99 |
| Croatia | EUR | 6.99 | 12.99 |
| Cyprus | EUR | 6.09 | 12.99 |
| Czechia | CZK | 169.99 | 319.99 |
| Denmark | DKK | 51.99 | 96.99 |
| Estonia | EUR | 6.99 | 12.99 |
| Finland | EUR | 6.99 | 12.99 |
| France | EUR | 6.99 | 12.99 |
| Germany | EUR | 6.09 | 12.99 |
| Greece | EUR | 6.99 | 12.99 |
| Hungary | HUF | 2600 | 4800 |
| India | INR | 669.99 | 1399.99 |
| Ireland | EUR | 6.99 | 12.99 |
| Italy | EUR | 6.99 | 12.99 |
| Japan | JPY | 1200 | 2100 |
| Latvia | EUR | 6.99 | 12.99 |
| Lithuania | EUR | 6.99 | 12.99 |
| Luxembourg | EUR | 6.09 | 12.99 |
| Malta | EUR | 6.09 | 12.99 |
| Mexico | MXN | 119.99 | 239.99 |
| Netherlands | EUR | 6.99 | 12.99 |
| New Zealand | NZD | 11.99 | 23.99 |
| Norway | NOK | 75.99 | 149.99 |
| Poland | PLN | 29.99 | 55.99 |
| Portugal | EUR | 6.99 | 12.99 |
| Romania | RON | 36.99 | 68.99 |
| Singapore | SGD | 8.99 | 16.99 |
| Slovakia | EUR | 6.99 | 12.99 |
| Slovenia | EUR | 6.99 | 12.99 |
| South Africa | ZAR | 119.99 | 229.99 |
| South Korea | KRW | 9900 | 19000 |
| Spain | EUR | 6.99 | 12.99 |
| Sweden | SEK | 76.99 | 149.99 |
| Switzerland | CHF | 5.69 | 10.99 |
| Turkey | TRY | 389.99 | 719.99 |
| United Kingdom | GBP | 5.99 | 11.99 |
| United States | USD | 5.99 | 11.99 |

Every country **not** listed: auto-convert from the United States price. Those
are standard-band markets where FX conversion lands close enough.

Then **Activate** the base plan.

---

## 5. Country availability

Exclude these at the **app** level (Release → Countries/regions), not per
product. From `docs/play/play-blocked-countries.csv`:

| Country | ISO | Reason |
|---|---|---|
| China | CN | Play does not operate there; ICP licensing |
| North Korea | KP | Sanctioned |
| Iran | IR | Sanctioned |
| Syria | SY | Sanctioned |
| Cuba | CU | Sanctioned |
| Russia | RU | Sanctioned / restricted |
| Belarus | BY | Sanctioned |
| Venezuela | VE | Sanctioned-adjacent |

---

## 6. Testing without being charged

1. **Setup → License testing** → add your Google account as a *License tester*.
   Testers get the real purchase flow at no charge, and renewals are
   accelerated (a month becomes about 5 minutes).
2. Add the same account to the **Internal testing** tester list.
3. Install **from the Play internal-testing link**, not a sideload. Play Billing
   checks the install source.

Then in the app: Settings → Subscription → buy Lite.

Verify it worked:

- Ads disappear and VP shows 1.5×.
- Firestore `users/{uid}.subscription` reads `lite`.
- `users/{uid}.subscriptionPreferredMethod` reads `google_play`.
- The price on the subscription screen matches what Google charged (the store
  build reads Play's own localized string, so a mismatch means the billing
  bridge failed and it fell back to the web price).

---

## 7. Gotchas

- Products can take **a few hours** to propagate after activation. "Item
  unavailable" straight after creating them is usually propagation.
- Product IDs and base plan IDs are **permanent**. A typo means a new product.
- Play does not tell us about renewals. `syncPlaySubscriptions` reconciles daily
  inside `cronDaily`. A cancelled subscription staying active until its paid
  period ends is correct, not a bug.
- Play prices are **not** the web prices. US Lite is $5.99 on Play against $4.99
  on the web; the difference is VAT plus Google's fee, and the net is the same.
  Do not "fix" one to match the other.
- Do not add a benefit line about daily streaming hours. `stream_usage` is read
  by `functions/streaming.js:267` but written nowhere, so no tier is actually
  capped and the limit does not exist.
