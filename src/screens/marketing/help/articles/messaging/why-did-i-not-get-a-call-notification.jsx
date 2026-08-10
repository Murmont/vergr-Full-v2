// Help center article: Why did I not get a call notification?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Incoming voice and video calls ring with a full-screen alert and a ringtone while you have VERGR open. They are real-time, so if the app is fully closed in the background you may not get a ring the way a regular phone call would. Browsers also need you to have interacted with the app before they will play a ringtone sound. Missed calls still appear in your call history.",
  updated: "2026-06-18",
  body: [
    {
      p: "Calls on VERGR are live, peer-to-peer connections, not stored messages. That shapes how the ring works and explains the most common reasons a call slips past you."
    },
    {
      h2: "How an incoming call rings"
    },
    {
      p: "When someone calls you and you have the app open, a full-screen incoming-call alert appears with the caller's name and a ringtone, and you can accept or decline. This happens in real time, the moment they call."
    },
    {
      h2: "Common reasons you missed one"
    },
    {
      list: [
        "The app was fully closed. Because calls are live, the reliable place to receive a ring is with VERGR open or running. If it was completely shut, there may be no ring at all.",
        "No ringtone sound yet. Browsers block sound until you have interacted with the page. If you had just loaded the app and not tapped anything, the alert can appear without the ringtone playing.",
        "The other side hung up quickly. A short call that was cancelled before you reached the screen still lands in your history as missed.",
        "Connection trouble on either side. Peer-to-peer calls need both networks to cooperate; a very restrictive network or VPN can stop the call connecting."
      ]
    },
    {
      h2: "Check your call history"
    },
    {
      p: "Missed calls are logged. Open Calls to see recent calls, with missed ones marked, so you can call the person back with one tap even if you did not catch the ring."
    },
    {
      note: "Calls are different from message notifications. A missed call is a real-time event, whereas a message can wait for you. If you need to be sure to reach someone, a message is the more reliable way to leave something they will see later."
    },
    {
      faq: [
        [
          "Will I get a call ring if the app is closed?",
          "Live calls ring most reliably with the app open. If it is fully closed, you may not be alerted in real time, but the missed call still shows in your history."
        ],
        [
          "I saw the screen but heard nothing.",
          "The browser had not been allowed to play sound yet. Interact with the app once (a tap anywhere) and ringtones will play on later calls."
        ],
        [
          "How do I call them back?",
          "Open Calls, find the missed call in Recent, and tap to call again."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-make-a-voice-or-video-call",
          label: "Make a voice or video call"
        },
        {
          to: "/platform/help/how-do-i-manage-app-permissions",
          label: "Manage app permissions"
        }
      ]
    }
  ]
};
