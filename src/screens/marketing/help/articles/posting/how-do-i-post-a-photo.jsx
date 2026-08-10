export default {
  summary: "Tap create, add a photo from your device using the media button, write an optional caption, choose the audience, and post. Images are compressed automatically on upload so they load fast for everyone.",
  updated: "2026-06-07",
  body: [
    { h2: "Posting a photo" },
    { steps: [
      "Tap create.",
      "Tap the media (image) button and pick a photo.",
      "Add a caption and any hashtags.",
      "Choose Public, Followers, or Squad.",
      "Tap Post."
    ]},
    { h2: "Good to know" },
    { list: [
      "Photos are normalized and compressed on upload, so large phone photos are fine to add.",
      "You can add more than one image to a post.",
      "If a photo will not post, check your connection — the composer shows the reason if an upload fails.",
    ]},
    { cta: [
      { to: "/platform/help/how-do-i-add-media-to-a-post", label: "Adding media to a post" },
      { to: "/platform/help/my-upload-keeps-failing-what-do-i-do", label: "If an upload fails" }
    ]}
  ]
};
