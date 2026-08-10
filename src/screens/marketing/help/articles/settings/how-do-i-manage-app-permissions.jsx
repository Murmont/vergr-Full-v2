// Help center article: How do I manage app permissions?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Go to Settings then Permissions to see the access VERGR uses: camera, microphone, notifications, and location. The page shows the real status of each and points you to grant or revoke it. Some permissions are controlled by your device or browser, so a couple of taps may finish in your system settings.",
  updated: "2026-06-18",
  body: [
    {
      p: "VERGR only asks for access it actually needs, and you stay in control of all of it. The Permissions page in Settings shows you exactly what is granted right now, so there are no surprises."
    },
    {
      h2: "Check your permissions"
    },
    {
      steps: [
        "Open Settings, then Permissions.",
        "Review each one and its current status: camera, microphone, notifications, and location.",
        "Use the control next to a permission to grant it, or follow the prompt to your device or browser settings to change it there.",
        "Revoke anything you do not want VERGR to use."
      ]
    },
    {
      h2: "What each permission is for"
    },
    {
      list: [
        "Camera: streaming with your camera, video calls, and taking photos or clips in the app.",
        "Microphone: streaming audio, voice messages, and voice or video calls.",
        "Notifications: live alerts, messages, and other push notifications.",
        "Location: only where a feature needs your region; you can leave it off otherwise."
      ]
    },
    {
      note: "Permissions are enforced by your device and browser, not just by VERGR. If a toggle here sends you to system settings, that is your OS having the final say, which is exactly how it should work.",
    },
    {
      faq: [
        [
          "I denied camera access and now I cannot stream.",
          "Re-enable camera permission for VERGR in your device or browser settings, then reload. The Permissions page links you to the right place."
        ],
        [
          "Why does VERGR need the microphone?",
          "For streaming audio, voice messages, and calls. If you never use those, you can leave it off and grant it later when you do."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/my-camera-or-microphone-is-not-working-what-do-i-do",
          label: "Camera or mic not working?"
        },
        {
          to: "/platform/help/why-am-i-not-getting-push-notifications",
          label: "Not getting notifications?"
        }
      ]
    }
  ]
};
