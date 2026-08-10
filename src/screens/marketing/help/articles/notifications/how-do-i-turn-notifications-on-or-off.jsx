export default {
  summary: "Go to Settings → Notifications to turn notifications on or off. You can switch them off entirely, or leave them on and fine-tune which categories you receive. Push notifications also need permission from your device or browser.",
  updated: "2026-06-07",
  body: [
    { h2: "Turning notifications on or off" },
    { steps: [
      "Open Settings → Notifications.",
      "Toggle notifications on or off overall.",
      "If on, choose which categories you want (see per-category settings).",
      "Grant notification permission when your device/browser asks, so push can reach you."
    ]},
    { h2: "Two layers" },
    { list: [
      "In-app: the notifications drawer inside VERGR.",
      "Push: alerts on your device even when the app is closed — these need device permission and a supported platform.",
    ]},
    { cta: [
      { to: "/platform/help/how-do-i-choose-which-notifications-i-get", label: "Choose notification types" },
      { to: "/platform/help/why-am-i-not-getting-push-notifications", label: "Not getting push?" }
    ]}
  ]
};
