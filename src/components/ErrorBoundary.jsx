// React error boundary. There was none anywhere in the app until 2026-08-19.
//
// ## Why this exists (audit A50)
//
// React's default on an uncaught render error is to unmount the WHOLE tree. So
// a single bad prop in a single leaf component took down the entire session and
// left a black page with no way out but a manual reload.
//
// That was not hypothetical. `InlineVideoPlayer` referenced an identifier that
// did not exist (`resolvedSrc`, audit A41 #1), so tapping a chat video to
// enlarge it threw a ReferenceError and `root.innerHTML.length` dropped to 0 —
// the whole app, gone, from the most ordinary action there is.
//
// A boundary is NOT a substitute for fixing the bug. A41 #1 is fixed. This is
// here so the NEXT unknown crash costs one panel instead of the session.
//
// ## Where to put one
//
// At the root, and around anything that renders untrusted or awkward input:
// media players, the message list, each route element. A boundary only catches
// errors BELOW it, so a single root boundary still means any crash blanks
// everything except the fallback — useful, but a route-level one keeps the nav
// and the rest of the app alive.
//
// It does NOT catch: event handlers, async callbacks, timers, or SSR. Those
// need try/catch at the call site.
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep this cheap and never let the reporter itself throw, or the boundary
    // becomes the crash.
    try {
      console.error('[ErrorBoundary]', this.props.label || 'app', error, info?.componentStack);
    } catch { /* ignore */ }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // A caller can supply its own inline fallback: a broken video should show a
    // placeholder inside the modal, not a full-page "something went wrong".
    if (this.props.fallback !== undefined) {
      return typeof this.props.fallback === 'function'
        ? this.props.fallback({ error, reset: () => this.setState({ error: null }) })
        : this.props.fallback;
    }

    return (
      <div
        role="alert"
        style={{
          minHeight: '60vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 14,
          padding: 24, textAlign: 'center', color: '#fff',
        }}
      >
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 20 }}>
          Something went wrong
        </div>
        <div style={{ fontSize: 14, color: '#9CA3AF', maxWidth: 420, lineHeight: 1.6 }}>
          This part of the app hit an error. The rest of Vergr is still working,
          so you can go back and carry on.
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
          {/* Reset re-renders the same subtree. It genuinely recovers a
              transient fault, and if the error is deterministic the fallback
              simply comes back rather than the app dying. */}
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              padding: '10px 18px', borderRadius: 10, cursor: 'pointer',
              background: 'linear-gradient(135deg, #7B1FFF, #B44FFF)',
              color: '#fff', border: 'none', fontWeight: 700, fontSize: 13,
            }}
          >
            Try again
          </button>
          {/* BrowserRouter, not HashRouter: setting `location.hash` here only appended
              `#/` to the CRASHED path and reloaded straight back into it, so the one
              escape hatch on the crash screen could not escape. assign('/') leaves the
              route entirely and reloads by itself. */}
          <button
            onClick={() => { window.location.assign('/'); }}
            style={{
              padding: '10px 18px', borderRadius: 10, cursor: 'pointer',
              background: 'transparent', color: '#9CA3AF',
              border: '1px solid rgba(255,255,255,0.14)', fontSize: 13,
            }}
          >
            Go home
          </button>
        </div>
      </div>
    );
  }
}
