export default {
  summary: "In the composer, use the toolbar to add media: the image button for photos and videos from your device, or the GIF button for GIFs, stickers, and clips. Everything is compressed automatically on upload so it loads fast.",
  updated: "2026-06-07",
  body: [
    { h2: "Adding media" },
    { list: [
      "Image button: pick photos or video from your device.",
      "GIF button: open the media panel for GIFs, stickers, and clips.",
      "Drag and drop: on desktop you can drop files into the composer.",
    ]},
    { h2: "How it is handled" },
    { list: [
      "Images are normalized and compressed to load quickly.",
      "Videos are compressed too; length and file size scale with your plan.",
      "You can mix media with text, a poll, or a quoted post.",
    ]},
    { note: "If media will not attach, the composer shows the reason. Most failures are a slow connection or a file larger than your plan allows." },
    { cta: [
      { to: "/platform/help/how-do-i-post-a-photo", label: "Posting a photo" },
      { to: "/platform/help/my-upload-keeps-failing-what-do-i-do", label: "If an upload fails" }
    ]}
  ]
};
