// Help center article: How do voice channels work?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "A voice channel is a Discord-style room where several people talk together. Open one to join, and you stay connected even as you move around the app, with a floating control pill. Channels can be public (anyone can join) or private (invite-only). The owner can invite people, remove them, and delete the channel. You can also set each person's volume just for yourself.",
  updated: "2026-06-18",
  body: [
    {
      p: "Where a call is one-to-one, a voice channel is a shared room. People come and go, and everyone in it can talk. It is the right tool for hanging out, running a squad session, or just keeping an open line while you play."
    },
    {
      h2: "Joining a channel"
    },
    {
      p: "Open a voice channel to join it. Once connected, you see everyone in the room, who is currently speaking (their tile lights up green), and whether each person's mic is on. Your own tile shows your mic status. The session keeps running as you navigate elsewhere in the app, and a floating pill lets you control it from anywhere."
    },
    {
      h2: "Public and private channels"
    },
    {
      list: [
        "Public: anyone signed in can join.",
        "Private: only the owner and invited members can join. Everyone else sees a locked screen.",
        "The room header shows whether you are in a public or private channel and how many people are connected."
      ]
    },
    {
      h2: "Controls"
    },
    {
      list: [
        "Mute or unmute your own mic with the mic button.",
        "Leave the channel with the Leave button.",
        "Copy an invite link from the top of the channel to share it.",
        "Set another person's volume with the slider under their tile. This only changes what you hear, not what anyone else hears."
      ]
    },
    {
      h2: "If you own the channel"
    },
    {
      list: [
        "Invite members with the people icon (useful for private channels).",
        "Remove someone with the remove icon on their tile. They are dropped from the room and cannot rejoin a private channel unless re-invited.",
        "Delete the whole channel with the delete icon. This cannot be undone."
      ]
    },
    {
      note: "If you are removed or kicked while connected, the app notices and takes you out of the room automatically."
    },
    {
      faq: [
        [
          "Do I have to stay on the channel screen to keep talking?",
          "No. The voice session follows you around the app. A floating pill keeps your mic and leave controls handy wherever you go."
        ],
        [
          "Is turning someone's volume down the same as muting them for everyone?",
          "No. The volume slider only affects what you hear. It does not mute them for other people."
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
          to: "/platform/help/how-do-i-start-a-group-chat",
          label: "Start a group chat"
        }
      ]
    }
  ]
};
