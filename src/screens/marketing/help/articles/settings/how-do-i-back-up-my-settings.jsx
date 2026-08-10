// Help center article: How do I back up my settings?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Your account settings (profile, theme, privacy, notification preferences) are tied to your account, so they come back when you sign in, no manual backup needed. What you can back up by hand is your chat data: open Settings then Data & Storage to export your messages to a file, restore from one, or set an automatic backup schedule.",
  updated: "2026-06-18",
  body: [
    {
      p: "There are two different things people mean by 'back up my settings', so here is both. Your account settings do not need backing up: they live with your account. The thing you can actually export and restore is your chat data, in the Data & Storage section."
    },
    {
      h2: "Account settings: already saved to your account"
    },
    {
      p: "Your profile, theme, privacy choices, and notification preferences are tied to your account, not your device. Sign in on another device and they come with you. So there is no settings file to export or import, just sign back into the same account."
    },
    {
      h2: "Backing up your chat data"
    },
    {
      p: "Your messages are stored on your device, so VERGR gives you tools to back them up. Open Settings, then Data & Storage (the Backup section)."
    },
    {
      steps: [
        "Open Settings, then Data & Storage.",
        "Tap Export Backup Now to download a backup file of your messages to your device.",
        "To bring messages back, tap Restore from Backup and pick a backup file.",
        "Optionally set Auto Backup to daily, weekly, or monthly, which downloads a backup file on that schedule."
      ]
    },
    {
      h2: "What is in the backup"
    },
    {
      list: [
        "Your messages and chats, exported as a file you keep on your device.",
        "An auto-backup option (off by default, plus daily, weekly, monthly).",
        "A restore option to import a backup file you saved earlier.",
        "Auto backups save a file to your device. For cloud backup to Google Drive or iCloud, use the mobile app."
      ]
    },
    {
      note: "There is also a Clear Local Cache option here that deletes locally stored messages. It is separate from backing up, and your messages re-sync from the server, but export a backup first if you want a copy on hand.",
    },
    {
      faq: [
        [
          "Do my settings get exported in the backup?",
          "No. The backup is your chat data. Your account settings are saved to your account automatically and return when you sign in."
        ],
        [
          "Where does the backup file go?",
          "It downloads to your device as a file. Keep it somewhere safe if you want to restore later. Cloud backup to Google Drive or iCloud is available in the mobile app."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-manage-my-storage-and-cache",
          label: "Manage storage and cache"
        },
        {
          to: "/platform/help/where-do-i-find-all-my-account-settings",
          label: "All your settings"
        }
      ]
    }
  ]
};
