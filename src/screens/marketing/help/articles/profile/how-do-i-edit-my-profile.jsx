// Help center article: How do I edit my profile?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Open your profile and tap edit profile. From there you can change your avatar, banner, display name, username, bio, social links, and date of birth. Save when you are done and the changes go live right away.",
  updated: "2026-06-06",
  body: [
    {
      p: "Your profile is your home on VERGR, so it is worth setting up properly. Editing it is quick and everything is in one place."
    },
    {
      h2: "How to edit"
    },
    {
      steps: [
        "Open your profile from the menu or your avatar.",
        "Tap edit profile.",
        "Update what you want: profile picture, banner, display name, username, bio, and social links.",
        "Save. Your changes appear immediately."
      ]
    },
    {
      h2: "What you can change"
    },
    {
      list: [
        "Profile picture (avatar) and banner image.",
        "Display name and username.",
        "Bio, where a clear line or two about what you play goes a long way.",
        "Social media and platform links.",
        "Your date of birth, which is used for the 18+ requirement."
      ]
    },
    {
      note: "Images are optimised automatically when you upload them, so you do not need to resize anything first."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-change-my-profile-picture",
          label: "Change your avatar"
        },
        {
          to: "/platform/help/how-do-i-write-a-good-bio",
          label: "Write a good bio"
        }
      ]
    }
  ]
};
