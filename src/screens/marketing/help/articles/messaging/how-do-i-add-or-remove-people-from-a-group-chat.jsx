// Help center article: How do I add or remove people from a group chat?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Open the group, go to Group Info, and use the Members section. Admins can add people (from your network or by username search) and remove members. The group creator is the owner and cannot be removed. Every add, remove, rename, and leave is announced in the thread so nobody is surprised.",
  updated: "2026-06-18",
  body: [
    {
      p: "Group membership is managed from Group Info. Tap the group name or header at the top of the chat to open it. What you can do there depends on whether you are an admin."
    },
    {
      h2: "Who can change membership"
    },
    {
      p: "Admins add and remove people. The group creator is always an admin (shown as Owner) and can promote other members to admin, who can then manage members too. Regular members can read and chat, but cannot add or remove anyone."
    },
    {
      h2: "Add someone"
    },
    {
      steps: [
        "Open the group and tap the header to open Group Info.",
        "In the Members section, tap Add (admins only).",
        "Pick from your network (people you follow or who follow you) or search by username.",
        "Tap Add next to each person.",
        "A message like \"You added (name)\" appears in the thread so everyone sees who joined."
      ]
    },
    {
      h2: "Remove someone"
    },
    {
      steps: [
        "Open Group Info and find the person in the Members list.",
        "Tap the remove icon next to their name (admins only).",
        "Confirm. They are taken out of the group and a \"removed (name)\" note is posted in the thread."
      ]
    },
    {
      h2: "Admins"
    },
    {
      p: "Next to a member, an admin can tap the shield icon to make that person an admin, or tap it again to remove admin. The Owner (creator) keeps their badge and cannot be removed or demoted by anyone else."
    },
    {
      note: "Leaving is different from being removed. Anyone can leave a group themselves from Group Info (Leave Group), which posts a \"left the group\" note in the thread."
    },
    {
      faq: [
        [
          "Can I stop everyone except admins from posting?",
          "Yes. An admin can switch on \"Only admins can send messages\" in Group Info. Members can still read everything, they just cannot send until it is turned off."
        ],
        [
          "Someone I removed keeps the old messages, right?",
          "They keep whatever they already received, but they stop getting anything new and cannot rejoin a private group unless an admin adds them back."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-start-a-group-chat",
          label: "Start a group chat"
        },
        {
          to: "/platform/help/how-do-i-leave-or-delete-a-conversation",
          label: "Leave or delete a conversation"
        }
      ]
    }
  ]
};
