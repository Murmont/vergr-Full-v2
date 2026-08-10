// Help center article: How do I update the VERGR app?

export default {
  summary: "Usually you do nothing. The web app and the iPhone home-screen app are always the latest version. The Windows desktop app updates itself when you launch it. Only the Android app asks for one tap: when a new version is out, an Update banner appears in the app, tap it, allow the install, then fully close and reopen VERGR.",
  updated: "2026-07-02",
  body: [
    {
      h2: "By platform"
    },
    {
      list: [
        "Web (vergr.app in a browser): always current. A normal reload lands you on the newest release.",
        "iPhone home-screen app: same as web, it is always the latest version when you open it.",
        "Windows desktop: updates install themselves silently when you launch the app. No action needed.",
        "Android app: when a new version is available, an Update banner appears inside the app on launch. Tap Update, the new version downloads, Android asks you to allow the install, and after installing you fully close and reopen VERGR."
      ]
    },
    {
      h2: "Android, in a bit more detail"
    },
    {
      steps: [
        "Open VERGR. If there is a new version, the banner shows at the top with an Update button.",
        "Tap Update and wait for the download to finish.",
        "Android asks permission to install: allow it.",
        "After the install completes, close VERGR fully (swipe it away from recent apps) and open it again."
      ]
    },
    {
      note: "If the banner does not appear, you are already on the newest version. The banner only ever shows when there is genuinely something to install."
    },
    {
      cta: [
        { to: "/platform/help/the-app-looks-broken-or-out-of-date-how-do-i-refresh-it", label: "If the app looks out of date" },
        { to: "/platform/download", label: "Download page" }
      ]
    }
  ]
};
