// Help center article: How does the Twitch mirror work?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "The Twitch mirror brings your Twitch stream onto VERGR. You connect Twitch once, then stream on Twitch exactly as you always do. When you go live there, VERGR detects it and shows your broadcast as a native-looking VERGR stream, with VERGR chat and tips layered on top and the live ring on your avatar. You do not change your OBS setup or push a second stream.",
  updated: "2026-06-18",
  body: [
    {
      p: "The Twitch mirror is about reaching your VERGR audience without doing anything extra on Twitch. The direction is Twitch to VERGR: you keep streaming on Twitch the way you already do, and VERGR surfaces that broadcast to your VERGR followers automatically."
    },
    {
      h2: "What actually happens"
    },
    {
      list: [
        "You connect Twitch once in Settings, Linked Accounts, which turns the mirror on.",
        "When you go live on Twitch, VERGR notices and creates a live stream for you that shows your Twitch broadcast.",
        "It appears in VERGR discovery and on your profile as a native-looking stream, with the live ring on your avatar.",
        "VERGR's own chat and tipping sit on top, so your VERGR viewers can chat and tip while they watch.",
        "When you stop streaming on Twitch, VERGR ends the mirrored stream automatically."
      ]
    },
    {
      h2: "You are not double-streaming"
    },
    {
      p: "Your computer only sends one stream, to Twitch, like always. VERGR does not make you re-encode or add a second output. It shows your Twitch broadcast to VERGR viewers and layers its own chat and tips around it. That is why there are no OBS changes to make."
    },
    {
      note: "Detection runs on a short cycle, so your mirrored stream can take a couple of minutes to appear on VERGR after you go live on Twitch, and a couple of minutes to clear after you stop. That delay is normal.",
    },
    {
      faq: [
        [
          "Does VERGR re-host my video?",
          "It shows your Twitch broadcast through the official Twitch player, wrapped in a native-looking VERGR stream with VERGR chat and tips. You are still streaming to Twitch; VERGR is presenting it to your VERGR audience."
        ],
        [
          "Is there a way to do it the other way around?",
          "There is a separate option to make VERGR your streaming target and forward out to Twitch. That is a different flow. The mirror covered here is the simple Twitch-to-VERGR one."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-connect-my-twitch-account-so-my-streams-show-on-vergr",
          label: "Connect your Twitch account"
        },
        {
          to: "/platform/help/does-my-twitch-chat-sync-with-vergr",
          label: "Does Twitch chat sync?"
        }
      ]
    }
  ]
};
