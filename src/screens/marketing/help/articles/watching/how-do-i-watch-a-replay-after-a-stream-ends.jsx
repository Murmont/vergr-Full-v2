// Help center article: How do I watch a replay after a stream ends?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Open the stream after it has ended and tap Watch replay. Replays exist for streamers on Pro, whose broadcasts are saved automatically and stay up for 90 days. Streams on Free and Lite are not recorded, so those broadcasts leave no replay behind.",
  updated: "2026-07-14",
  body: [
    {
      p: "Missed a stream live? If the streamer is on Pro, you can still watch it. Their broadcasts are saved automatically when they end, so the same stream link turns into a replay."
    },
    {
      h2: "Find a replay"
    },
    {
      steps: [
        "Open the stream: the same link where you watched it, or a link someone shared.",
        "If the stream has ended, the page says so.",
        "If a replay exists, tap Watch replay to play the recording.",
        "Scrub through it like any recorded video."
      ]
    },
    {
      h2: "Not every stream leaves a replay"
    },
    {
      list: [
        "The streamer is on Free or Lite. Recording broadcasts is a Pro feature, so their stream was not saved.",
        "It is more than 90 days since a Pro stream ended, and the replay has expired.",
        "The stream ran for less than two minutes.",
        "It was broadcast from OBS, which is not archived yet.",
        "It only just ended: the recording takes a few minutes to process, so check back shortly."
      ]
    },
    {
      p: "Following a streamer is still the surest way to catch the next one. Clips are the other exception: any clip taken during a stream lives on as its own post, on every plan, whether or not a replay was kept."
    },
    {
      note: "Replays keep the same restrictions the live stream had. A followers-only stream needs you to be following, and a ticketed event's replay needs a ticket, just like watching it live did."
    },
    {
      faq: [
        [
          "Can I tip or chat on a replay?",
          "A replay is a recording, so the live chat and live tipping happened during the broadcast. You can still tip the creator on their profile and engage with their posts."
        ],
        [
          "Can I clip from a replay?",
          "Clipping is built around the live stream. The best moments are usually clipped while the stream is live, by the streamer or by viewers, and those clips stay up permanently even after a replay expires."
        ],
        [
          "Why did a stream I watched leave no replay?",
          "Most likely the streamer is not on Pro. Recording full broadcasts is part of the Pro plan, so streams on Free and Lite are not saved."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-follow-a-streamer",
          label: "Follow a streamer"
        },
        {
          to: "/platform/help/do-my-streams-get-recorded",
          label: "Do streams get recorded?"
        }
      ]
    }
  ]
};
