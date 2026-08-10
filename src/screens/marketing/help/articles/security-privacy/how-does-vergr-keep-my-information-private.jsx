export default {
  summary: "VERGR keeps your private data private: your email, phone, date of birth, and wallet are never shown publicly. Direct messages are not stored as readable text on VERGR servers, identity documents are encrypted, and you control who can see your profile, content, and phone number.",
  updated: "2026-06-07",
  body: [
    { p: "Privacy on VERGR works on two levels: what other users can see, and what VERGR itself stores." },
    { h2: "What other users never see" },
    { list: [
      "Your email address and phone number.",
      "Your date of birth (used only as an age gate).",
      "Your wallet balance and transaction history.",
      "Your direct messages.",
      "Any post you set to Followers-only or Squad-only (unless they qualify)."
    ]},
    { h2: "How VERGR handles your data" },
    { list: [
      "Direct messages are delivered without being stored as readable text on the platform.",
      "Identity verification documents are encrypted and access-controlled.",
      "Privacy settings let you limit who can message you, see your content, and see your phone number.",
    ]},
    { p: "VERGR does not sell your personal data. See the privacy policy for the full detail." },
    { cta: [
      { to: "/platform/help/does-vergr-sell-my-data", label: "Does VERGR sell my data?" },
      { to: "/platform/help/how-do-i-control-who-can-see-my-content", label: "Control who sees your content" }
    ]}
  ]
};
