export default {
  summary: "A whitelisted withdrawal address is a crypto address you have pre-approved to receive your payouts. VERGR only sends withdrawals to addresses on your whitelist, so even if someone got into your account they could not send your funds somewhere new without clearing the security checks.",
  updated: "2026-06-07",
  body: [
    { p: "Withdrawals leave the platform as USDC on the Base network, sent to a crypto address you control (for example a Coinbase or self-custody wallet). The whitelist is the safety layer around that." },
    { h2: "Why it exists" },
    { list: [
      "Funds can only go to an address you have explicitly added.",
      "A newly added address goes through a short security hold before it can receive a withdrawal, so a thief cannot add an address and instantly drain you.",
      "Combined with your wallet PIN and 2FA, it means several independent checks must pass before money moves."
    ]},
    { h2: "Setting one up" },
    { p: "Add your address in the wallet's whitelisted addresses section before you withdraw. Double-check every character — crypto transactions are irreversible, and VERGR cannot recover funds sent to a wrong address you whitelisted." },
    { cta: [
      { to: "/platform/help/how-do-i-add-or-remove-a-withdrawal-address", label: "Add or remove an address" },
      { to: "/platform/help/how-do-i-withdraw-my-earnings", label: "How to withdraw" }
    ]}
  ]
};
