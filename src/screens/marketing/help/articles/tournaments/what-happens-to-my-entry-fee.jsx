// Help center article: What happens to my entry fee?
// (Now covers the ticketed model: competing is free; this explains where a
// spectator ticket's Coins go. Legacy entry fees covered at the end.)
// Block model: { p } { h2 } { list:[...] } { steps:[...] } { faq:[[q,a]] } { note } { cta:[{to,label}] }

export default {
  summary: "Competing is free — there's no entry fee. If you buy a spectator ticket, your Coins split three ways: a flat 10% platform fee, a host-set share into the winner's prize purse, and the rest to the host. Tickets are refunded if the event is cancelled before it starts.",
  updated: "2026-06-14",
  body: [
    {
      p: "On VERGR, competing costs nothing — there's no entry fee to play. The Coins in an event come from fans buying spectator tickets. Here's exactly where a ticket's Coins go."
    },
    {
      h2: "Where your ticket money goes"
    },
    {
      p: "When you buy a ticket, the price you paid splits into three parts:"
    },
    {
      list: [
        "Platform fee: a flat 10% to VERGR, which runs the event, streaming, moderation, and infrastructure.",
        "Prize purse: a share the host chooses, which goes toward the winner's prize.",
        "Host earnings: the remainder goes to the host, as their reward for putting the event on."
      ]
    },
    {
      h2: "When you get it back"
    },
    {
      list: [
        "If the event is cancelled before it starts, your ticket is refunded in full, automatically, and you're notified.",
        "Once the event has started, a ticket is not refundable — you've received the access you paid for.",
      ]
    },
    {
      h2: "Legacy entry fees"
    },
    {
      p: "Some events (only where VERGR has enabled the older pay-to-enter model for a host) charge competitors an entry fee that forms the prize pool, less a 5% fee. Where that applies, the fee is held when you register and returned if the event is cancelled before it starts, or if you leave before it begins."
    },
    {
      cta: [
        { to: "/platform/help/how-do-prizes-get-paid-out", label: "How prizes pay out" },
        { to: "/platform/help/what-happens-if-a-tournament-is-cancelled", label: "If an event is cancelled" }
      ]
    }
  ]
};
