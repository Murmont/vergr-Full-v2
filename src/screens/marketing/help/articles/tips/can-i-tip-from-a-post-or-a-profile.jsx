// Help center article: Can I tip from a post or a profile?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Yes. You can tip from several places, not just live streams: on a post you like, on a creator's profile, and during a live stream. Wherever you see a tip button, you choose an amount in Coins and send. The creator keeps 90% of every tip, the same flat 10% fee applies everywhere.",
  updated: "2026-06-06",
  body: [
    {
      p: "Tipping is not limited to streams. If a clip made you laugh or a creator is doing great work, you can show it right where you found them."
    },
    {
      h2: "Where you can tip"
    },
    {
      list: [
        "On a post. Tip directly from a post in your feed to reward something you enjoyed.",
        "On a profile. Open someone's profile and use the tip option to support them generally.",
        "On a live stream. Tip while watching, where it shows up live for the streamer.",
        "Through a Vergr.me tip jar, if the creator has one set up on their link-in-bio page."
      ]
    },
    {
      h2: "How it works"
    },
    {
      steps: [
        "Tap the tip button on the post, profile, or stream.",
        "Choose an amount in Coins.",
        "Confirm. The creator receives 90% of the tip; the flat 10% fee is taken at send time."
      ]
    },
    {
      note: "You need enough Coins to cover the tip. If you are short, buy Coins first, then tip."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-tip-a-creator",
          label: "How to tip a creator"
        },
        {
          to: "/platform/help/how-much-does-the-creator-actually-receive-from-my-tip",
          label: "What the creator receives"
        }
      ]
    }
  ]
};
