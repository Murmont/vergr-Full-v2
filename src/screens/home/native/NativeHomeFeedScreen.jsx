// NATIVE-APP home feed (Android/iOS Tauri shell ONLY — routed via IS_NATIVE_BUILD).
//
// The feed is an intrinsically single shared vertical list of PostCards, so it
// reuses the proven HomeFeedScreen logic (RSS news, ads, pull-to-refresh,
// infinite scroll) rather than forking ~1000 lines and risking drift. The only
// native-specific layout choice is full-width: the Android WebView reports an
// inflated viewport (~980px), so the web's 480px-centered column leaves dead
// gutters on a phone — `nativeFullWidth` makes the column fill the screen. The
// native top-bar breathing room is already handled inside HomeFeedScreen via
// IS_NATIVE_BUILD.

import HomeFeedScreen from '../HomeFeedScreen';

export default function NativeHomeFeedScreen(props) {
  return <HomeFeedScreen {...props} nativeFullWidth />;
}
