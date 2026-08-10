// Help center article: How do I vote in a stream poll?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "When a streamer launches a poll, a card appears over the stream with the options and a countdown. Tap the option you want and your vote locks in. The live results (percentages and a bar per option) reveal once you have voted, and the poll closes when its timer runs out. Voting is free and you get one vote.",
  updated: "2026-06-18",
  body: [
    {
      p: "Polls are how streamers pull the room into a decision: which map, which loadout, what to do next. When one goes live, it appears over the stream or in the chat area. You just tap your choice and you are counted."
    },
    {
      h2: "Cast your vote"
    },
    {
      steps: [
        "Watch for the poll card to appear on the stream, with a countdown timer.",
        "Read the options the streamer set.",
        "Tap the one you want. Your vote locks in.",
        "Once you have voted, the results reveal: a percentage and a bar for each option, updating live until the timer ends."
      ]
    },
    {
      h2: "How polls behave"
    },
    {
      list: [
        "Results after you vote: you see the breakdown once you have picked an option (or once the poll closes), then it updates live.",
        "One vote each: you get a single vote, and it cannot be changed once cast.",
        "Time-limited: the poll runs on a countdown the streamer sets and closes when the timer ends.",
        "Free: voting never costs Coins."
      ]
    },
    {
      note: "Polls are just for fun and input during a stream. Nothing is staked on the outcome and nothing is paid out, so there is no reason to vote strategically."
    },
    {
      faq: [
        [
          "Can I change my vote?",
          "No. Your vote locks in once you tap an option. If the streamer runs a new poll, that is a fresh vote."
        ],
        [
          "I do not see a poll, where is it?",
          "There is only a poll when the streamer launches one. If there is none on screen, none is running right now."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-chat-during-a-stream",
          label: "Chat during a stream"
        },
        {
          to: "/platform/help/how-do-i-tip-a-streamer",
          label: "Tipping a streamer"
        }
      ]
    }
  ]
};
