import { dispatchVerifyPrompt } from './emailGate';
// chatRelay — WebSocket client for the vergr-chat live-stream chat relay.
//
// Connection: wss://chat.vergr.app/stream/<streamId>?token=<firebase-id-token>
// Auto-reconnects with exponential backoff. Buffers locally-sent messages
// during reconnect attempts and replays them.
//
// Wire format mirrors infra/chat/main.go's Msg struct.
//
// Usage:
//   import { connectChat } from '@/utils/chatRelay';
//   const c = await connectChat({
//     streamId, getIdToken,
//     onHello:   (msg) => {...},
//     onMessage: (msg) => {...},   // msg.type === 'msg' or 'tip'
//     onSystem:  (msg) => {...},   // msg.type === 'system' (e.g. join/leave hints)
//     onReject:  (msg) => {...},   // server refused our send
//     onState:   (state) => {...}, // 'open' | 'reconnecting' | 'closed'
//   });
//   c.send({ type:'msg',  text: '...' });
//   c.send({ type:'tip',  text: '...' });   // tip text already moderated client-side first
//   c.report({ id, uid, text });
//   c.close();

const DEFAULT_BASE =
  import.meta.env.VITE_CHAT_WS_BASE || 'wss://chat.vergr.app';

const MAX_BACKOFF_MS = 15_000;

export async function connectChat({
  streamId,
  getIdToken,
  onHello = () => {},
  onMessage = () => {},
  onSystem = () => {},
  onReject = () => {},
  onHide   = () => {},
  onHeart  = () => {},
  // ⚠ MUST default to a no-op like the rest. Two existing callers
  // (ChatPanel, MobileLiveViewer) do not pass it, and an undefined callback
  // would throw on the first spoken message rather than simply doing nothing.
  onTts    = () => {},
  onState = () => {},
  baseUrl = DEFAULT_BASE,
  // ⚠ THE BROADCASTER’S MODERATORS-ONLY ROOM. `mods` opens a SECOND socket to a
  // SECOND room (`<streamId>:mods`) whose join the relay refuses for anyone who is
  // not the host, someone in `streams/{id}.moderatorUids`, or Vanguard.
  //
  // ⚠⚠ DO NOT “SIMPLIFY” THIS INTO ONE SOCKET WITH A CLIENT-SIDE FILTER. Whatever
  // the server sends, the client can read — a filter is not a private channel. The
  // whole privacy model is that the relay refuses the JOIN (`canJoinModRoom` in
  // infra/chat/src/main.go, covered by modroom_test.go).
  channel = 'public',   // public | mods
}) {
  let ws = null;
  let closed = false;
  let backoff = 800;
  const outbox = []; // queued sends while reconnecting

  async function connect() {
    if (closed) return;
    onState('reconnecting');
    let token;
    try { token = await getIdToken(); } catch { token = null; }
    if (!token) {
      // Retry with backoff if we can't get a token right now.
      setTimeout(connect, backoff);
      backoff = Math.min(MAX_BACKOFF_MS, backoff * 1.6);
      return;
    }
    // ⚠ THE CLIENT NEVER NAMES A ROOM. It asks for a channel and the SERVER derives
    // the room id, so a client cannot request someone else’s room by editing a string.
    const suffix = channel === 'mods' ? '&channel=mods' : '';
    const url = `${baseUrl.replace(/\/$/, '')}/stream/${encodeURIComponent(streamId)}?token=${encodeURIComponent(token)}${suffix}`;
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      backoff = 800;
      onState('open');
      // Drain outbox.
      while (outbox.length) {
        const m = outbox.shift();
        try { ws.send(JSON.stringify(m)); } catch { outbox.unshift(m); break; }
      }
    });

    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.type) {
        case 'hello':  onHello(m); break;
        case 'msg':
        case 'tip':    onMessage(m); break;
        case 'system': onSystem(m); break;
        // An unverified email may read but not speak: explain it once, here, for
        // every chat surface, then let the screen mark the message as failed.
        case 'reject': if (m.reason === 'verify-email') dispatchVerifyPrompt('send messages'); onReject(m); break;
        case 'hide':   onHide(m);   break;
        case 'heart':  onHeart(m);  break;
        // Effect 13. A SEPARATE verb from 'msg' on purpose: the relay runs a
        // full Gemini pass on these and only host+lexicon on chat, so they
        // cannot share a path. Doc: docs/effects/13-tts-on-stream.md
        case 'tts':    onTts(m);    break;
      }
    });

    ws.addEventListener('close', () => {
      if (closed) return;
      onState('reconnecting');
      setTimeout(connect, backoff);
      backoff = Math.min(MAX_BACKOFF_MS, backoff * 1.6);
    });

    ws.addEventListener('error', () => {
      // close handler will fire next, drives reconnect
    });
  }

  await connect();

  return {
    send(payload) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify(payload)); return true; }
        catch { /* fall through */ }
      }
      outbox.push(payload);
      return false;
    },
    /** Ask the relay to speak this to the whole room. Gated server-side on
     *  host opt-in AND (level 92 OR Pro); the client gate is only UX. */
    speak(text) { return this.send({ type: 'tts', text }); },
    report({ id, uid, text }) {
      this.send({ type: 'report', id, uid, text });
    },
    close() {
      closed = true;
      onState('closed');
      try { ws?.close(); } catch {}
    },
    socket: () => ws,
  };
}
