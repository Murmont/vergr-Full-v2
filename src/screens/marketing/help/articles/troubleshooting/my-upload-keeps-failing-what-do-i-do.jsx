// Help center article: My upload keeps failing, what do I do?

export default {
  summary: "Check the file size against your plan first: uploads cap at 200MB on Free, 1GB on Lite, and 5GB on Pro. If the size is fine, it is almost always the connection: retry on stronger wifi. VERGR compresses media automatically before upload, so a file slightly over the line often still fits after compression.",
  updated: "2026-07-02",
  body: [
    {
      h2: "The checklist"
    },
    {
      steps: [
        "Size: your plan sets the ceiling. Free 200MB, Lite 1GB, Pro 5GB per file. A phone can easily record video beyond 200MB, so on Free this is the first suspect.",
        "Connection: uploads need sustained bandwidth. Switch from mobile data to wifi, or move closer to the router, and retry.",
        "Keep the app in the foreground while it uploads: phones pause background transfers to save battery.",
        "Retry once more after a reload: a stalled upload session sometimes just needs a fresh start."
      ]
    },
    {
      h2: "About compression"
    },
    {
      p: "VERGR automatically compresses photos and videos before uploading, so what counts is the compressed size, not the raw file. A long raw clip may still fit, but there are limits: if a video keeps failing, trimming it shorter is the most reliable fix."
    },
    {
      note: "If uploads fail instantly every time regardless of file, rather than failing partway, check whether you are signed in properly and try the refresh steps in the app-looks-broken article below."
    },
    {
      cta: [
        { to: "/platform/help/what-does-each-plan-include", label: "Plan limits" },
        { to: "/platform/help/the-app-looks-broken-or-out-of-date-how-do-i-refresh-it", label: "Refreshing the app" }
      ]
    }
  ]
};
