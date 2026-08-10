// Help center article: How do I choose my camera and microphone before going live?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "On the Go Live screen, allow camera and microphone access when your browser asks, then use the device pickers to choose which camera and which mic to use. You can preview yourself before you start, and on mobile you can flip between front and rear cameras. Nothing goes out until you actually hit Go Live.",
  updated: "2026-06-18",
  body: [
    {
      p: "Before you go live, you get to choose exactly which camera and microphone VERGR uses, and check how you look and sound first. This all happens on the Go Live setup screen, in the preview, so you are never guessing once you are on air."
    },
    {
      h2: "Set your camera and mic"
    },
    {
      steps: [
        "Open Go Live from the create menu or your profile.",
        "When your browser asks, allow camera and microphone access. Without this, the preview stays blank.",
        "Use the camera dropdown to pick which camera to use if you have more than one (webcam, capture card, virtual cam).",
        "Use the microphone dropdown to pick your mic. Speak and watch the input indicator move so you know the right one is selected.",
        "Check the preview. Adjust framing and lighting now, while only you can see it.",
        "When it looks and sounds right, set your title and game and hit Go Live."
      ]
    },
    {
      h2: "On a phone"
    },
    {
      p: "Streaming from a phone, the camera picker lists your front and rear cameras, so you choose which one to start with. Once you are live, the camera-switch button flips between front and rear instantly. Front camera is the usual choice for a face cam, rear is handy if you want to show something in the room. Your phone's mic is used by default, and a wired or Bluetooth headset mic will show up as an option if one is connected."
    },
    {
      h2: "If a device is missing or wrong"
    },
    {
      list: [
        "Blank preview or no mic options usually means the browser blocked access. Open your browser's site permissions for VERGR and set camera and microphone to Allow, then reload.",
        "If the device you want is not listed, make sure it is plugged in and not in use by another app (close OBS, Zoom, or another tab using it), then reopen the picker.",
        "On desktop, a capture card or external webcam needs to be connected before you open the Go Live screen for it to appear."
      ]
    },
    {
      note: "Going screen-only? You do not need a camera at all. You can stream just your screen, just your camera, or both. The mic still matters for talking over your gameplay."
    },
    {
      faq: [
        [
          "Can I change camera or mic mid-stream?",
          "On a phone you can flip the camera while live. For a full device swap on desktop, it is cleanest to set it before you go live, since changing capture devices mid-broadcast can interrupt the feed."
        ],
        [
          "Why is my mic picking up the wrong sound?",
          "You probably have the wrong input selected. Open the mic dropdown, pick the correct device, and watch the level indicator react when you speak to confirm."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-stream-with-my-camera-screen-or-both",
          label: "Camera, screen, or both"
        },
        {
          to: "/platform/help/how-do-i-go-live-on-vergr",
          label: "How to go live"
        }
      ]
    }
  ]
};
