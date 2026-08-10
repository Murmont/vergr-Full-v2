// Help center article: What is the minimum tip?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Tips are small by design, so you can send just a few Coins to show appreciation. The exact minimum is shown on the tip screen when you pick an amount, along with quick preset amounts. Whatever you send, the creator keeps 90% and the flat 10% fee comes out of the tip.",
  updated: "2026-06-06",
  body: [
    {
      p: "You do not need to send a lot to make tipping worthwhile. Tips are meant to be quick and low-friction, the kind of thing you do on impulse when something is good."
    },
    {
      h2: "How small can a tip be?"
    },
    {
      p: "The tip screen shows the minimum amount and a row of preset amounts so you can send in a tap. Because Coins are a small unit, even a modest tip is a real and welcome signal to a creator, especially when a stream chat sees several land in a row."
    },
    {
      h2: "Good to know"
    },
    {
      list: [
        "The creator receives 90% of whatever you tip; the flat 10% fee is taken from the tip, not added on top.",
        "Because the creator's share is rounded down to a whole Coin, very tiny tips lose a little to rounding, so the presets are a sensible floor.",
        "You can tip as many times as you like, lots of small tips add up just like one larger one."
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-tip-a-creator",
          label: "How to tip"
        },
        {
          to: "/platform/help/how-much-does-the-creator-actually-receive-from-my-tip",
          label: "What the creator receives"
        }
      ]
    }
  ]
};
