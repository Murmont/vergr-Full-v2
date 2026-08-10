// Help center article: How do I set up my Vergr.me page?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Open the Vergr.me editor from your settings or Creator Studio. Add your links, set your display name, bio, and socials, pick a theme and colours, switch on a tip jar if you want, then make it public. A live preview shows your changes as you go, and your page lives at your handle.",
  updated: "2026-06-06",
  body: [
    {
      p: "Setting up your Vergr.me page takes a few minutes, and a live preview shows exactly how it will look as you build it. Here is the flow."
    },
    {
      h2: "Open the editor"
    },
    {
      p: "You can reach the Vergr.me editor from your settings under the Vergr.me page entry, or from the Creator Studio. It opens as a focused full-screen editor with tabs for the different parts of your page."
    },
    {
      h2: "Build your page"
    },
    {
      steps: [
        "Set your display name, bio, and avatar or banner.",
        "Add your links and your social media handles.",
        "Reorder links by dragging them, and hide any you do not want shown.",
        "Pick a theme, accent colour, and button style to match your brand.",
        "Switch on the tip jar and any toggles like your follower count or a message button.",
        "Make the page public, then copy your link to share it."
      ]
    },
    {
      h2: "Preview as you go"
    },
    {
      p: "The editor shows a live phone-style preview, so what you see is what visitors get. Nothing publishes until you make the page public, so you can take your time getting it right."
    },
    {
      note: "Your page lives at your handle. Pro members can attach a custom domain for an even cleaner link."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-add-links-to-my-vergrme-page",
          label: "Add and order links"
        },
        {
          to: "/platform/help/how-do-i-add-a-tip-jar-to-my-vergrme-page",
          label: "Add a tip jar"
        }
      ]
    }
  ]
};
