// Help center article: How do I send a photo, clip, or voice message in chat?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "In any chat, tap the attachment (plus) button for photos, files, audio, your location, a contact, coins, and more. To record a voice message, hold the microphone button next to the composer. To record a short round video message, switch the record button to camera mode first. Photos and videos are compressed before they upload.",
  updated: "2026-06-18",
  body: [
    {
      p: "Chats are not just text. You can send images, video, voice notes, files, and a few VERGR-specific things like coins and event tickets. Here is where each one lives."
    },
    {
      h2: "Photos, videos, and files"
    },
    {
      p: "Tap the attachment button (the plus next to the message box) to open the attachment menu. From there you can pick:"
    },
    {
      list: [
        "Camera: take a photo right now.",
        "Gallery: choose a photo or video from your device.",
        "File: send a document or any file.",
        "Audio: send an audio file (like a music clip).",
        "Location: share where you are.",
        "Contact: share someone's contact.",
        "Send Coins: send coins to the person you are chatting with.",
        "Send a ticket: share an event ticket (where ticket-sharing is available)."
      ]
    },
    {
      p: "Photos and videos are compressed in your browser before they upload, so they send faster and use less data without you having to resize anything."
    },
    {
      h2: "Voice messages"
    },
    {
      p: "Next to the message box is a microphone button. Hold it to record. While holding, you can slide to cancel if you change your mind, or slide up to lock recording so you can keep talking hands-free, then send. Voice messages play back with a waveform and a speed control (1x, 1.5x, 2x), like the messengers you already use."
    },
    {
      h2: "Round video messages (clips)"
    },
    {
      p: "The record button can switch between microphone and camera. In camera mode it records a short round video message (a video note) that the other person taps to play. You can also send a longer video as a file through Gallery. Recorded clips play with their own tap-to-play controls, which work reliably on the mobile app too."
    },
    {
      note: "How large a file you can send depends on your plan. Free, Lite, and Pro have different upload limits. If a file is too big you will be told before it sends."
    },
    {
      faq: [
        [
          "Why did my voice message cancel?",
          "If you slid left (toward the cancel hint) while holding the mic, that cancels the recording. Hold and release in place to send, or slide up to lock it first."
        ],
        [
          "Can I review media before it sends?",
          "Photos and videos show a preview so you can confirm before sending. Voice messages send when you release (or tap send after locking)."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-send-a-direct-message",
          label: "Send a direct message"
        },
        {
          to: "/platform/help/how-do-i-change-my-chat-settings",
          label: "Change your chat settings"
        }
      ]
    }
  ]
};
