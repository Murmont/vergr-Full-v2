// Help center article: Is my ID and selfie data safe?

export default {
  summary: "Yes. The check runs with a specialist identity partner over a secure connection, and what VERGR keeps is the outcome, verified or not and the reason, not a copy of your documents sitting on your profile. Where VERGR itself handles document photos, they are encrypted before upload and deleted once the review is decided.",
  updated: "2026-07-02",
  body: [
    {
      p: "Handing over an ID photo is a big ask, so here is exactly how it is treated."
    },
    {
      h2: "The standard verification (wallet, tournaments, payouts)"
    },
    {
      list: [
        "The document and selfie capture happens on a dedicated secure verification page run by a specialist identity provider, the same kind banks and fintech apps use.",
        "The connection is encrypted end to end.",
        "What comes back to VERGR is the result: verified yes or no, and a reason if not. Your account is marked verified, your documents do not become part of your VERGR profile.",
        "Nobody on VERGR, not other users, not creators you follow, can ever see your documents. Other users only ever see your username and profile, never your legal identity."
      ]
    },
    {
      h2: "Creator verification"
    },
    {
      p: "The creator verification flow captures documents inside the app. Those photos are encrypted on your device before they are uploaded, only the review process can unlock them, and they are permanently deleted once the decision is made. What remains afterwards is just the verified status."
    },
    {
      h2: "Consent and age"
    },
    {
      p: "You are asked for explicit consent before any biometric step, and you can stop at any point before submitting. The only personal fact the platform relies on afterwards is that you are a verified adult."
    },
    {
      cta: [
        { to: "/platform/help/what-is-kyc-and-why-does-vergr-ask-for-it", label: "Why VERGR asks for ID" },
        { to: "/platform/help/how-do-i-complete-identity-verification", label: "The verification steps" }
      ]
    }
  ]
};
