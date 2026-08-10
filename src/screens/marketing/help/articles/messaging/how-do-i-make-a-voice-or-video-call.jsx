// Help center article: How do I make a voice or video call?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Open a chat and tap the call or video icon, or go to the Calls screen, search for someone, and pick audio or video. Calls connect device-to-device (peer-to-peer), and audio and video calls are free for everyone. The other person sees a full-screen incoming call with a ringtone while the app is open.",
  updated: "2026-06-18",
  body: [
    {
      p: "One-to-one voice and video calls are built in and free for all plans. They connect directly between the two devices (peer-to-peer), so quality depends mostly on both connections."
    },
    {
      h2: "Start a call from a chat"
    },
    {
      steps: [
        "Open the conversation with the person you want to call.",
        "Tap the phone icon for a voice call, or the video icon for a video call (also available from the chat details quick actions).",
        "Wait while it rings. When they answer, the call connects.",
        "Use the on-screen controls to mute, turn your camera on or off, switch to speaker, or end the call."
      ]
    },
    {
      h2: "Start a call from the Calls screen"
    },
    {
      steps: [
        "Open Calls.",
        "Search for the person by name or username.",
        "Tap the phone icon for audio or the video icon for video.",
        "Your recent calls are listed here too, so you can call someone back with one tap."
      ]
    },
    {
      h2: "During a call"
    },
    {
      list: [
        "Mute or unmute your microphone.",
        "On a video call, turn your camera off or on, and flip between front and rear cameras.",
        "On a voice call, toggle the speaker.",
        "End the call with the red button. It then shows up in your call history."
      ]
    },
    {
      note: "These are one-to-one calls. For a group of people talking together, use a voice channel instead, which is a separate room-style feature."
    },
    {
      faq: [
        [
          "Are calls free?",
          "Yes. Voice and video calls are free on every plan. They use your internet connection, not phone minutes."
        ],
        [
          "It says connection failed.",
          "Peer-to-peer calls depend on both networks. Try switching between WiFi and mobile data, then hit Retry. A very restrictive network or VPN can block the direct connection."
        ],
        [
          "Can I call a whole group at once?",
          "Group calling is not part of one-to-one calls. Use a voice channel for several people in one room."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-voice-channels-work",
          label: "How voice channels work"
        },
        {
          to: "/platform/help/why-did-i-not-get-a-call-notification",
          label: "Why did I miss a call?"
        }
      ]
    }
  ]
};
