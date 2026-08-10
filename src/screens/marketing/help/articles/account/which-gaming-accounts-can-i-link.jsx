// Help center article: Which gaming accounts can I link?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "You can link Steam, Twitch, YouTube, Discord, Xbox, and other major gaming and streaming platforms from your linked accounts settings. Each one adds something, from result verification to showing your streams on VERGR, and you can connect or disconnect them whenever you like.",
  updated: "2026-06-06",
  body: [
    {
      p: "VERGR connects to the major gaming and streaming platforms so your accounts work together. You manage all of them from one place in settings."
    },
    {
      h2: "What you can connect"
    },
    {
      list: [
        "Steam, for PC game identity and your library on your profile.",
        "Twitch, so your Twitch streams can show on VERGR with chat and tips bridged.",
        "YouTube, to link your channel and content.",
        "Discord, to connect your community presence.",
        "Xbox and other console and platform accounts, to tie in your console identity."
      ]
    },
    {
      h2: "How to link an account"
    },
    {
      steps: [
        "Go to Settings and open Linked Accounts.",
        "Choose the platform you want to connect.",
        "Sign in to that platform and approve the connection.",
        "It now shows on your profile and works with the relevant features."
      ]
    },
    {
      note: "You can disconnect any account at any time from the same Linked Accounts screen."
    },
    {
      cta: [
        {
          to: "/platform/help/why-should-i-link-my-gaming-accounts",
          label: "Why link accounts?"
        },
        {
          to: "/platform/help/how-do-i-disconnect-a-linked-account",
          label: "Disconnect an account"
        }
      ]
    }
  ]
};
