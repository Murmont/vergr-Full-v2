// Help center article: My video or clip will not play, what do I do?

export default {
  summary: "Reload first: most playback failures are a one-off loading hiccup. If it persists, check your connection, then your browser: VERGR video plays best in an up-to-date Chrome, Edge, Firefox, or Safari, and very old browsers or webviews may not support the modern video format at all.",
  updated: "2026-07-02",
  body: [
    {
      h2: "Work through these"
    },
    {
      steps: [
        "Reload the page or reopen the app. A stalled player almost always recovers on a fresh load.",
        "Check the connection: video needs more bandwidth than browsing. If other videos also stutter, it is the network, switch to wifi or wait out the congestion.",
        "Try another video: if everything else plays, the specific clip may still be processing shortly after upload. Give it a couple of minutes.",
        "Update your browser or the app: modern video needs a modern player. An out-of-date browser, or an old phone's built-in browser, may be unable to play it at all.",
        "If you use aggressive ad-blocking or privacy extensions, try the video with them paused: some block the video delivery itself."
      ]
    },
    {
      h2: "If it is YOUR upload that will not play"
    },
    {
      p: "Give it a few minutes after uploading, then reload. If your upload still will not play for you or others after that, delete and re-upload it: an interrupted upload can leave a broken file behind."
    },
    {
      cta: [
        { to: "/platform/help/the-app-is-slow-what-can-i-do", label: "If everything is slow" },
        { to: "/platform/help/my-upload-keeps-failing-what-do-i-do", label: "Upload problems" }
      ]
    }
  ]
};
