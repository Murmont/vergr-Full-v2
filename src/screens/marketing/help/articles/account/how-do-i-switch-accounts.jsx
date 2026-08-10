export default {
  summary: "VERGR does not support simultaneous multi-account switching within the app. To use a different account, log out from Settings and log in with the other account's credentials.",
  updated: "2026-06-06",
  body: [
    { p: "If you manage more than one account, you will need to log out and log back in each time. There is no quick-switch shortcut." },
    { h2: "How to switch" },
    { steps: [
      "Tap your avatar to open your profile.",
      "Go to Settings.",
      "Scroll to the bottom and tap Log Out.",
      "On the login screen, sign in with the credentials for your other account."
    ]},
    { h2: "Using multiple devices" },
    { p: "The simplest way to manage two accounts is to stay logged into one on your phone and one on a desktop or browser. Each session is independent and stays logged in until you log out." },
    { note: "VERGR accounts must each be tied to a unique email address or phone number. Logging into the same account on multiple devices at the same time is allowed." },
    { cta: [
      { to: "/platform/help/can-i-have-more-than-one-vergr-account", label: "Can I have more than one account?" },
      { to: "/platform/help/how-do-i-log-out-of-all-devices", label: "Logging out of all devices" }
    ]}
  ]
};
