// Help center article: I can not go live, what do I do?

export default {
  summary: "The most common reason on a free account is the follower gate: public streaming unlocks at 100 followers, and the Go Live button tells you how many you still need. Squad streams have no gate, so you can stream to your squad right now. Otherwise it is usually camera permission or a connection issue, both fixable in a minute.",
  updated: "2026-07-02",
  body: [
    {
      h2: "Check these, in order"
    },
    {
      steps: [
        "Read the Go Live button. If it says a number of followers to go, that is the answer: free accounts unlock public streaming at 100 followers. The banner above it shows your progress, and Stream to my Squad works immediately with no gate. Lite and Pro accounts skip the gate entirely.",
        "Camera and microphone permission: if the preview is black, your browser or phone has blocked access. Allow camera and microphone for VERGR in your browser's site settings (or the app's permissions on Android), then reload.",
        "Connection: going live needs steady upload bandwidth. On hotel wifi or weak mobile data the start can fail: try another network or move closer to the router.",
        "Reload and retry: a plain refresh clears most one-off glitches."
      ]
    },
    {
      h2: "If the button is there but the stream will not start"
    },
    {
      list: [
        "Close other apps or tabs that might be using the camera (video calls grab it and do not let go).",
        "Try the opposite path: if browser streaming fails, the app, and vice versa.",
        "If you were mid-setup when it failed, back out to the Go Live screen and start fresh."
      ]
    },
    {
      cta: [
        { to: "/platform/help/how-do-i-go-live-on-vergr", label: "Going live, step by step" },
        { to: "/platform/help/my-camera-or-microphone-is-not-working-what-do-i-do", label: "Camera and mic fixes" }
      ]
    }
  ]
};
