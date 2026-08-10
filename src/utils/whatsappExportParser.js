// WhatsApp "Export chat" .txt parser (shared source of truth).
//
// Used in TWO places:
//   1. Client (/messages/import) — instant preview: message count, participants,
//      date range, before anything uploads.
//   2. Box worker (infra/community-import) — the authoritative parse before
//      bulk-inserting into the relay store. deploy.sh COPIES this file into the
//      worker install dir; edit it HERE only.
//
// Dependency-free ESM on purpose (runs in Vite and bare Node).
//
// Format reality (differs per device locale — never assume):
//   Android: `01/02/2026, 21:14 - Alice: message`
//   Android US: `2/1/26, 9:14 PM - Alice: message`
//   iOS:     `[01/02/2026, 21:14:33] Alice: message`
//   Separators can be / . or -, year can lead (2026.02.01), 12h markers vary
//   ("PM", "p. m.", "ص/م"), iOS uses U+202F before AM/PM, and every line can
//   carry U+200E/U+200F RTL marks. Continuation lines (multi-line messages)
//   have NO timestamp prefix. Lines without an `Author: ` part are system
//   lines ("Messages are end-to-end encrypted", "X added Y") — skipped.
//
// Date format is DETECTED by sampling all headers, not assumed:
//   - a component ≥ 1000 in first position → year-first (Y-M-D)
//   - otherwise year is the 3rd component; any 1st component > 12 → day-first,
//     any 2nd component > 12 → month-first (US), ambiguous → day-first (the
//     majority of WhatsApp locales).

const INVISIBLES = /[‎‏‪-‮⁦-⁩]/g;

// Header: optional "[", date (3 numeric parts, same separator), ", " or " ",
// time (h:mm or h:mm:ss, ":" or "."), optional am/pm marker, optional "]",
// then " - " (Android) or " " (iOS), then the rest of the line.
const HEADER_RE = /^\[?(\d{1,4})([./-])(\d{1,2})\2(\d{1,4})[,.]?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s?(?:([APap])\.?\s?\.?[Mm]\.?)?\]?\s*(?:-\s)?(.*)$/;

// Media placeholders WhatsApp writes when "without media" export is chosen
// (locale variants share the angle-bracket shape) or generic attachment notes.
const MEDIA_OMITTED_RE = /^<.+>$|\(file attached\)\s*$/i;

function detectDateOrder(samples) {
  // samples: [{a, b, c}] raw numeric components in written order.
  if (samples.some((s) => s.a >= 1000)) return 'YMD';
  if (samples.some((s) => s.a > 12)) return 'DMY';
  if (samples.some((s) => s.b > 12)) return 'MDY';
  return 'DMY';
}

function toMs(order, a, b, c, hh, mm, ss, ampm) {
  let year, month, day;
  if (order === 'YMD') { year = a; month = b; day = c; }
  else if (order === 'MDY') { month = a; day = b; year = c; }
  else { day = a; month = b; year = c; }
  if (year < 100) year += 2000;
  let h = hh;
  if (ampm) {
    const isPM = /p/i.test(ampm);
    if (isPM && h < 12) h += 12;
    if (!isPM && h === 12) h = 0;
  }
  const d = new Date(year, month - 1, day, h, mm, ss || 0);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Parse a WhatsApp export. Returns:
 * {
 *   messages: [{ ts, author, text, mediaOmitted }],
 *   participants: [name...],
 *   firstTs, lastTs,
 *   dateOrder: 'DMY'|'MDY'|'YMD',
 *   systemLines: n, unparsedLines: n,
 * }
 * Bad input (not a WhatsApp export) → messages: [].
 */
export function parseWhatsAppExport(rawText) {
  const text = String(rawText || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  // Pass 1: find header lines + collect date samples for format detection.
  const headers = []; // { idx, a, b, c, hh, mm, ss, ampm, rest }
  for (let i = 0; i < lines.length; i++) {
    const clean = lines[i].replace(INVISIBLES, '');
    const m = HEADER_RE.exec(clean);
    if (!m) continue;
    headers.push({
      idx: i,
      a: parseInt(m[1], 10), b: parseInt(m[3], 10), c: parseInt(m[4], 10),
      hh: parseInt(m[5], 10), mm: parseInt(m[6], 10),
      ss: m[7] ? parseInt(m[7], 10) : 0,
      ampm: m[8] || '',
      rest: m[9] || '',
    });
  }
  if (headers.length === 0) {
    return { messages: [], participants: [], firstTs: 0, lastTs: 0, dateOrder: 'DMY', systemLines: 0, unparsedLines: lines.length };
  }
  const dateOrder = detectDateOrder(headers);

  // Pass 2: build messages; continuation lines append to the previous message.
  const messages = [];
  const participants = new Set();
  let systemLines = 0;
  let unparsedLines = 0;
  let hi = 0;
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    if (hi < headers.length && headers[hi].idx === i) {
      const h = headers[hi++];
      const ts = toMs(dateOrder, h.a, h.b, h.c, h.hh, h.mm, h.ss, h.ampm);
      // Author = text before the first ": " in the remainder. No ": " means a
      // system line (join/leave/encryption notice) — skip it.
      const sep = h.rest.indexOf(': ');
      if (sep <= 0 || !ts) {
        current = null;
        systemLines++;
        continue;
      }
      const author = h.rest.slice(0, sep).replace(INVISIBLES, '').trim();
      const body = h.rest.slice(sep + 2);
      if (!author || author.length > 100) {
        current = null;
        systemLines++;
        continue;
      }
      current = {
        ts,
        author,
        text: body,
        mediaOmitted: MEDIA_OMITTED_RE.test(body.trim()),
      };
      participants.add(author);
      messages.push(current);
    } else if (current) {
      current.text += '\n' + lines[i];
    } else if (lines[i].trim()) {
      unparsedLines++;
    }
  }

  let firstTs = Infinity;
  let lastTs = 0;
  for (const m of messages) {
    if (m.ts < firstTs) firstTs = m.ts;
    if (m.ts > lastTs) lastTs = m.ts;
  }
  return {
    messages,
    participants: Array.from(participants),
    firstTs: Number.isFinite(firstTs) ? firstTs : 0,
    lastTs,
    dateOrder,
    systemLines,
    unparsedLines,
  };
}

export default parseWhatsAppExport;
