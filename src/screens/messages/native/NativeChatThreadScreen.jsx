// NativeChatThreadScreen — dedicated native entry for /messages/:chatId.
// ChatThreadScreen is a 2400-line realtime relay thread that is already
// phone-first (Telegram tap/hold, safe-area composer, IS_NATIVE_BUILD keyboard
// handling) with no desktop-rail DOM in the mobile path. Forking that much
// live messaging logic into a second source of truth would guarantee drift, so
// the native build renders the same screen. Kept as its own routed file so a
// future phone-only divergence is a one-file change.
export { default } from '../ChatThreadScreen';
