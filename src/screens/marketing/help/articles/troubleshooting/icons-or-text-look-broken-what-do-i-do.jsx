// Help center article: Icons or text look broken, what do I do?

export default {
  summary: "Seeing words like \"home\" or \"settings\" where little symbols should be means the icon font did not load, usually a hiccup on a slow connection. A reload fixes it; a hard refresh (Ctrl+Shift+R) fixes the stubborn cases. On the Android app, update if the banner offers it, then fully close and reopen.",
  updated: "2026-07-02",
  body: [
    {
      h2: "Why it happens"
    },
    {
      p: "VERGR's icons are drawn by a special font. If that font fails to download, because the connection dropped mid-load or an old cached copy went stale, the icons fall back to their text names, and parts of the interface look scrambled. Nothing is wrong with your account, it is purely a loading problem."
    },
    {
      h2: "The fixes"
    },
    {
      steps: [
        "Reload the page or reopen the app.",
        "If icons are still text, hard refresh: Ctrl+Shift+R on Windows, Cmd+Shift+R on Mac. This forces fresh downloads of everything.",
        "On the Android app: install the update if the in-app banner offers one, then close the app fully and reopen it.",
        "On a very slow connection, give the page a few extra seconds after loading: fonts arrive after the layout does."
      ]
    },
    {
      note: "Content blockers and strict privacy modes occasionally block font files. If the problem only happens with an extension active, that is the culprit: allow vergr.app in it."
    },
    {
      cta: [
        { to: "/platform/help/the-app-looks-broken-or-out-of-date-how-do-i-refresh-it", label: "Full refresh guide" },
        { to: "/platform/help/the-app-is-slow-what-can-i-do", label: "If the app is slow" }
      ]
    }
  ]
};
