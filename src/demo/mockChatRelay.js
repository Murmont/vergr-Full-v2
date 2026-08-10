/**
 * DEMO-ONLY shim for utils/chatRelay.js (the live-stream chat WebSocket relay).
 * The real relay is a Hetzner WS service that can't be reached from the inert
 * demo build, so this fakes a lively chat: emits a backlog immediately then a
 * steady trickle of new lines, including a moderator and subscriber badges.
 */
const LINES = [
  { name: 'kaizen', text: 'LETS GOOO that was clean 🔥', badge: 'sub' },
  { name: 'luna', text: 'the aim is unreal today 💜' },
  { name: 'rook', text: 'how is he hitting these' },
  { name: 'mira', text: 'clutch or kick 😤', mod: true },
  { name: 'zeke', text: 'gg wp', badge: 'sub' },
  { name: 'dexterous', text: 'W stream' },
  { name: 'novafan22', text: 'first time here, insta follow' },
  { name: 'ghostlyy', text: 'that flick 💀💀' },
  { name: 'pixel', text: 'what sensitivity do you run?' },
  { name: 'sova_main', text: 'tipped 500 🪙 keep it up!', type: 'tip' },
  { name: 'kaizen', text: 'run it back one more', badge: 'sub' },
  { name: 'brie', text: 'this is actually so entertaining lol' },
  { name: 'tenz_fan', text: 'RADIANT gameplay 🐐' },
  { name: 'mira', text: 'keep chat civil pls 🙏', mod: true },
];
let n = 0;
const mk = (l) => ({
  type: l.type || 'msg', id: `demo_msg_${n++}`, uid: `viewer_${l.name}`,
  name: l.name, text: l.text, badge: l.badge || null, mod: !!l.mod, ts: Date.now(),
});

export async function connectChat({ onHello = () => {}, onMessage = () => {}, onState = () => {} } = {}) {
  const timers = [];
  Promise.resolve().then(() => {
    onState('open');
    onHello({ mod: false });
    // backlog
    LINES.slice(0, 9).forEach((l, i) => timers.push(setTimeout(() => onMessage(mk(l)), 120 * i)));
  });
  // steady trickle
  let idx = 9;
  const iv = setInterval(() => { onMessage(mk(LINES[idx % LINES.length])); idx++; }, 2600);
  timers.push(iv);
  return {
    send() { return true; },
    report() {},
    close() { onState('closed'); timers.forEach(clearTimeout); clearInterval(iv); },
    socket: () => null,
  };
}

export default { connectChat };
