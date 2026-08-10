export default {
  summary: "While watching a stream, tap the Clip button. VERGR grabs the last several seconds, lets you confirm, and saves it as a clip post on your profile. You choose the moments — clips are always user-made, never auto-published.",
  updated: "2026-06-06",
  body: [
    { p: "Clipping captures a great moment from a live stream so it lives on after the broadcast ends." },
    { h2: "How to clip as a viewer" },
    { steps: [
      "While watching a live stream, tap the Clip button.",
      "VERGR captures the recent seconds of the stream.",
      "Confirm the clip.",
      "It is saved as a clip post on your profile, which you can share."
    ]},
    { h2: "Limits by plan" },
    { list: [
      "Free: up to 30 seconds, a few clips per stream.",
      "Lite: up to 60 seconds, more per stream.",
      "Pro: up to 90 seconds, unlimited per session.",
    ]},
    { note: "Clipping works on most devices. On some Apple browsers it uses a server-side cut instead, which works the same from your side." },
    { cta: [
      { to: "/platform/help/why-can-i-not-clip-on-my-device", label: "If you can't clip on your device" },
      { to: "/platform/help/how-do-i-save-a-clip-to-my-profile", label: "Saving a clip" }
    ]}
  ]
};
