// Native Squad Stream (voice/video hangout) — /squads/:squadId/stream on the APK.
//
// This screen is a live WebRTC/Pion-SFU surface and is ALREADY built phone-first:
// it renders its own safe-area TopBar (not SquadShell) and switches its tile
// grids on IS_NATIVE_BUILD (grid-cols-1 / grid-cols-2 on native). There is no
// desktop-rail DOM to strip, so a parallel native copy would just duplicate the
// realtime connection code with no load-speed gain and real risk to live audio.
// The native route therefore delegates to the single proven implementation while
// still giving the native build a dedicated Squad-Stream entry point.
export { default } from '../SquadStreamScreen';
