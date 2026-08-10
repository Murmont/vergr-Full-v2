// Help center article: I am not receiving the verification code, what do I do?

export default {
  summary: "Email codes: check spam and promotions folders, wait a minute or two, then use resend. Phone codes: confirm the number is typed correctly with the right country code, and that your phone has signal. Codes expire quickly, so use the newest one if several arrive.",
  updated: "2026-07-02",
  body: [
    {
      h2: "Email verification"
    },
    {
      steps: [
        "Check spam, junk, and (in Gmail) the Promotions tab: automated emails land there constantly.",
        "Search your inbox for \"VERGR\" in case it was filed somewhere unexpected.",
        "Wait a couple of minutes: delivery is usually instant but can lag.",
        "Use the resend option on the verification screen. If several codes arrive, only the newest is valid.",
        "Still nothing? Check the email address shown on the screen for typos: a code sent to a mistyped address will never arrive."
      ]
    },
    {
      h2: "Phone (SMS) verification"
    },
    {
      steps: [
        "Confirm the number and country code are right on the entry screen.",
        "Make sure the phone has signal and SMS is not blocked (some carriers filter shortcode messages).",
        "Wait, then resend. Repeated rapid resends can trigger a cooldown, so give each attempt a minute.",
        "If your number recently changed carriers, SMS routing can misbehave for a while: retrying later genuinely helps."
      ]
    },
    {
      note: "Codes are time-limited. If you found an old code in spam an hour later, it will not work, resend a fresh one."
    },
    {
      cta: [
        { to: "/platform/help/i-can-not-log-in-what-do-i-do", label: "Login problems" },
        { to: "/platform/contact", label: "Contact support" }
      ]
    }
  ]
};
