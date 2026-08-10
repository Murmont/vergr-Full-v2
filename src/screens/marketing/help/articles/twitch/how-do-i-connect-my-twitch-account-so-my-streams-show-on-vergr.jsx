// Help center article: How do I connect my Twitch account so my streams show on VERGR?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Go to Settings, open Linked Accounts, and connect Twitch. After that, when you go live on Twitch as normal, your stream appears on VERGR automatically as a native-looking broadcast with VERGR chat and tips on top. You do not change your OBS setup at all.",
  updated: "2026-06-06",
  body: [
    {
      p: "The Twitch mirror lets you reach your VERGR audience without doing anything different on Twitch. You connect once, then just stream on Twitch the way you always do."
    },
    {
      h2: "Connect Twitch"
    },
    {
      steps: [
        "Open Settings and go to Linked Accounts.",
        "Choose Twitch and sign in to approve the connection.",
        "That is it, the mirror is now enabled."
      ]
    },
    {
      h2: "What happens when you go live"
    },
    {
      p: "Once connected, going live on Twitch as normal makes your stream show up on VERGR automatically. It appears in discovery and on your profile as a native-looking VERGR stream, with VERGR's chat and tipping layered on top, plus the live ring on your avatar. Your viewers on VERGR can chat and tip you, and chat is bridged with Twitch both ways."
    },
    {
      h2: "No OBS changes"
    },
    {
      p: "You do not touch your encoder or add a second destination for this. You stream to Twitch exactly as you do today. There is also a separate option to make VERGR your OBS target and forward to Twitch, but for the simple \"my Twitch shows on VERGR\" flow, connecting your account is all it takes."
    },
    {
      note: "Reconnect Twitch if you connected it a long time ago, so the mirror has the access it needs to detect when you go live and bridge chat."
    },
    {
      cta: [
        {
          to: "/platform/help/how-does-the-twitch-mirror-work",
          label: "How the mirror works"
        },
        {
          to: "/platform/help/does-my-twitch-chat-sync-with-vergr",
          label: "Chat syncing"
        }
      ]
    }
  ]
};
