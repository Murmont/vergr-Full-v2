// Help center article: Can I change my username later?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Yes. You can change your username from your profile settings. The new one has to be available and follow the format rules. Keep in mind that changing it updates your handle everywhere, so old links and tags pointing at your previous name may no longer work.",
  updated: "2026-06-06",
  body: [
    {
      p: "Yes, your username is not locked in forever. You can update it from your settings, as long as the new one is free."
    },
    {
      h2: "How to change it"
    },
    {
      steps: [
        "Open your profile and go to edit profile.",
        "Find the username field and enter the new handle you want.",
        "VERGR checks that it is available and correctly formatted.",
        "Save. Your handle updates across the app."
      ]
    },
    {
      h2: "What to keep in mind"
    },
    {
      p: "Changing your username changes how people reach you. Your old handle becomes free for someone else, and any links or tags that used your previous name may stop pointing to you. If you have built an audience, change your username sparingly, and let people know when you do."
    },
    {
      note: "The new username must be unique and follow the same format rules as at sign-up. If it is taken, you will need to pick a different one."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-choose-a-username",
          label: "Choosing a username"
        },
        {
          to: "/platform/help/what-if-my-username-is-already-taken",
          label: "If a username is taken"
        }
      ]
    }
  ]
};
