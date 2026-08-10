// useChatMessages — switcher hook that picks between the legacy Firestore
// implementation (UseMessages.js) and the new relay+Dexie implementation
// (useRelayMessages.js) based on the `chatRelayEnabled` kill switch.
//
// Both underlying hooks are CALLED on every render to satisfy React's
// rules-of-hooks, but each is passed a null chatId when inactive so it
// short-circuits and does no work.
//
// Return shape matches both hooks: { messages, rawMessages, loading,
// sendMessage, removeLocalMessage }.

import useLegacyMessages from './UseMessages';
import useRelayMessages from './useRelayMessages';
import useChatRelayFlag from './useChatRelayFlag';

export default function useChatMessages(chatId, messageLimit = 80) {
  const relayEnabled = useChatRelayFlag();

  // Stable hook order; pass null to the inactive one so it no-ops.
  const relayBag = useRelayMessages(relayEnabled ? chatId : null, messageLimit);
  const legacyBag = useLegacyMessages(relayEnabled ? null : chatId, messageLimit);

  return relayEnabled ? relayBag : legacyBag;
}
