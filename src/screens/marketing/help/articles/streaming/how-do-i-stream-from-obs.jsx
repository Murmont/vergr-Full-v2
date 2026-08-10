// Help center article: How do I stream from OBS?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "On the Go Live screen, choose the OBS / RTMP option instead of browser broadcast. VERGR then gives you an RTMP URL and a stream key on the broadcast screen. Paste them into OBS under Settings then Stream (Service: Custom), set your bitrate at or below your plan's cap with a 2-second keyframe interval, and hit Start Streaming. Your broadcast appears on VERGR with the same chat, tips, and discovery as a browser stream.",
  updated: "2026-06-18",
  body: [
    {
      p: "If you already run OBS, Streamlabs, or any RTMP-capable software, you can pipe it straight into VERGR. This is the route most people take once they want scenes, overlays, alerts, and a proper mic chain. Your OBS broadcast shows up on VERGR exactly like a browser stream: same chat, same tips, same discovery."
    },
    {
      h2: "Connect OBS to VERGR"
    },
    {
      steps: [
        "On VERGR, open the Go Live screen and set up your stream (title, game, tags, cover, tip goal).",
        "For the broadcast method, choose OBS / RTMP instead of Browser broadcast.",
        "Start the session. The broadcast screen then shows your RTMP URL and your Stream key. Treat the key like a password: anyone with it can stream as you.",
        "In OBS, go to Settings, then Stream. Set Service to Custom and paste the RTMP URL into Server and the key into Stream Key.",
        "In Settings then Output, set your video bitrate at or below your plan's cap (480p free, 720p Lite, 1080p Pro) with a 2-second keyframe interval.",
        "Click OK, build your scene, then hit Start Streaming in OBS.",
        "Back on VERGR, confirm your stream is live and your chat is open."
      ]
    },
    {
      h2: "Encoder settings that hold up"
    },
    {
      list: [
        "Resolution and bitrate: keep them at or below your plan cap. The VERGR setup screen shows the exact kbps ceiling, and higher bitrates are throttled.",
        "Keyframe interval: 2 seconds, which VERGR recommends on the OBS setup card.",
        "Encoder: hardware encoding (NVENC, AMF, or Apple VT) if your machine has it, so streaming does not eat your game's frame rate.",
        "Audio: confirm the right mic and desktop audio sources are in your OBS audio mixer before you start."
      ]
    },
    {
      note: "Your RTMP URL and stream key are tied to your broadcast session. Keep the key private, the same way you would your Twitch or YouTube key.",
    },
    {
      faq: [
        [
          "Where do I find the RTMP URL and stream key?",
          "Choose OBS / RTMP on the Go Live screen and start the broadcast. The broadcast screen then displays your RTMP URL and Stream key to copy into OBS."
        ],
        [
          "Can I also push this stream to Twitch?",
          "There is a separate option to forward your VERGR broadcast out to Twitch, so you can reach both. Note that the main Twitch mirror works the other way (it brings your Twitch stream onto VERGR). See the Twitch help section."
        ],
        [
          "My OBS says connected but nothing shows on VERGR.",
          "Double-check the RTMP URL and key are pasted correctly with no extra spaces, that your bitrate is within the cap, and that you actually clicked Start Streaming in OBS."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-stream-directly-from-my-browser",
          label: "Stream from your browser instead"
        },
        {
          to: "/platform/help/how-do-i-connect-my-twitch-account-so-my-streams-show-on-vergr",
          label: "Connect Twitch"
        }
      ]
    }
  ]
};
