// Help center article: How do I sign up with Google?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "On the sign-up screen, choose Continue with Google and pick your Google account. VERGR creates your account from there. You will still pick a username and confirm your date of birth, and you can add a password or other sign-in methods later.",
  updated: "2026-06-06",
  body: [
    {
      p: "Signing up with Google is the fastest way in, since you do not have to set a password. Here is how it works."
    },
    {
      h2: "Sign up"
    },
    {
      steps: [
        "On the sign-up or login screen, choose Continue with Google.",
        "Pick the Google account you want to use and approve the sign-in.",
        "Confirm your date of birth (you must be 18 or older).",
        "Choose your username and add a photo and bio."
      ]
    },
    {
      h2: "Good to know"
    },
    {
      p: "Using Google to sign in does not give VERGR access to your Gmail or your Google data beyond the basics needed to create your account. After signing up you can finish onboarding normally: pick interests, follow people, and link your gaming accounts."
    },
    {
      note: "If you ever want to log in a different way, you can add other sign-in methods from your account settings later."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-create-an-account",
          label: "Other ways to sign up"
        },
        {
          to: "/platform/help/how-do-i-log-in",
          label: "How to log in"
        }
      ]
    }
  ]
};
