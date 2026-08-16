// Help center article: How do I sign up for VERGR?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Signing up takes about a minute and is free. Open VERGR, choose to sign up with Google, an email and password, or your phone number, pick a username, confirm you are 18 or older, and you are in. You do not need to verify your identity just to look around and play.",
  updated: "2026-06-06",
  body: [
    {
      p: "Getting onto VERGR is quick and costs nothing. You only need one of three things to start: a Google account, an email address, or a phone number."
    },
    {
      h2: "Sign up in a few steps"
    },
    {
      steps: [
        "Open vergr.app or the VERGR app and tap Sign up.",
        "Choose how you want to sign up: continue with Google, use an email and password, or use your phone number.",
        "If you use email or phone, confirm the code we send so we know it is really you.",
        "Pick a username. This is your @handle, so other people can find you. You can change it later if you want.",
        "Confirm your date of birth. VERGR is for ages 18 and up.",
        "Set up your profile, pick a few interests, and follow a couple of people to fill your feed."
      ]
    },
    {
      h2: "Do I have to verify my identity?"
    },
    {
      p: "Not to sign up. You can explore, post, stream, and follow people right away. A one-time identity check (a photo of your ID and a selfie) is only needed before Vergr can pay you a revenue share, so you can leave it until you start earning."
    },
    {
      note: "VERGR is for ages 18 and up. We check your date of birth at signup and run a full identity check before you use the wallet or receive a payment."
    },
    {
      faq: [
        [
          "Is signing up free?",
          "Yes. Creating an account, playing, posting, watching, and streaming all cost nothing."
        ],
        [
          "Can I sign up without a phone number?",
          "Yes. You can sign up with Google or with an email and password instead."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-create-an-account",
          label: "Create an account"
        },
        {
          to: "/platform/help/how-do-i-sign-up-with-google",
          label: "Sign up with Google"
        },
        {
          to: "/platform/help/how-do-i-get-started-on-vergr",
          label: "Your first hour"
        }
      ]
    }
  ]
};
