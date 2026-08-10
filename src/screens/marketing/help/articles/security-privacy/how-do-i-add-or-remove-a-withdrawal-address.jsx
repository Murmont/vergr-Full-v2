export default {
  summary: "In your wallet, open the whitelisted addresses section under Security. Tap Add Address, paste your Base USDC address, confirm with your PIN, and it goes through a short security hold before you can withdraw to it. Remove an address from the same screen.",
  updated: "2026-06-07",
  body: [
    { h2: "Adding an address" },
    { steps: [
      "Open your wallet and go to Security → Whitelisted Addresses.",
      "Tap Add Address.",
      "Paste your crypto address (Base network, for USDC).",
      "Confirm with your wallet PIN (and 2FA if enabled).",
      "Wait for the security hold to clear before the address can receive a withdrawal."
    ]},
    { h2: "Removing an address" },
    { p: "On the same screen, select the address and choose Remove. Removing is immediate. You can re-add it later, but it will go through the hold again." },
    { note: "Check the address character by character. Crypto transfers are irreversible — VERGR cannot reverse a withdrawal sent to an address you whitelisted, even if it was a typo." },
    { cta: [
      { to: "/platform/help/what-is-a-whitelisted-withdrawal-address-and-why-do-i-need-one", label: "Why whitelisting matters" },
      { to: "/platform/help/what-is-a-withdrawal-address-and-how-do-i-set-it", label: "Withdrawal addresses" }
    ]}
  ]
};
