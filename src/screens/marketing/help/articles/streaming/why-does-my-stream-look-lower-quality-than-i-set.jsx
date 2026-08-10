// Help center article: Why does my stream look lower quality than I set?

export default {
  summary: "Because VERGR protects your stream's stability over its sharpness. When you go live, your real upload speed is measured and the starting quality is capped to what your connection can safely carry; if the connection struggles mid-stream, smoothness is reduced temporarily and a \"quality lowered\" notice appears. It recovers automatically once the connection calms down.",
  updated: "2026-07-02",
  body: [
    {
      h2: "The two moments quality can drop"
    },
    {
      list: [
        "At the start: going live begins with a quick connection test, and the starting quality is capped to a safe share of your measured upload. If your plan allows 1080p but your upload cannot carry it reliably, you start lower on purpose.",
        "Mid-stream: if your connection starts falling behind, the stream sheds load (smoothness first) to avoid stuttering and disconnection. You will see a warning that quality was lowered, and it climbs back automatically after the connection has been calm for a while."
      ]
    },
    {
      h2: "Why this is the right trade"
    },
    {
      p: "Viewers forgive soft edges; they do not forgive freezing. A stream that keeps buffering bleeds its audience in minutes. Adaptive quality keeps you live and watchable through network turbulence that would otherwise end the broadcast."
    },
    {
      h2: "Getting the quality you paid for"
    },
    {
      list: [
        "Fix the bottleneck, not the setting: the cap follows your real upload. Wired connection, quiet network, closer to the router.",
        "Check your plan's ceiling: Free streams at up to 480p, Lite 720p60, Pro 1080p60. The stream can never exceed the plan cap.",
        "Mind the device too: a maxed-out PC or hot phone encodes worse. Close what you do not need."
      ]
    },
    {
      cta: [
        { to: "/platform/help/what-internet-speed-do-i-need-to-stream", label: "Bandwidth guide" },
        { to: "/platform/help/what-does-each-plan-include", label: "Plan quality ceilings" }
      ]
    }
  ]
};
