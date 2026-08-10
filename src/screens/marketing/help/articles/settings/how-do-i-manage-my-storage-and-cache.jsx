// Help center article: How do I manage my storage and cache?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Go to Settings then Storage to see what VERGR is caching on your device and clear it if you need the space or want a fresh start. Clearing the cache removes temporary files like cached images and video, not your account or your content. You stay signed in and nothing you posted is deleted.",
  updated: "2026-06-18",
  body: [
    {
      p: "VERGR caches things like images, thumbnails, and video so the app feels fast and uses less data on repeat views. Over time that cache can grow. The Storage page in Settings lets you see it and clear it whenever you want."
    },
    {
      h2: "Clear your cache"
    },
    {
      steps: [
        "Open Settings, then Storage.",
        "Review what is cached on your device.",
        "Choose to clear the cache.",
        "The app rebuilds what it needs as you use it again."
      ]
    },
    {
      h2: "What clearing does and does not touch"
    },
    {
      list: [
        "Removes: temporary cached media and files used to speed things up.",
        "Keeps: your account, your posts, clips, messages, wallet, and settings. None of that is stored only in the cache.",
        "Effect: the app may feel slightly slower right after, while it re-caches, then speeds back up."
      ]
    },
    {
      note: "Clearing the cache is a good first move if images stop loading, the app looks out of date, or something seems stuck. It is safe and you will not lose anything you created.",
    },
    {
      faq: [
        [
          "Will clearing the cache log me out?",
          "No. Clearing cached media does not sign you out. If you do a full browser data clear from your device, that can remove your session, which is different from clearing VERGR's media cache."
        ],
        [
          "The app is using a lot of space. Is that normal?",
          "Cached video and images add up, especially if you watch a lot of streams and clips. Clearing the cache reclaims that space, and it refills only as needed."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/the-app-looks-broken-or-out-of-date-how-do-i-refresh-it",
          label: "App looks out of date?"
        },
        {
          to: "/platform/help/the-app-is-slow-what-can-i-do",
          label: "The app is slow"
        }
      ]
    }
  ]
};
