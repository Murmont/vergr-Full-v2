// Help center article: Why does the stream say reconnecting?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Reconnecting means the video feed dropped for a moment and the player is reaching back for it, usually because of a brief hiccup in your connection or the streamer's. It almost always sorts itself out in a few seconds. If it sticks, refresh the page or check your own internet first.",
  updated: "2026-06-18",
  body: [
    {
      p: "Seeing Reconnecting is rarely a real problem. It means the stream lost the feed for a second and the player is automatically trying to get it back. Most of the time it clears on its own within a few seconds and you are back to watching."
    },
    {
      h2: "What causes it"
    },
    {
      list: [
        "Your own connection wobbled (Wi-Fi dip, mobile signal drop, a busy network).",
        "The streamer's connection hit a bump, so the feed paused at the source.",
        "You switched networks or your device briefly went to sleep.",
        "A short server-side hiccup while the live feed catches up."
      ]
    },
    {
      h2: "If it does not clear"
    },
    {
      steps: [
        "Give it 10 to 20 seconds. The player retries automatically.",
        "Refresh the page or reopen the stream.",
        "Check your own internet: load another page or run a quick speed test.",
        "On mobile, switch between Wi-Fi and mobile data to see if one is steadier.",
        "If it only happens on this one stream and others are fine, the issue is likely on the streamer's end, not yours."
      ]
    },
    {
      note: "VERGR runs a deeper buffer on mobile to ride out exactly this kind of jitter, trading a couple of seconds of delay for a steadier picture. A brief reconnect is the system protecting your playback, not failing.",
    },
    {
      faq: [
        [
          "Did I miss anything during the reconnect?",
          "On a live stream you are watching close to real time, so a long reconnect can skip a few live seconds. A saved replay, if the streamer keeps one, lets you catch anything you missed."
        ],
        [
          "It keeps reconnecting on every stream. What now?",
          "That points to your connection or device. Try a refresh, a different network, closing other bandwidth-heavy apps, or restarting your router."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-watch-a-live-stream",
          label: "How to watch a stream"
        },
        {
          to: "/platform/help/the-app-is-slow-what-can-i-do",
          label: "The app is slow, what can I do?"
        }
      ]
    }
  ]
};
