export default {
  summary: "Push needs three things: notifications enabled in VERGR settings, permission granted to the app or browser, and a platform that supports web push. The Android app and installed PWA work well; on iPhone you must add VERGR to your home screen first — Safari tabs cannot receive push.",
  updated: "2026-06-07",
  body: [
    { p: "If your in-app notifications work but nothing reaches your device when the app is closed, it is almost always a permission or platform issue." },
    { h2: "Checklist" },
    { list: [
      "Notifications are on in Settings → Notifications, and the category is enabled.",
      "You granted notification permission when prompted (check your device/browser settings if you denied it).",
      "You are on a platform that supports push: the Android app, an installed PWA, or a desktop browser.",
      "On iPhone/iPad: VERGR must be added to your home screen (iOS 16.4+). Push does not work in a normal Safari tab.",
    ]},
    { h2: "Still nothing?" },
    { p: "Re-open the app once after granting permission so it can register for push, and make sure your device is not in a battery-saver mode that blocks background alerts." },
    { cta: [
      { to: "/platform/help/how-do-i-get-notifications-on-my-phone", label: "Phone notifications" },
      { to: "/platform/help/how-do-i-add-vergr-to-my-iphone-home-screen", label: "Add to iPhone home screen" }
    ]}
  ]
};
