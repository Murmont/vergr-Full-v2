// Help center article: How do I stream directly from my browser?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Open Go Live, allow camera and microphone access, pick your layout (camera, screen, or both), add a title and game, and hit Go Live. No software, no stream key, no setup. Browser streaming is the fastest way to start and works on desktop and mobile, though screen sharing is desktop only.",
  updated: "2026-06-18",
  body: [
    {
      p: "Browser streaming is the no-install way to go live. You do not need OBS, a stream key, or any encoder settings. You open a page, grant access to your camera and mic, choose how you want to look, and start. It is the quickest path from idea to live, and for a lot of streamers it is all they ever need."
    },
    {
      h2: "Go live from the browser"
    },
    {
      steps: [
        "Open Go Live from the create menu or your profile.",
        "Allow camera and microphone access when your browser asks.",
        "Pick which camera and mic to use, and choose your layout: camera only, screen only, or screen with your face in the corner.",
        "Add a title, pick your game, and add a few tags so the right viewers find you.",
        "Optionally set a tip goal and a cover image.",
        "Hit Go Live. You are public, in discovery, and your chat is open."
      ]
    },
    {
      h2: "Browser vs OBS, when to use which"
    },
    {
      list: [
        "Browser: fastest start, nothing to install, great for chatting, reacting, and simple gameplay. Works on phone and desktop.",
        "OBS: scenes, overlays, alerts, and a tuned mic chain. Worth it once you want a more produced look. Needs the stream key.",
        "You can switch between them any time. Neither locks you in."
      ]
    },
    {
      p: "On desktop, browser streaming can share your screen and keep your camera running at the same time. On a phone, browsers cannot capture the screen, so phone browser streams are camera-based (with front and rear flip, and an optional Studio mode for dual camera and scene cards)."
    },
    {
      note: "Free plan reminder: public streaming needs 100 followers and a one-time 50-coin Stream Boost. Lite and Pro go live from day one. This applies the same whether you stream from the browser or OBS."
    },
    {
      faq: [
        [
          "Which browser works best?",
          "A current version of Chrome, Edge, or another modern browser. Make sure camera and microphone permissions are set to Allow for VERGR."
        ],
        [
          "The preview is blank, what is wrong?",
          "The browser most likely blocked camera access. Open site permissions for VERGR, set camera and microphone to Allow, and reload the page."
        ],
        [
          "Can I stream gameplay and my face from the browser?",
          "On desktop, yes, share your screen and keep your camera on for a facecam layout. On a phone, use the camera (screen sharing is not available in mobile browsers)."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-stream-from-obs",
          label: "Stream from OBS"
        },
        {
          to: "/platform/help/how-do-i-choose-my-camera-and-microphone-before-going-live",
          label: "Choose your camera and mic"
        }
      ]
    }
  ]
};
