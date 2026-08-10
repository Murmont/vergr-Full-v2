// Help center article: What internet speed do I need to stream?

export default {
  summary: "Upload speed is what matters, not the download number your provider advertises. Comfortable minimums: about 5 Mbps upload for Free-tier streaming (480p), about 8 Mbps for Lite (720p60), and about 10 Mbps or more for Pro (1080p60). VERGR tests your connection when you go live and sets a safe starting quality automatically.",
  updated: "2026-07-02",
  body: [
    {
      h2: "The quality tiers and what feeds them"
    },
    {
      list: [
        "Free plan: streams at up to 480p30, which uses about 3 Mbps of upload. A steady 5 Mbps upload gives it headroom.",
        "Lite plan: up to 720p60, about 4.5 Mbps of stream. Comfortable from around 8 Mbps upload.",
        "Pro plan: up to 1080p60, about 6.5 Mbps of stream. You want 10 Mbps of upload or better."
      ]
    },
    {
      h2: "Why headroom matters"
    },
    {
      p: "A connection that exactly matches the stream's needs fails the moment anything else touches the network. VERGR deliberately will not start you at a bitrate your connection can only just carry: when you go live, it measures your real upload and caps the starting quality to a safe share of it. Stability beats sharpness, a crisp stream that buffers loses viewers faster than a slightly softer one that never stutters."
    },
    {
      h2: "Checking your own connection"
    },
    {
      steps: [
        "Run any online speed test and read the UPLOAD figure.",
        "Test on the same connection you will stream on (that wifi spot, that cable).",
        "If upload is marginal, stream wired, or accept the lower quality tier gladly, viewers care about stutter, not pixels."
      ]
    },
    {
      cta: [
        { to: "/platform/help/why-does-my-stream-look-lower-quality-than-i-set", label: "Why quality adapts" },
        { to: "/platform/help/why-was-i-disconnected-while-streaming", label: "Disconnection causes" }
      ]
    }
  ]
};
