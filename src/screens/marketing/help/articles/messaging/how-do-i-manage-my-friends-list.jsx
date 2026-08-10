// Help center article: How do I manage my friends list?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "VERGR does not use a separate add-friend system. Your Friends list is the people you follow, and you manage it by following and unfollowing. From the Friends screen in Messages you can search that list and start a chat with one tap. To stop hearing from someone, block them.",
  updated: "2026-06-18",
  body: [
    {
      p: "There is no \"send a friend request, wait for them to accept\" step on VERGR. Connections are built on following, the same as the rest of the app. Your Friends list is simply everyone you currently follow, in one place that is easy to message from."
    },
    {
      h2: "Where your Friends list lives"
    },
    {
      p: "Open Messages and go to Friends. It lists everyone you follow, with a search box to find someone fast and a Message button on each row that opens (or starts) a direct chat with them. Tapping a name opens their profile."
    },
    {
      h2: "Adding and removing people"
    },
    {
      list: [
        "To add someone, follow them. Find them in Explore or on their profile and tap Follow. They appear in your Friends list right away.",
        "To remove someone, unfollow them from their profile. They drop off your Friends list.",
        "Following someone does not force a chat, it just makes them easy to reach and lets them skip your message requests."
      ]
    },
    {
      h2: "Mutual connections matter for messaging"
    },
    {
      p: "Your privacy settings can limit who messages you to \"people you follow or who follow you\". So building your follow list is also what decides who can reach you directly versus who lands in message requests."
    },
    {
      note: "Blocking is the opposite of friending. A blocked user cannot message or call you, and you will not see them. Manage blocked users in Settings, then Blocked Users."
    },
    {
      faq: [
        [
          "Is there a friend request to approve?",
          "No. Following is one-directional and instant. Mutual follows are what most people mean by \"friends\" here."
        ],
        [
          "How do I quickly message a friend?",
          "Open Messages, go to Friends, search their name, and tap Message. It opens the existing chat or starts a new one."
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
          to: "/platform/help/how-do-message-requests-work",
          label: "How message requests work"
        }
      ]
    }
  ]
};
