// Help center article: My verification was rejected, what do I do?

export default {
  summary: "Check the reason shown in the app. If it says the verification was declined, retry with clearer photos of a valid ID in good lighting. If it says it was not completed, just run it again. Two reasons cannot be fixed by retrying: being under 18, and being in a country where verification is not available.",
  updated: "2026-07-02",
  body: [
    {
      p: "When a check fails, VERGR shows you why. Each reason has a different fix."
    },
    {
      h2: "The reasons and what to do"
    },
    {
      list: [
        "Declined: the ID photo or selfie could not be confirmed. Retry with a clearer photo, better lighting, no glare, all corners of the document visible, and a selfie with your face fully visible. Make sure the ID is current and undamaged.",
        "Not completed: the session was closed or abandoned partway. Nothing went wrong, simply start the verification again and finish all the steps.",
        "Under 18: VERGR requires everyone to be at least 18. This cannot be appealed or retried, it is a hard requirement.",
        "Country not eligible: identity verification is not available in your country, so money features cannot be unlocked there."
      ]
    },
    {
      h2: "Retrying"
    },
    {
      p: "For declined or incomplete checks you can simply tap Verify again and rerun the flow. There is no penalty for retrying."
    },
    {
      note: "The rest of VERGR keeps working without verification: you can stream, post, chat, and join squads. Verification is only required for the wallet, tournaments, and payouts."
    },
    {
      cta: [
        { to: "/platform/help/what-documents-do-i-need-for-verification", label: "Accepted documents" },
        { to: "/platform/help/why-can-i-not-withdraw-until-i-am-verified", label: "Why money features need it" }
      ]
    }
  ]
};
