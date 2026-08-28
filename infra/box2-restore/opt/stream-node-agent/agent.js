// vergr stream-node-agent — registers this ingest box in the stream_nodes
// registry and heartbeats its live load every INTERVAL_MS.
//
// Every box ("edge") runs an identical ingest stack (nginx-rtmp + rtmp-auth +
// vergr-ingest + r2-sync) pushing to the SAME R2 bucket, so a stream packaged on
// any box is served identically from cdn.vergr.app. createStreamSession reads
// this registry and assigns each new stream to the freshest, least-loaded box
// that has capacity. This agent is the ONLY writer of its own stream_nodes doc.
//
// Self-registering: a new box just runs this agent with its own NODE_ID + hosts
// and it appears in the registry. Draining: `touch $DRAIN_FILE` flips status to
// 'draining' (no new streams assigned; existing streams keep running) so the box
// can be maintained or removed with zero downtime; `rm $DRAIN_FILE` re-activates.
//
// Env:
//   NODE_ID              unique id, e.g. "edge2"            (required)
//   RTMP_BASE            e.g. rtmp://1.2.3.4:1935/live      (required)
//   BROWSER_INGEST_BASE  e.g. https://edge2.vergr.app/ingest (optional — set once the box has a cert)
//   SFU_BASE             e.g. wss://edge2.vergr.app/ws      (optional)
//   MAX_STREAMS          capacity ceiling for this box      (default 12)
//   PUBLIC_IP            public IPv4                         (optional, for ops)
//   FIREBASE_CREDS       service-account json path           (default /etc/vergr-rtmp-auth/firebase-admin.json)
//   DB_ID                Firestore database id               (default vgrdb)
//   INTERVAL_MS          heartbeat cadence                   (default 15000)
//   DRAIN_FILE           presence flips status to draining   (default /etc/vergr-node/draining)

import os from 'os';
import fs from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const NODE_ID = process.env.NODE_ID;
const RTMP_BASE = process.env.RTMP_BASE;
const BROWSER_INGEST_BASE = process.env.BROWSER_INGEST_BASE || null;
const SFU_BASE = process.env.SFU_BASE || null;
const MAX_STREAMS = parseInt(process.env.MAX_STREAMS || '12', 10);
const PUBLIC_IP = process.env.PUBLIC_IP || null;
const CREDS = process.env.FIREBASE_CREDS || '/etc/vergr-rtmp-auth/firebase-admin.json';
const DB_ID = process.env.DB_ID || 'vgrdb';
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '15000', 10);
const DRAIN_FILE = process.env.DRAIN_FILE || '/etc/vergr-node/draining';

if (!NODE_ID || !RTMP_BASE) {
  console.error('NODE_ID and RTMP_BASE are required');
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(fs.readFileSync(CREDS, 'utf8'))) });
const db = getFirestore(DB_ID);
const nodeRef = db.collection('stream_nodes').doc(NODE_ID);

const numCpus = os.cpus().length || 1;

async function liveStreamCount() {
  // Query only currently-live streams (small set, single-field index) and count
  // the ones assigned to THIS node. No composite index needed.
  const snap = await db.collection('streams').where('status', '==', 'live').get();
  let n = 0;
  snap.forEach((d) => { if ((d.data() || {}).nodeId === NODE_ID) n++; });
  return n;
}

async function beat() {
  try {
    const draining = fs.existsSync(DRAIN_FILE);
    const load1 = os.loadavg()[0];
    const cpuPct = Math.min(100, Math.round((load1 / numCpus) * 100));
    const memUsedPct = Math.round((1 - os.freemem() / os.totalmem()) * 100);
    const currentStreams = await liveStreamCount();
    await nodeRef.set({
      nodeId: NODE_ID,
      status: draining ? 'draining' : 'active',
      rtmpBase: RTMP_BASE,
      browserIngestBase: BROWSER_INGEST_BASE,
      sfuBase: SFU_BASE,
      maxStreams: MAX_STREAMS,
      publicIp: PUBLIC_IP,
      currentStreams,
      cpuPct,
      memUsedPct,
      load1: Math.round(load1 * 100) / 100,
      numCpus,
      lastHeartbeat: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    console.error('[heartbeat] failed:', e.message);
  }
}

console.log(`stream-node-agent ${NODE_ID} → ${DB_ID}/stream_nodes (every ${INTERVAL_MS}ms, max ${MAX_STREAMS})`);
beat();
setInterval(beat, INTERVAL_MS);
