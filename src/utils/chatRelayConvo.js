// chatRelayConvo — WebSocket client for the vergr-chat relay's DM + group
// endpoints (see infra/chat/dm.go).
//
// Why a separate module from chatRelay.js: stream chat is a public firehose,
// DM/group rooms are private and have different auth + payload semantics.
// Keeping them apart avoids cross-contamination of message shapes.
//
// Path:
//   wss://chat.vergr.app/dm/<convoId>?token=<firebase-id-token>     (ciphertext)
//   wss://chat.vergr.app/group/<convoId>?token=<firebase-id-token>  (plaintext)
//
// Auto-reconnect with exponential backoff. Buffered sends drain on reconnect.

const DEFAULT_BASE =
  import.meta.env.VITE_CHAT_WS_BASE || 'wss://chat.vergr.app';

const MAX_BACKOFF_MS = 15_000;

export async function connectConversation({
  convoId,
  isGroup,
  isSquad = false,
  getIdToken,
  onHello   = () => {},
  onMessage = () => {},
  onReject  = () => {},
  onPolicy  = () => {},
  onState   = () => {},
  baseUrl   = DEFAULT_BASE,
  catchupSince = 0,
}) {
  let ws = null;
  let closed = false;
  let backoff = 800;
  const outbox = [];
  const path = isSquad ? 'squad' : (isGroup ? 'group' : 'dm');

  async function connect() {
    if (closed) return;
    onState('reconnecting');
    let token;
    try { token = await getIdToken(); } catch { token = null; }
    if (!token) {
      setTimeout(connect, backoff);
      backoff = Math.min(MAX_BACKOFF_MS, backoff * 1.6);
      return;
    }
    const url = `${baseUrl.replace(/\/$/, '')}/${path}/${encodeURIComponent(convoId)}?token=${encodeURIComponent(token)}`;
    try { ws = new WebSocket(url); }
    catch {
      setTimeout(connect, backoff);
      backoff = Math.min(MAX_BACKOFF_MS, backoff * 1.6);
      return;
    }

    ws.addEventListener('open', () => {
      backoff = 800;
      onState('open');
      // Always request the ring-buffer catch-up. since=0 means "everything
      // the server still has" (capped by its ~60s ring buffer); since=N
      // means "anything newer than ts N". Either way the server is the one
      // bounding the replay, not us.
      try { ws.send(JSON.stringify({ type: 'catchup', since: catchupSince || 0 })); } catch {/* ignore */}
      while (outbox.length) {
        const m = outbox.shift();
        try { ws.send(JSON.stringify(m)); } catch { outbox.unshift(m); break; }
      }
    });

    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.type) {
        case 'hello':  onHello(m); onPolicy(m); break;
        case 'msg':    onMessage(m); break;
        case 'reject': onReject(m); break;
        // Sent when a gate changes mid-session — currently only the stranger-DM
        // media block lifting because the other person followed back.
        case 'policy': onPolicy(m); break;
        default:       /* ignore unknown */
      }
    });

    ws.addEventListener('close', () => {
      if (closed) return;
      onState('reconnecting');
      setTimeout(connect, backoff);
      backoff = Math.min(MAX_BACKOFF_MS, backoff * 1.6);
    });

    ws.addEventListener('error', () => { /* close handler drives reconnect */ });
  }

  await connect();

  return {
    /** Send a payload now if connected, otherwise queue for the next reconnect. */
    send(payload) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify(payload)); return true; }
        catch { /* fall through */ }
      }
      outbox.push(payload);
      return false;
    },
    /** Update the catch-up cursor (e.g., latest ts we have cached). */
    setCatchupCursor(ts) { catchupSince = ts || 0; },
    close() {
      closed = true;
      onState('closed');
      try { ws?.close(); } catch {/* ignore */}
    },
    socket: () => ws,
  };
}
