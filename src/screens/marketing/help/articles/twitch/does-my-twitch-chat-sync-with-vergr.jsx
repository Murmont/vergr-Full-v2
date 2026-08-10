// Help center article: Does my Twitch chat sync with VERGR?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Yes. When your Twitch stream is mirrored on VERGR, chat is bridged both ways: your Twitch chat appears in the VERGR stream, and messages sent on VERGR are posted to your Twitch chat under your channel. It works while your Twitch connection is fresh, so reconnect Twitch if it has been a long time.",
  updated: "2026-06-18",
  body: [
    {
      p: "When your Twitch broadcast is mirrored onto VERGR, you do not end up with two separate, disconnected chats. The chat bridge ties them together so you can talk to both audiences at once while you stream on Twitch."
    },
    {
      h2: "What the bridge does"
    },
    {
      list: [
        "Twitch to VERGR: messages from your Twitch chat show up in the VERGR mirror stream.",
        "VERGR to Twitch: messages your VERGR viewers send are posted into your Twitch chat, under your channel.",
        "The result is one conversation across both platforms while your Twitch stream is mirrored."
      ]
    },
    {
      h2: "Keep your connection fresh"
    },
    {
      p: "Sending messages to your Twitch chat on your behalf relies on your Twitch connection being current. VERGR keeps that connection refreshed, but if you linked Twitch a long time ago and chat is not flowing both ways, reconnecting Twitch in Settings, Linked Accounts restores it."
    },
    {
      note: "Public stream chat on VERGR is moderated for safety. The bridge brings your Twitch chat into the VERGR view so you can engage with everyone in one place.",
    },
    {
      faq: [
        [
          "Why is chat only showing one way?",
          "Posting from VERGR into your Twitch chat needs an active Twitch connection. If it lapsed, reconnect Twitch in Settings, Linked Accounts and it resumes both ways."
        ],
        [
          "Do I need the bridge to use the mirror?",
          "The mirror and the chat bridge come together: when your Twitch stream is mirrored on VERGR, chat is bridged. There is nothing extra to switch on beyond connecting Twitch."
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
          to: "/platform/help/why-is-my-twitch-stream-not-showing-up-on-vergr",
          label: "Twitch stream not showing up?"
        }
      ]
    }
  ]
};
