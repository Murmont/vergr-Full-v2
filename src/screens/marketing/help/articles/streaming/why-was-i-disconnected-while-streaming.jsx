// Help center article: Why was I disconnected while streaming?

export default {
  summary: "Almost always the internet connection: streaming pushes data upstream continuously, and upload is the weakest part of most connections. Wifi hiccups, other devices hogging bandwidth, or your ISP wobbling all cut a stream. If your connection is genuinely fine, check whether your device was throttling the app: closing the streaming tab, phone sleep, or aggressive battery savers all stop the broadcast.",
  updated: "2026-07-02",
  body: [
    {
      h2: "The usual causes"
    },
    {
      list: [
        "Upload bandwidth dips: streaming needs a steady upstream. Downloads elsewhere in the house, cloud backups, and game updates all steal it.",
        "Wifi instability: walls, distance, and interference cause micro-dropouts that kill a live connection. Wired beats wifi for streaming, always.",
        "The device throttled you: phones pause apps in the background and under battery-saver, and closing the browser tab you stream from ends the broadcast.",
        "Overloaded hardware: if the device is maxed out running the game plus the stream, the encoder starves and drops."
      ]
    },
    {
      h2: "Making it stick"
    },
    {
      steps: [
        "Use ethernet if you possibly can; if not, stream close to the router on 5GHz wifi.",
        "Keep the streaming app or tab in the foreground, plugged in, with battery saver off (mobile).",
        "Quiet the network: pause downloads and backups on other devices while live.",
        "Let quality adapt: VERGR measures your connection when you go live and adjusts to protect stability. If you see a quality-lowered notice, that is the system saving your stream, not breaking it."
      ]
    },
    {
      note: "If you do drop, do not panic: viewers see the stream pause, and reconnecting quickly usually carries most of them through. A stream that stays dropped is auto-ended a few minutes later."
    },
    {
      cta: [
        { to: "/platform/help/what-internet-speed-do-i-need-to-stream", label: "Bandwidth requirements" },
        { to: "/platform/help/why-does-my-stream-look-lower-quality-than-i-set", label: "Quality adaptation" }
      ]
    }
  ]
};
