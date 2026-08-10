/**
 * DEMO-ONLY stub for utils/messageCache.js (Dexie/IndexedDB message cache).
 * Always empty so useMessages/useRelayMessages load the full latest thread
 * fresh from the in-memory shim on every visit (no stale cached messages
 * across builds). Mirrors every export of the real module as a no-op.
 */
export async function getCachedMessages() { return []; }
export async function getCachedMessagesBefore() { return []; }
export async function getLatestCachedTimestamp() { return null; }
export async function upsertMessages() {}
export async function removeCachedMessage() {}
export async function clearChatCache() {}
export async function searchAllMessages() { return []; }
export async function pruneCache() {}
export async function addToOutbox() {}
export async function getOutboxMessages() { return []; }
export async function removeFromOutbox() {}
export async function updateOutboxStatus() {}
export default {};
