export default {
  summary: "The phone allow list controls which of your connections can see your phone number on VERGR. Your number is private by default; the allow list lets you reveal it only to specific people you follow or who follow you. Everyone else never sees it.",
  updated: "2026-06-07",
  body: [
    { p: "Your phone number is never public on VERGR. The phone allow list is an opt-in way to share it with a chosen few — for example close squadmates you also coordinate with off-platform." },
    { h2: "How it works" },
    { steps: [
      "Open the Phone Allow List in settings.",
      "You will see people you follow and who follow you.",
      "Select the specific people allowed to see your number.",
      "Save. Only those people can see it; everyone else cannot."
    ]},
    { h2: "Good to know" },
    { list: [
      "By default the list is empty, so nobody sees your number.",
      "Removing someone hides your number from them again immediately.",
      "This is separate from blocking and from message settings.",
    ]},
    { cta: [
      { to: "/platform/help/how-does-vergr-keep-my-information-private", label: "How VERGR protects your info" },
      { to: "/platform/help/how-do-i-control-who-can-message-me", label: "Control who can message you" }
    ]}
  ]
};
