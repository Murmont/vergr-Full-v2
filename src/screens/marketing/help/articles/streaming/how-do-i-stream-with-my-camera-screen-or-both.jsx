// Help center article: How do I stream with my camera, screen, or both?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "On the Go Live screen you pick your layout: camera only, screen only, or your screen with your face in the corner (a facecam). On desktop you can share your screen and keep your camera running at the same time, with a picture-in-picture layout. On a phone, browsers cannot screen-share, so phone streams are camera-based.",
  updated: "2026-06-18",
  body: [
    {
      p: "VERGR lets you stream whatever fits what you are doing. Just chatting? Camera only. Showing gameplay? Screen with your face in the corner. Walking through something on your desktop? Screen only. You choose the layout on the Go Live screen and can change scenes as you go on desktop."
    },
    {
      h2: "Your layout options"
    },
    {
      list: [
        "Camera only: just your webcam or phone camera. Good for talking, reacting, and chatting with viewers.",
        "Screen only: just your screen or a window. Good for tutorials or showing software, when your face is not needed.",
        "Screen with facecam: your screen as the main view with your camera in the corner. The classic gameplay setup.",
        "Side by side and picture-in-picture variations on desktop, so you can arrange screen and camera the way you like."
      ]
    },
    {
      h2: "Desktop: screen and camera together"
    },
    {
      p: "On desktop you can run your camera and a screen share at the same time. When you add a screen share, your camera stays alive as a picture-in-picture layer rather than being swapped out, so viewers see your gameplay with your face over it. The layout is baked into the single video everyone watches, so it looks the same on every device, desktop, tablet, or phone."
    },
    {
      p: "Use the Layout control on the broadcast toolbar to switch presets, move your facecam to a different corner, or drop in a scene card like Starting soon or Be right back between segments."
    },
    {
      h2: "Phone streaming"
    },
    {
      p: "Phone browsers cannot capture your screen, so phone streams are camera-based. You still get plenty of control: flip between the front and rear camera at any time, and turn on Studio mode before you go live for extra layouts like dual camera (your selfie over the rear view) and scene cards. Studio mode is off by default because the simple direct camera path is the most reliable, so flip it on only when you want the extra layouts."
    },
    {
      note: "Want to share your screen and your face on the go? Stream from a desktop or laptop. That is the only place browser screen-sharing works."
    },
    {
      faq: [
        [
          "Can I add my camera after I have started screen-sharing?",
          "On desktop, yes. Toggling screen share keeps your camera running and adds the screen as a layer, so you can bring your face in or out without ending the stream."
        ],
        [
          "Will my facecam cover the gameplay?",
          "No. It sits in a corner as a small picture-in-picture overlay, and you can move it to whichever corner is out of the way."
        ],
        [
          "Why can I not share my screen from my phone?",
          "Mobile browsers do not allow screen capture. It is a platform limit, not a VERGR setting. Use a computer for screen sharing."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-go-live-on-vergr",
          label: "How to go live"
        },
        {
          to: "/platform/help/what-streaming-quality-do-i-get-on-my-plan",
          label: "Streaming quality by plan"
        }
      ]
    }
  ]
};
