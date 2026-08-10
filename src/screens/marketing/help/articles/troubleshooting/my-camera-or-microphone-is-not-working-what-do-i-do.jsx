// Help center article: My camera or microphone is not working, what do I do?

export default {
  summary: "It is almost always permissions: your browser or phone blocked VERGR's access, often from a mis-click on the first prompt. Re-allow camera and microphone in the browser's site settings (the icon near the address bar) or the app's Android permissions, reload, and make sure no other app is holding the camera.",
  updated: "2026-07-02",
  body: [
    {
      h2: "In a browser (desktop or mobile)"
    },
    {
      steps: [
        "Click the icon at the left of the address bar (padlock or camera symbol) while on vergr.app.",
        "Set Camera and Microphone to Allow.",
        "Reload the page and start your call or stream again."
      ]
    },
    {
      h2: "In the Android app"
    },
    {
      steps: [
        "Open Android Settings, then Apps, then VERGR, then Permissions.",
        "Allow Camera and Microphone.",
        "Fully close and reopen VERGR."
      ]
    },
    {
      h2: "Permission is allowed but it still fails"
    },
    {
      list: [
        "Something else is using the camera: video call apps and other browser tabs grab it exclusively. Close them and retry.",
        "Wrong device selected: if you have multiple cameras or mics (a headset, an external webcam), the wrong one may be active. Unplug what you do not use, or pick the right device in your system sound settings.",
        "Black preview but working sound (or the reverse): reload once more, then restart the browser. Camera drivers occasionally wedge until the app using them restarts.",
        "In-app settings check: VERGR's Settings include an App Permissions screen that shows what is currently granted."
      ]
    },
    {
      cta: [
        { to: "/platform/help/i-can-not-go-live-what-do-i-do", label: "Go-live problems" },
        { to: "/platform/help/how-do-i-make-a-voice-or-video-call", label: "How calls work" }
      ]
    }
  ]
};
