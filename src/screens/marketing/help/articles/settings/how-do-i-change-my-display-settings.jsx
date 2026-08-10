// Help center article: How do I change my display settings?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Go to Settings then Display. There you can pick your theme, change the text size, and turn on reduced motion. Changes apply across the app right away, and your theme choice syncs to your other devices so VERGR looks the same everywhere you sign in.",
  updated: "2026-06-18",
  body: [
    {
      p: "Display settings let you tune how VERGR looks and feels. Bigger text, less animation, your preferred theme: you set it once in Settings then Display, and it takes effect immediately across the whole app."
    },
    {
      h2: "Adjust your display"
    },
    {
      steps: [
        "Open Settings, then Display.",
        "Pick your theme.",
        "Set your text size to make everything easier to read if you want it larger.",
        "Turn on Reduced motion to cut down animations and transitions.",
        "Your changes apply instantly, no restart needed."
      ]
    },
    {
      h2: "What each option does"
    },
    {
      list: [
        "Theme: the overall look of the app. Your choice syncs across your signed-in devices.",
        "Text size: scales the text throughout the app for comfort and accessibility.",
        "Reduced motion: minimises animation and movement, which helps if motion bothers you or you want a calmer interface."
      ]
    },
    {
      note: "Reduced motion respects accessibility: where the app can, it honours your device's system motion preference too. Turning it on in VERGR makes the choice explicit.",
    },
    {
      faq: [
        [
          "Do my display settings follow me to another device?",
          "Your theme preference syncs to your other signed-in devices. Text size and reduced motion are applied wherever you set them."
        ],
        [
          "Reduced motion did not stop every animation.",
          "It removes the non-essential motion. A few functional transitions remain so the app stays understandable, but the heavy animation is gone."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/where-do-i-find-all-my-account-settings",
          label: "All your settings"
        },
        {
          to: "/platform/help/icons-or-text-look-broken-what-do-i-do",
          label: "Icons or text look broken?"
        }
      ]
    }
  ]
};
