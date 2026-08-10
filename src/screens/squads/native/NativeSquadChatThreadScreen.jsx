// Native Squad Chat — /squads/:squadId/chat on the APK.
//
// The squad chat is a ~1000-line realtime surface (live message stream, typing,
// reactions, voice notes, votes, moderation). It ALREADY renders phone-first:
// it branches on useResponsive().isMobile and sits inside SquadShell, which on
// the native build hides the desktop rails and shows the native nav drawer +
// safe-area padding (see SquadShell IS_NATIVE_BUILD block + squad.css @media).
// Forking that realtime code into a parallel native copy would create two
// sources of truth for the fragile messaging path with no load-speed benefit,
// so the native route delegates to the single proven implementation. This file
// exists so the native build has a dedicated Squad-Chat entry point alongside
// every other native squad screen.
export { default } from '../SquadChatThreadScreen';
