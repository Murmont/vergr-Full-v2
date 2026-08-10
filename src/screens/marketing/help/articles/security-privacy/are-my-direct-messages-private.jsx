// Help center article: Are my direct messages private?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Yes. Your direct messages and group chats are private. Conversations are not stored on a central server to be read later, they live on your device, and VERGR does not scan private messages with moderation tools. Only public surfaces are moderated.",
  updated: "2026-06-06",
  body: [
    {
      p: "Yes, your private conversations on VERGR are genuinely private. This is a deliberate design choice, not a vague promise."
    },
    {
      h2: "How private messaging works"
    },
    {
      p: "Your direct messages and group chats are not kept on a server for anyone to read back later. They are delivered and held on your device. That means the contents of your conversations are not sitting in a database to be mined, leaked, or scanned."
    },
    {
      h2: "Moderation does not read your DMs"
    },
    {
      p: "VERGR's automated moderation only looks at public surfaces, like public posts and live-stream chat. It does not scan your private messages. So you can talk freely with friends and your squad without an AI reading over your shoulder."
    },
    {
      h2: "You still control your inbox"
    },
    {
      list: [
        "Decide who can message you.",
        "Use message requests to screen people you do not follow.",
        "Block anyone instantly.",
        "Report a conversation if someone crosses a line."
      ]
    },
    {
      note: "Calls are private too. If you ever feel unsafe, blocking and reporting are always available."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-control-who-can-message-me",
          label: "Control who can message you"
        },
        {
          to: "/platform/help/how-do-i-block-someone",
          label: "Block someone"
        }
      ]
    }
  ]
};
