export default {
  summary: "Type the exact handle into the Explore search bar — with or without the @ — and it resolves directly to that account. Handles are unique and case-insensitive, so the exact username always lands on the right person.",
  updated: "2026-06-06",
  body: [
    { p: "Every VERGR account has one unique username (handle). It is the most reliable way to find a specific person." },
    { h2: "Searching by handle" },
    { steps: [
      "Open Explore and tap search.",
      "Type the handle, e.g. 'lunax' or '@lunax' — both work.",
      "The exact match appears at the top; tap to open the profile."
    ]},
    { h2: "Good to know" },
    { list: [
      "Capitalization is ignored — handles are matched in lowercase.",
      "A leading @ is stripped automatically.",
      "If a handle does not resolve, the person may have changed their username — try their display name instead.",
    ]},
    { cta: [
      { to: "/platform/help/how-do-i-search-for-a-user", label: "Searching for a user" },
      { to: "/platform/help/can-i-change-my-username-later", label: "Changing a username" }
    ]}
  ]
};
