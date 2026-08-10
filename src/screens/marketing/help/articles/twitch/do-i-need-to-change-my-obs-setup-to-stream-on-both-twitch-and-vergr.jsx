// Help center article: Do I need to change my OBS setup to stream on both Twitch and VERGR?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "No. With the Twitch mirror you keep streaming to Twitch exactly as you do today, no second output, no VERGR stream key in OBS, no extra encoder load. VERGR detects your Twitch broadcast and surfaces it to your VERGR audience automatically. The only setup is connecting your Twitch account once.",
  updated: "2026-06-18",
  body: [
    {
      p: "Good news: you do not change your OBS setup at all. The Twitch mirror works by detecting your existing Twitch broadcast and showing it on VERGR. So you stream to Twitch the way you always have, and VERGR handles surfacing it to your VERGR followers."
    },
    {
      h2: "What stays exactly the same"
    },
    {
      list: [
        "Your OBS scenes, sources, overlays, and audio: unchanged.",
        "Your stream target: still Twitch, with your Twitch stream key.",
        "Your encoder settings and bitrate: whatever you already use for Twitch.",
        "Your workflow: hit Start Streaming in OBS, the same as always."
      ]
    },
    {
      h2: "The only thing you set up"
    },
    {
      p: "Connect your Twitch account to VERGR once, in Settings under Linked Accounts. After that the mirror is on, and going live on Twitch makes your stream appear on VERGR automatically with VERGR chat and tips on top. There is nothing to add in OBS."
    },
    {
      note: "There is a separate, optional flow where you point your encoder at VERGR and VERGR forwards the broadcast out to Twitch. That one does involve a different stream target. But for the standard \"my Twitch shows on VERGR\" mirror, you change nothing in OBS.",
    },
    {
      faq: [
        [
          "So I do not add a VERGR output in OBS?",
          "Correct. For the Twitch mirror you only stream to Twitch. VERGR detects that broadcast and shows it. No second OBS output, no VERGR key."
        ],
        [
          "Will this double my upload?",
          "No. You send one stream to Twitch as usual. VERGR surfaces it, rather than asking your machine to upload a second copy."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-does-the-twitch-mirror-work",
          label: "How the Twitch mirror works"
        },
        {
          to: "/platform/help/how-do-i-connect-my-twitch-account-so-my-streams-show-on-vergr",
          label: "Connect your Twitch account"
        }
      ]
    }
  ]
};
