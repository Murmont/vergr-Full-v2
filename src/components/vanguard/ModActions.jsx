// ModActions — the moderation actions of Vergr Vanguard, in ONE place.
//
// The queue's case drawer, Live now and User lookup all render these, so a
// mute cannot be capped one way in one screen and another way in the next.
//
// ⚠⚠ UNTIL 2026-09-21 THE MUTE AND BAN CALLABLES HAD ZERO CALLERS.
// vanguardMuteUser, vanguardTempBanUser and vanguardPermaBanUser were deployed
// with rank caps and no button anywhere, so a moderator who upheld a report
// about a person could not act on that person at all.
//
// The caps shown here mirror src/utils/vanguardRanks.js authority, and the
// SERVER enforces the same caps again (functions/vanguard.js). The UI only
// avoids offering an action that would be refused.
//
// ⚠ A profile, post or stream opens on vergr.app (openInVergr): the app has no
// consumer routes.

import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase/config';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { isVanguard } from '../../utils/vanguard';
import { rankMeta } from '../../utils/vanguardRanks';
import { openInVergr } from '../../admin/openExternal';
import Icon from '../Icon';
import { VG_COLORS as C } from './VanguardLayout';

const call = (name, payload) => httpsCallable(getFunctions(undefined, 'europe-west1'), name)(payload).then((r) => r.data);

const tsMs = (t) => (t?.toDate ? t.toDate().getTime() : t?.seconds ? t.seconds * 1000 : (typeof t === 'number' ? t : 0));

// The viewer's authority, read off their own profile. The operator's stand-in
// profile (VanguardApp) carries role 'admin' and gets everything, matching the
// server's synthetic Overseer.
export function useModAuthority() {
  const { profile } = useUser();
  return useMemo(() => {
    const isFounder = profile?.role === 'admin' || profile?.operator === true;
    if (isFounder) {
      return { isFounder, canAct: true, canMute: true, muteMaxHours: null, canTempBan: true, tempBanMaxDays: null, canPermaBan: true, label: 'Founder' };
    }
    if (!isVanguard(profile)) return { isFounder: false, canAct: false, label: '' };
    const meta = rankMeta(profile.vanguard.rank);
    const a = meta?.authority || {};
    return {
      isFounder: false,
      canAct: !!a.canApproveReject,
      canMute: !!a.canMute,
      muteMaxHours: a.muteMaxHours ?? null,
      canTempBan: !!a.canTempBan,
      tempBanMaxDays: a.tempBanMaxDays ?? null,
      canPermaBan: !!a.canPermaBan,
      label: meta?.label || '',
    };
  }, [profile]);
}

// Where a reported thing lives on vergr.app.
export function targetPath(row) {
  const id = row?.targetId;
  if (!id) return null;
  switch (row.targetType) {
    case 'post': return `/post/${id}`;
    case 'comment': return row.postId ? `/post/${row.postId}` : null;
    case 'user': return `/user/${id}`;
    case 'stream': return `/watch/${id}`;
    case 'squad': return `/squads/${id}`;
    default: return null;
  }
}

// What the approve button does, per report type. Anything not listed is marked
// upheld and the account is dealt with through the account actions.
export function approveLabel(targetType) {
  if (targetType === 'post') return 'Uphold and hide the post';
  if (targetType === 'comment') return 'Uphold and hide the comment';
  if (targetType === 'stream') return 'Uphold and end the stream';
  return 'Uphold the report';
}

const box = { padding: 12, background: C.card2, borderRadius: 10 };
const label = { fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: 6 };
const field = {
  width: '100%', boxSizing: 'border-box', padding: '9px 10px', background: C.bg, border: 0, borderRadius: 8,
  color: C.text, fontFamily: 'DM Sans', fontSize: 12.5, outline: 'none',
};
const btn = (tone, busy) => ({
  padding: '9px 12px', border: 0, borderRadius: 8, fontFamily: 'DM Sans', fontSize: 12.5, fontWeight: 700,
  cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
  background: tone === 'danger' ? C.ember : tone === 'primary' ? C.violet : C.card,
  color: C.text,
});

// ─── The reported thing itself ──────────────────────────────────────────────
// One read when a case opens, so a moderator decides on the content rather than
// on a bare id. Returns the owner's uid through onOwner so the account actions
// can target them.
export function TargetPreview({ row, onOwner }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    (async () => {
      setState({ loading: true });
      try {
        const t = row?.targetType;
        const id = row?.targetId;
        let out = { loading: false, kind: t };
        if (t === 'post' && id) {
          const s = await getDoc(doc(db, 'posts', id));
          const p = s.exists() ? s.data() : null;
          out = { ...out, missing: !p, text: p?.content || p?.text || p?.caption || p?.title || '', media: (p?.mediaUrls || [])[0] || p?.thumbnailUrl || null, owner: p?.userId || p?.authorId || null, hidden: p?.hidden === true || p?.status === 'hidden' };
        } else if (t === 'comment' && id && row.postId) {
          const s = await getDoc(doc(db, 'posts', row.postId, 'comments', id));
          const c = s.exists() ? s.data() : null;
          out = { ...out, missing: !c, text: c?.content || c?.text || '', owner: c?.authorId || c?.userId || null, hidden: c?.hidden === true };
        } else if (t === 'user' && id) {
          const s = await getDoc(doc(db, 'users', id));
          const u = s.exists() ? s.data() : null;
          out = { ...out, missing: !u, name: u?.displayName || u?.username || id, handle: u?.username || '', avatar: u?.avatar || null, owner: u ? id : null, banned: !!u?.banned, mutedUntil: tsMs(u?.mutedUntil) };
        } else if (t === 'stream' && id) {
          const s = await getDoc(doc(db, 'streams', id));
          const st = s.exists() ? s.data() : null;
          out = { ...out, missing: !st, text: st?.title || '', owner: st?.hostUid || null, status: st?.status || '' };
        } else {
          out = { ...out, unsupported: true };
        }
        if (!live) return;
        setState(out);
        onOwner?.(out.owner || null);
      } catch {
        if (live) { setState({ loading: false, error: true }); onOwner?.(null); }
      }
    })();
    return () => { live = false; };
  }, [row?.id, row?.targetType, row?.targetId, row?.postId]);

  const path = targetPath(row);
  return (
    <div style={box}>
      <div style={label}>Reported {row?.targetType || 'item'}</div>
      {state.loading && <div style={{ fontSize: 12, color: C.textMuted }}>Loading…</div>}
      {state.error && <div style={{ fontSize: 12, color: C.ember }}>Could not load it.</div>}
      {state.missing && <div style={{ fontSize: 12, color: C.textMuted }}>It no longer exists.</div>}
      {state.unsupported && (
        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>
          {row?.targetType === 'message'
            ? 'A private message. Its content is not stored where the app can read it; decide on the report detail and the account.'
            : 'Open it on vergr.app to see it.'}
        </div>
      )}
      {state.kind === 'user' && !state.missing && !state.loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {state.avatar
            ? <img src={state.avatar} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
            : <div style={{ width: 36, height: 36, borderRadius: '50%', background: C.card }} />}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{state.name}</div>
            <div style={{ fontSize: 11.5, color: C.textMuted }}>
              {state.handle ? `@${state.handle}` : ''}
              {state.banned ? ' · banned' : ''}
              {state.mutedUntil > Date.now() ? ' · muted' : ''}
            </div>
          </div>
        </div>
      )}
      {state.text && <div style={{ fontSize: 13, color: C.text, lineHeight: 1.55, whiteSpace: 'pre-wrap', maxHeight: 180, overflowY: 'auto' }}>{state.text}</div>}
      {state.media && <img src={state.media} alt="" style={{ marginTop: 8, width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 8, background: C.bg }} />}
      {state.hidden && <div style={{ marginTop: 6, fontSize: 11.5, color: C.gold }}>Already hidden.</div>}
      {state.status && <div style={{ marginTop: 6, fontSize: 11.5, color: C.textMuted }}>Stream {state.status}.</div>}
      {path && (
        <button type="button" onClick={() => openInVergr(path)} style={{ ...btn('neutral'), marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="open_in_new" size={14} /> Open on vergr.app
        </button>
      )}
    </div>
  );
}

// ─── Mute / temp ban / perma ban ────────────────────────────────────────────
export function AccountActions({ uid, name, onDone }) {
  const { showToast } = useUI();
  const auth = useModAuthority();
  const [kind, setKind] = useState(null);      // 'mute' | 'temp' | 'perma'
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (!uid) return null;
  if (!auth.canMute && !auth.canTempBan && !auth.canPermaBan) {
    return (
      <div style={{ ...box, fontSize: 12, color: C.textMuted, lineHeight: 1.5 }}>
        Your rank cannot act on accounts. Escalate the case to a Senior or above.
      </div>
    );
  }

  const cap = kind === 'mute' ? auth.muteMaxHours : kind === 'temp' ? auth.tempBanMaxDays : null;
  const unit = kind === 'mute' ? 'hours' : 'days';
  const n = Number(amount);
  const amountOk = kind === 'perma' || (Number.isInteger(n) && n >= 1 && (cap == null || n <= cap));
  const reasonOk = reason.trim().length >= 4;

  const run = async () => {
    if (!amountOk || !reasonOk || busy) return;
    setBusy(true);
    try {
      const r = reason.trim();
      if (kind === 'mute') await call('vanguardMuteUser', { targetUid: uid, hours: n, reason: r });
      else if (kind === 'temp') await call('vanguardTempBanUser', { targetUid: uid, days: n, reason: r });
      else await call('vanguardPermaBanUser', { targetUid: uid, reason: r });
      showToast?.(kind === 'mute' ? `Muted for ${n} hours.` : kind === 'temp' ? `Banned for ${n} days.` : 'Account banned permanently.', 'success');
      setKind(null); setAmount(''); setReason('');
      onDone?.();
    } catch (e) {
      showToast?.(e?.message || 'That did not go through.', 'error');
    } finally { setBusy(false); }
  };

  const choose = (k, def) => { setKind(k); setAmount(def ? String(def) : ''); };

  return (
    <div style={box}>
      <div style={label}>Act on the account{name ? ` · ${name}` : ''}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {auth.canMute && <button type="button" style={btn(kind === 'mute' ? 'primary' : 'neutral')} onClick={() => choose('mute', Math.min(24, auth.muteMaxHours || 24))}>Mute</button>}
        {auth.canTempBan && <button type="button" style={btn(kind === 'temp' ? 'primary' : 'neutral')} onClick={() => choose('temp', 7)}>Temp ban</button>}
        {auth.canPermaBan && <button type="button" style={btn(kind === 'perma' ? 'danger' : 'neutral')} onClick={() => choose('perma')}>Perma ban</button>}
      </div>
      {kind && (
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          {kind !== 'perma' && (
            <div>
              <input type="number" min={1} max={cap || undefined} value={amount} onChange={(e) => setAmount(e.target.value)} style={field} />
              <div style={{ fontSize: 11, color: amountOk ? C.textMuted : C.ember, marginTop: 4 }}>
                In {unit}{cap != null ? `, up to ${cap} at your rank` : ''}.
              </div>
            </div>
          )}
          <textarea rows={2} placeholder="Reason (the person is told this)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...field, resize: 'vertical' }} />
          {kind === 'perma' && <div style={{ fontSize: 11.5, color: C.gold, lineHeight: 1.5 }}>A permanent ban disables the account. Only the Vergr team can lift it.</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={btn('neutral', busy)} disabled={busy} onClick={() => setKind(null)}>Cancel</button>
            <button type="button" style={btn(kind === 'perma' ? 'danger' : 'primary', busy)} disabled={busy || !amountOk || !reasonOk} onClick={run}>
              {busy ? 'Working…' : kind === 'mute' ? 'Mute' : kind === 'temp' ? 'Ban' : 'Ban permanently'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── End a live stream ──────────────────────────────────────────────────────
// Rides endStreamSession's takedown branch (functions/streaming.js), which
// runs a Vanguard caller through runVanguardAction: rank authority, the 12h
// authenticator session and a vanguard_actions row. The host is told why and
// can appeal.
export function EndStreamAction({ streamId, onDone, compact = false }) {
  const { showToast } = useUI();
  const auth = useModAuthority();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!streamId || !auth.canMute) return null;

  const run = async () => {
    if (reason.trim().length < 4 || busy) return;
    setBusy(true);
    try {
      const r = await call('endStreamSession', { streamId, takedown: true, reason: reason.trim() });
      showToast?.(r?.alreadyEnded ? 'That stream had already ended.' : 'Stream ended. The host has been told why.', 'success');
      setOpen(false); setReason('');
      onDone?.();
    } catch (e) {
      showToast?.(e?.message || 'Could not end the stream.', 'error');
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button type="button" style={{ ...btn('danger'), width: compact ? '100%' : undefined }} onClick={() => setOpen(true)}>
        End stream
      </button>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 8, marginTop: compact ? 8 : 0 }}>
      <textarea rows={2} placeholder="Reason (the host is shown this)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...field, resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" style={btn('neutral', busy)} disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" style={btn('danger', busy)} disabled={busy || reason.trim().length < 4} onClick={run}>{busy ? 'Ending…' : 'End it'}</button>
      </div>
    </div>
  );
}
