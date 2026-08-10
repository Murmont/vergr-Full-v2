// NativeCallScreen — dedicated native entry for /call/:chatId/:callType.
// CallScreen is a full-screen 1:1 WebRTC P2P call UI, already phone-first with
// IS_NATIVE_BUILD safe-area handling and no desktop-rail DOM. Forking the live
// peer-connection/signalling logic risks drift, so the native build renders the
// same screen. Its own routed file so a phone-only divergence stays one edit.
export { default } from '../CallScreen';
