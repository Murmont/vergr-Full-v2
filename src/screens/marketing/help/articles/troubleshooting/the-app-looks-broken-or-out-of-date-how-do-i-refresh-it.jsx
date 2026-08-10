// Help center article: The app looks broken or out of date, how do I refresh it?

export default {
  summary: "In a browser, a normal reload gets you the newest version; if things still look off, do a hard refresh (Ctrl+Shift+R on desktop). On the Android app, check for the in-app Update banner and fully close and reopen the app after updating. The desktop app fixes itself: quit it completely and relaunch.",
  updated: "2026-07-02",
  body: [
    {
      h2: "Browser and iPhone home-screen app"
    },
    {
      steps: [
        "Reload the page. New releases arrive on a plain reload.",
        "Still broken? Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac) forces the browser to drop everything cached.",
        "On the iPhone home-screen app: close it fully (swipe it away) and reopen."
      ]
    },
    {
      h2: "Android app"
    },
    {
      steps: [
        "Open the app and look for the Update banner: if one shows, tap Update and allow the install.",
        "After any update, close VERGR fully (swipe away from recent apps) and reopen it, half-closed apps can keep old screens in memory.",
        "No banner and still glitchy? Force-stop the app in Android settings and reopen."
      ]
    },
    {
      h2: "Windows desktop app"
    },
    {
      p: "The desktop app updates itself at launch, so the fix is simply: quit it completely (not just close the window) and start it again."
    },
    {
      note: "Visual glitches that survive all of the above, like missing icons or unreadable text, have their own article below."
    },
    {
      cta: [
        { to: "/platform/help/icons-or-text-look-broken-what-do-i-do", label: "Broken icons or text" },
        { to: "/platform/help/how-do-i-update-the-vergr-app", label: "How updates work" }
      ]
    }
  ]
};
