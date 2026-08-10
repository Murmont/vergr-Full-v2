export default {
  summary: "Clipping needs a browser feature that captures video. On most devices it runs in your browser; on Apple browsers (Safari and anything on iPhone or iPad) VERGR automatically falls back to a server-side cut so clipping still works. If a clip fails, refresh and try again.",
  updated: "2026-06-06",
  body: [
    { p: "Clipping captures part of a live stream. How it does that depends on your device's browser capabilities." },
    { h2: "How it works per device" },
    { list: [
      "Chrome-based browsers (Windows app, Android, desktop Chrome): clips are captured directly in your browser.",
      "Apple browsers (Safari, anything on iOS/iPadOS): VERGR uses a server-side cut instead, because Apple browsers restrict the in-browser capture. It works the same from your side.",
    ]},
    { h2: "If clipping fails" },
    { list: [
      "Refresh the stream and try again.",
      "Make sure you are within your plan's clip quota for that stream.",
      "Check your connection — a server-side cut needs the stream to be reachable.",
    ]},
    { note: "Either way the result is the same: a clip post on your profile that you chose to make." },
    { cta: [
      { to: "/platform/help/how-do-i-clip-a-moment-from-a-live-stream", label: "Clipping a stream" },
      { to: "/platform/help/my-video-or-clip-will-not-play-what-do-i-do", label: "If a clip won't play" }
    ]}
  ]
};
