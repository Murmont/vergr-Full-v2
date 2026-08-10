export default {
  summary: "Tap the search bar in Explore and type a username or display name. Search is case-insensitive, so capitalization does not matter, and you can leave off the @ symbol. Tap a result to open their profile.",
  updated: "2026-06-06",
  body: [
    { h2: "Searching" },
    { steps: [
      "Go to the Explore tab.",
      "Tap the search bar at the top.",
      "Type a username or display name (any capitalization, with or without @).",
      "Tap a result to open the profile, or Follow directly from the list."
    ]},
    { h2: "Tips" },
    { list: [
      "Search is case-insensitive — 'lunax', 'LunaX', and 'LUNAX' all find the same person.",
      "You can filter results by type (People, Streams, Squads) using the tabs.",
      "Bot and incomplete accounts are filtered out of people results.",
      "Every account has a unique username, so the exact handle always finds the right person."
    ]},
    { cta: [
      { to: "/platform/help/how-do-i-search-by-username-or-handle", label: "Searching by handle" },
      { to: "/platform/help/how-do-i-find-and-browse-creators", label: "Browsing creators" }
    ]}
  ]
};
