// Help center article: Why is my Twitch stream not showing up on VERGR?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Usually it is one of these: Twitch is not connected (or needs reconnecting), you are not actually live on Twitch yet, or VERGR has not detected the stream yet. VERGR checks for your Twitch broadcast on a short cycle, so it can take a couple of minutes to appear after you go live, and to clear after you stop.",
  updated: "2026-06-18",
  body: [
    {
      p: "The Twitch mirror shows your Twitch broadcast on VERGR automatically, so when it is not appearing, it is almost always a connection or a timing thing. Run through this and it usually sorts itself."
    },
    {
      h2: "Check these in order"
    },
    {
      steps: [
        "Confirm Twitch is connected in Settings, Linked Accounts. If it has been a while, reconnect it.",
        "Confirm you are actually live on Twitch right now (the mirror only shows a live Twitch broadcast).",
        "Give it a couple of minutes. VERGR detects your Twitch stream on a short polling cycle, so it is not instant.",
        "If it still does not appear, disconnect and reconnect Twitch to refresh the access VERGR uses to detect your stream."
      ]
    },
    {
      h2: "Common causes"
    },
    {
      list: [
        "Twitch not connected, or the connection expired: reconnect in Settings, Linked Accounts.",
        "Not live on Twitch yet: the mirror only surfaces an active Twitch broadcast.",
        "Detection delay: there is a short, normal lag between going live on Twitch and the stream showing on VERGR.",
        "Just stopped on Twitch: the VERGR mirror also takes a couple of minutes to clear after you end."
      ]
    },
    {
      note: "The mirror direction is Twitch to VERGR: you stream on Twitch and VERGR surfaces it. You do not stream to VERGR for the mirror, so nothing changes in OBS.",
    },
    {
      faq: [
        [
          "It appeared but then would not go away after I stopped.",
          "The mirror ends on the same short cycle it starts on, so a finished stream can linger for a couple of minutes before VERGR marks it ended."
        ],
        [
          "It worked before and now it does not.",
          "Your Twitch connection most likely lapsed. Reconnect Twitch in Settings, Linked Accounts and the mirror resumes."
        ],
        [
          "My chat is not bridging either.",
          "That points to the same expired Twitch connection. Reconnecting restores both the mirror and the two-way chat."
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
          to: "/platform/help/how-does-the-twitch-mirror-work",
          label: "How the Twitch mirror works"
        }
      ]
    }
  ]
};
