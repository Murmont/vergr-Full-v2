// Help center article: How do I go live on VERGR?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "You can go live straight from your browser using your camera, your screen, or both, or stream from OBS with a stream key. Set a title, pick your game, add a tip goal, and hit Go Live. On the free plan you need 100 followers and a one-time 50-coin Stream Boost first. Lite and Pro stream from day one.",
  updated: "2026-06-06",
  body: [
    {
      p: "Going live on VERGR takes a couple of minutes, and you do not need any extra software to start. You can broadcast right from your browser, or wire up OBS if you already have a setup you like. Either way the stream lands on your profile, shows up in discovery, and your viewers can tip you in real time while you play."
    },
    {
      p: "There is one thing to sort out before your first public stream, and it depends on your plan. So start there, then pick how you want to broadcast."
    },
    {
      h2: "Check the requirement for your plan"
    },
    {
      p: "On the free plan, going live publicly needs 100 followers and a one-time 50-coin Stream Boost. The boost is not money that vanishes. It refunds itself out of the first 50 coins of tips you earn, and while it is active it pushes your stream harder in discovery so more people find you. It exists to keep public streaming feeling alive instead of empty."
    },
    {
      p: "If you are on Lite or Pro, none of that applies. There is no follower requirement and no boost, you can go live from the day you sign up. Squad streams are different too, you can run a squad hangout with your crew without hitting the follower mark at all."
    },
    {
      h2: "Go live from your browser"
    },
    {
      steps: [
        "Open Go Live from the create menu or from your profile.",
        "Allow camera and microphone access when your browser asks, then pick which camera and mic to use if you have more than one.",
        "Choose your layout: camera only, screen share only, or your screen with your face in the corner.",
        "Add a title, pick the game you are playing, and add a few tags so the right viewers find you.",
        "Optionally set a tip goal and upload a cover image so your stream looks sharp in discovery.",
        "Hit Go Live. You are now public, in discovery, and your chat is open."
      ]
    },
    {
      h2: "Or stream from OBS"
    },
    {
      p: "If you already use OBS or a similar tool, VERGR gives you a stream key. Drop it into your software's stream settings, set your encoder to match the quality your plan allows, and start streaming. Your broadcast shows up on VERGR exactly like a browser stream, with the same chat, the same tips, and the same discovery. This is the route most people take once they want overlays, scenes, and a proper mic chain."
    },
    {
      h2: "What quality you get"
    },
    {
      p: "Streaming quality is set by your plan. Free streams at 480p, Lite at 720p, and Pro at 1080p with co-streaming on top. VERGR runs one clean quality rather than a stack of versions, so the trick is simple: set your encoder at or below your plan's cap and the stream stays smooth. If you push the bitrate past the cap, the system eases it back down so your viewers are not stuck buffering."
    },
    {
      h2: "Tools you get while you are live"
    },
    {
      p: "A VERGR stream is not just a video feed. You can launch a poll to get the chat involved, set or raise a tip goal mid-stream, and clip a great moment on the spot so it instantly becomes a post on your profile. For moderation you can switch on slow mode, limit chat to followers only, pin a message, mute or ban someone, and set words you never want to see. When you wrap up, ending the stream gives you a recap with your peak viewers, tips earned, and new followers."
    },
    {
      note: "Want someone else on screen with you? Co-streaming is a Pro feature, and you invite a co-host from the live screen once you are already broadcasting."
    },
    {
      faq: [
        [
          "Do I need a camera to go live?",
          "No. You can stream just your screen, just your camera, or both at once. Screen-only is the common choice for gameplay, and you can add your camera later in the same session."
        ],
        [
          "Can I schedule a stream for later?",
          "Yes. On the Go Live screen you can switch to scheduling, pick a date and time, and set it up in advance. Your followers can be reminded before you start so people are waiting when you go live."
        ],
        [
          "Will my followers know when I go live?",
          "If you leave the notify option on, your followers get a heads-up the moment you start. Turning it on before a session is one of the easiest ways to get more people in early."
        ],
        [
          "Why does my stream look lower quality than I set?",
          "Either your plan caps you at a lower resolution, or your encoder bitrate went over the cap and the system trimmed it to protect playback. Match your encoder to your plan's quality and it will hold."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/do-i-need-followers-to-go-live",
          label: "Do I need followers to go live?"
        },
        {
          to: "/platform/help/what-are-all-the-ways-to-make-money-on-vergr",
          label: "Ways to make money"
        }
      ]
    }
  ]
};
