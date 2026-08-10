export default {
  summary: "Go to Settings → Privacy and use the Message requests toggle. With it off, only people you follow can message you directly; everyone else lands in message requests for you to accept or ignore. You can also block anyone outright.",
  updated: "2026-06-07",
  body: [
    { h2: "Controlling who can DM you" },
    { steps: [
      "Open Settings → Privacy.",
      "Find Message requests.",
      "Turn it off to only receive direct messages from people you follow — others go to a separate requests area you can accept or decline.",
      "Turn it on to allow messages from anyone."
    ]},
    { h2: "Extra controls" },
    { list: [
      "Block: blocking someone stops them messaging, following, or interacting with you at all.",
      "Message requests: people you do not follow appear here first, so your main inbox stays clean.",
      "Report: you can report any message or conversation that breaks the rules.",
    ]},
    { cta: [
      { to: "/platform/help/how-do-message-requests-work", label: "How message requests work" },
      { to: "/platform/help/how-do-i-block-someone", label: "Blocking someone" }
    ]}
  ]
};
