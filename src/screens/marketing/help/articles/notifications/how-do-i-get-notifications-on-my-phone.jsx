export default {
  summary: "Install VERGR on your phone — the Android app or Add to Home Screen on iPhone — then allow notifications when prompted. Installed, VERGR delivers native push for calls, messages, go-live alerts, and more, even when the app is closed.",
  updated: "2026-06-07",
  body: [
    { h2: "Android" },
    { steps: [
      "Install the VERGR Android app (or add the PWA to your home screen).",
      "Open it and allow notifications when asked.",
      "Choose your categories in Settings → Notifications."
    ]},
    { h2: "iPhone / iPad" },
    { steps: [
      "Open VERGR in Safari and use Share → Add to Home Screen.",
      "Open VERGR from the new home-screen icon (not the Safari tab).",
      "Allow notifications when prompted (requires iOS 16.4 or later)."
    ]},
    { note: "On iPhone, push only works from the home-screen install — a normal Safari tab cannot receive push. This is an Apple limitation, not a VERGR setting." },
    { cta: [
      { to: "/platform/help/how-do-i-add-vergr-to-my-iphone-home-screen", label: "Add to iPhone home screen" },
      { to: "/platform/help/why-am-i-not-getting-push-notifications", label: "Troubleshoot push" }
    ]}
  ]
};
