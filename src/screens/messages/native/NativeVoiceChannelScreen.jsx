// NativeVoiceChannelScreen — dedicated native entry for /voice/:channelId.
// VoiceChannelScreen is a full-screen Discord-style SFU voice room, already
// phone-first (TopBar, IS_NATIVE_BUILD safe-area handling) with no desktop-rail
// DOM. Forking the live SFU join/presence/volume logic risks drift, so the
// native build renders the same screen. Its own routed file so a phone-only
// divergence stays a one-file change.
export { default } from '../VoiceChannelScreen';
