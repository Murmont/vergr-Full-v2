// NativeClipViewerScreen — dedicated native entry for /clip/:postId.
// ClipViewerScreen is already a `fixed inset-0` full-screen immersive vertical
// player (safe-top/safe-bottom, swipe paging, custom tap-to-toggle video, no
// desktop-rail DOM and no isDesktop branch — identical on every form factor).
// There is nothing desktop to strip, so the native build renders the same
// single source of truth rather than forking fragile gesture/prefetch logic.
export { default } from '../ClipViewerScreen';
