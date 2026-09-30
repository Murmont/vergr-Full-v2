// Admin → Economy → Payments
//
// Every purchase that did not go cleanly, plus every credited purchase, in one
// place, with the controls to fix it without a developer. Plan and reasoning:
// docs/PAYMENTS_ADMIN_PLAN.md. Server: functions/paymentAdmin.js, reached
// through adminListTransactions with an `op`.
//
// Reads (list, detail, provider view) need economy access. Every action
// (re-check, credit, remove coins, refund, ban, note, resolve) also asks for a
// fresh 2FA code through useGuardedCall and is written to the admin audit log.

import { useState, useEffect, useCallback } from 'react';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import { ADMIN_COLORS as C } from './AdminShell';
import { call, fmtNumber, fmtTime, fmtRelative, ReasonPrompt, KpiCard } from './_adminGuarded';

const payments = (op, data = {}) => call('adminListTransactions', { op, ...data });

const VIEWS = [
  { id: 'attention',   label: 'Needs attention' },
  { id: 'incidents',   label: 'All issues' },
  { id: 'google_play', label: 'Google Play' },
  { id: 'appgallery',  label: 'AppGallery' },
  { id: 'coda',        label: 'Coda' },
];

const ROUTE_LABEL = {
  google_play: 'Google Play', google_play_sub: 'Google Play plan',
  appgallery: 'AppGallery', appgallery_sub: 'AppGallery plan',
  coda: 'Coda', codashop: 'Codashop',
};

const STATUS_TONE = {
  credited: '#22c55e', credited_manually: '#22c55e', resolved: '#22c55e',
  failed: '#f04060', charged_back: '#f04060',
  refunded: '#f5a524', pending: '#f5a524', awaiting: '#f5a524',
  cancelled: '#7070a0', abandoned: '#7070a0', expired: '#7070a0',
};

const STAGE_LABEL = {
  validate: 'Request checked', ledger_check: 'Checked for an earlier credit',
  provider_check: 'Asked the payment provider', purchase_state: 'Checked the payment state',
  account_check: 'Checked the buying account', credit: 'Crediting', acknowledge: 'Confirming with Google',
  apply_plan: 'Applying the plan', plan_check: 'Checked the plan', create_checkout: 'Starting checkout',
  payment_failed: 'Payment declined', abandoned: 'Checkout abandoned', settle_failed: 'Crediting a paid order',
  play_unreported: 'Reporting the sale to Google', credited: 'Credited', admin_recheck: 'Admin re-check',
  admin_credit: 'Admin credit', admin_refund: 'Admin refund', admin_note: 'Note', coins_revoked: 'Coins removed',
  resolved: 'Resolved', backfilled: 'Recorded by hand', redeem: 'Purchase check',
};

export default function AdminPaymentsTab({ guarded }) {
  const { showToast } = useUI();
  const [summary, setSummary] = useState(null);
  const [view, setView] = useState('attention');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [route, setRoute] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState({});
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null); // { source, id, uid }

  const loadSummary = useCallback(async () => {
    try { setSummary(await payments('summary')); } catch (e) { showToast(e?.message || 'Could not load payment totals', 'error'); }
  }, [showToast]);

  const load = useCallback(async (cursor = null) => {
    setLoading(true);
    try {
      const r = await payments('list', { view, search: query || null, route: route || null, status: status || null, cursor, pageSize: 50 });
      setRows((prev) => (cursor ? [...prev, ...r.rows.filter((x) => !prev.some((p) => p.id === x.id && p.source === x.source))] : r.rows));
      setUsers((prev) => ({ ...prev, ...r.users }));
      setNextCursor(r.nextCursor || null);
    } catch (e) {
      showToast(e?.message || 'Could not load payments', 'error');
    }
    setLoading(false);
  }, [view, query, route, status, showToast]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { setRows([]); setNextCursor(null); load(null); }, [load]);

  const refreshAll = () => { loadSummary(); load(null); };
  const isIssues = view === 'attention' || view === 'incidents';

  const exportCsv = () => {
    const head = ['when', 'source', 'route', 'status', 'buyer', 'uid', 'product', 'order', 'amount', 'currency', 'coins', 'error_code', 'provider_status', 'provider_message', 'attention'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((r) => [
      r.at ? new Date(r.at).toISOString() : '', r.source, r.route, r.status, users[r.uid]?.username || '', r.uid,
      r.productId, r.orderId, r.amount ?? r.amountUSD ?? '', r.currency || (r.amountUSD != null ? 'USD' : ''), r.coins ?? '',
      r.error?.code, r.error?.providerStatus, r.error?.providerMessage, r.attentionReason,
    ].map(esc).join(','));
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `payments_${view}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="priority_high" color="#f04060" label="Needs attention" value={summary ? fmtNumber(summary.attention) : '…'} sub="open problems" />
        <KpiCard icon="error" color="#f5a524" label="Issues today" value={summary ? fmtNumber(summary.today.incidents) : '…'} sub="failed or abandoned" />
        <KpiCard icon="shop" color="#22c55e" label="Google Play today" value={summary ? fmtNumber(summary.today.google_play) : '…'} sub="credited" />
        <KpiCard icon="storefront" color="#3d7fff" label="AppGallery today" value={summary ? fmtNumber(summary.today.appgallery) : '…'} sub="credited" />
        <KpiCard icon="credit_card" color={C.accent2} label="Coda today" value={summary ? `${fmtNumber(summary.today.coda_settled)} / ${fmtNumber(summary.today.coda_orders)}` : '…'} sub="paid / started" />
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => setView(v.id)} style={pill(view === v.id)}>
            {v.label}{v.id === 'attention' && summary?.attention ? ` · ${summary.attention}` : ''}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); }} style={{ display: 'flex', gap: 6, flex: '1 1 320px' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="@username, user id, GPA.… or coda_… order id" style={{ ...inputStyle, marginBottom: 0 }} />
          <button type="submit" style={miniBtn(C.accent)}>Search</button>
          {query && <button type="button" onClick={() => { setSearch(''); setQuery(''); }} style={miniBtn(C.textDim, true)}>Clear</button>}
        </form>
        {isIssues && (
          <>
            <select value={route} onChange={(e) => setRoute(e.target.value)} style={smallSelect}>
              <option value="">All routes</option>
              {Object.entries(ROUTE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={smallSelect}>
              <option value="">All statuses</option>
              {['failed', 'pending', 'cancelled', 'abandoned', 'credited', 'credited_manually', 'refunded', 'charged_back', 'resolved'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </>
        )}
        <button onClick={refreshAll} style={miniBtn(C.textDim, true)}><Icon name="refresh" size={14} /></button>
        <button onClick={exportCsv} disabled={!rows.length} style={miniBtn(C.textDim, true)}>Export CSV</button>
        <button
          onClick={async () => {
            try {
              const r = await guarded(() => payments('syncRefunds'));
              const t = r?.tally || {};
              const n = Object.entries(t).map(([k, v]) => `${v} ${k}`).join(', ');
              showToast(n ? `Google refunds checked: ${n}` : 'Google refunds checked: nothing new', 'success');
              refreshAll();
            } catch { /* guarded showed it */ }
          }}
          style={miniBtn('#f5a524', true)}
          title="Runs every night automatically; this runs it now">
          Check Google refunds now
        </button>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead>
              <tr style={{ background: C.card2 }}>
                {['When', 'Buyer', 'Route', 'Product', 'Status', 'Amount', isIssues ? 'What went wrong' : 'Order'].map((h) => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const u = users[r.uid] || {};
                return (
                  <tr key={`${r.source}_${r.id}`} onClick={() => setOpen({ source: r.source, id: r.id, uid: r.uid })}
                    style={{ borderTop: `1px solid ${C.border}`, cursor: 'pointer', background: r.needsAttention ? '#f0406010' : 'transparent' }}>
                    <td style={{ ...td, fontSize: 11, color: C.textDim, whiteSpace: 'nowrap' }} title={fmtTime(r.at)}>{fmtRelative(r.at)}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <UserAvatar src={u.avatar} size={22} />
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{u.username ? `@${u.username}` : (r.uid || '').slice(0, 8) || '—'}</span>
                      </div>
                    </td>
                    <td style={{ ...td, fontSize: 11 }}>{ROUTE_LABEL[r.route] || r.route}{r.test ? ' · test' : ''}</td>
                    <td style={{ ...td, fontSize: 11, fontFamily: 'DM Mono, monospace' }}>{r.productId || '—'}</td>
                    <td style={td}><StatusPill status={r.status} /></td>
                    <td style={{ ...td, fontSize: 12 }} className="font-dmmono tabular-nums">{amountText(r)}</td>
                    <td style={{ ...td, fontSize: 11, color: C.textDim, maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isIssues ? (r.attentionReason || errorLine(r.error) || '—') : (r.orderId || '—')}
                    </td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: C.textDim, fontSize: 13 }}>
                  {view === 'attention' ? 'Nothing needs attention.' : 'Nothing matches.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: 12, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 11, color: C.textDim }}>{loading ? 'Loading…' : `${rows.length} shown`}</div>
          {nextCursor && <button onClick={() => load(nextCursor)} disabled={loading} style={miniBtn(C.accent)}>Load more</button>}
        </div>
      </div>

      {open && (
        <PaymentDetail
          target={open}
          guarded={guarded}
          onClose={() => setOpen(null)}
          onChanged={refreshAll}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// The transaction page
// ─────────────────────────────────────────────────────────────────────

function PaymentDetail({ target, guarded, onClose, onChanged }) {
  const { showToast } = useUI();
  const [data, setData] = useState(null);
  const [provider, setProvider] = useState(null);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState(null);

  const load = useCallback(async () => {
    try { setData(await payments('get', target)); } catch (e) { showToast(e?.message || 'Could not open this payment', 'error'); onClose(); }
  }, [target, showToast, onClose]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <Drawer onClose={onClose}><div style={{ padding: 30, color: C.textDim, fontSize: 13 }}>Loading…</div></Drawer>;
  const { record: r, buyer: b } = data;
  const isIncident = data.source === 'incidents';
  const orderId = r.orderId || (data.source === 'coda' ? data.id : null);

  const act = async (op, extra, doneMsg) => {
    setBusy(true);
    try {
      const out = await guarded(() => payments(op, { source: data.source, id: data.id, ...extra }));
      if (out && out.ok === false) showToast(errorLine(out.error) || 'The provider still refuses this purchase', 'error');
      else showToast(doneMsg, 'success');
      await load(); onChanged();
    } catch { /* guarded already showed it */ }
    setBusy(false);
  };

  const refreshProvider = async () => {
    setBusy(true);
    try { setProvider(await payments('provider', { orderId })); } catch (e) { showToast(e?.message || 'Provider lookup failed', 'error'); }
    setBusy(false);
  };

  return (
    <Drawer onClose={onClose}>
      <div style={{ padding: 20, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <StatusPill status={r.status} big />
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{ROUTE_LABEL[r.route] || r.route || ROUTE_LABEL[data.source] || data.source}</span>
          <span style={{ fontSize: 12, color: C.textDim, fontFamily: 'DM Mono, monospace' }}>{r.productId || r.packSku || ''}</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={miniBtn(C.textDim, true)}><Icon name="close" size={14} /></button>
        </div>
        {r.needsAttention && (
          <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: '#f0406018', border: '1px solid #f0406040', color: '#ff8aa0', fontSize: 12 }}>
            <b>Needs attention:</b> {r.attentionReason}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 14 }}>
          <Fact k="Order" v={orderId || '—'} mono />
          <Fact k="Started" v={fmtTime(r.createdAt)} />
          <Fact k="Last event" v={fmtTime(r.lastEventAt || r.creditedAt || r.settledAt)} />
          {r.attempts != null && <Fact k="Attempts" v={fmtNumber(r.attempts)} />}
          {r.coins != null && <Fact k="Coins" v={fmtNumber(r.coins)} />}
          {r.coinsToCredit != null && <Fact k="Coins" v={fmtNumber(r.coinsToCredit)} />}
          {r.localPrice != null && <Fact k="Charged" v={`${r.localPrice} ${r.localCurrency || ''}`} />}
          {r.amountUSD != null && <Fact k="USD" v={`$${Number(r.amountUSD).toFixed(2)}`} />}
          {r.priceUSD != null && <Fact k="Shelf price" v={`$${Number(r.priceUSD).toFixed(2)}`} />}
          {r.codaMethod && <Fact k="Method" v={r.codaMethod} />}
          {r.codaTax != null && <Fact k="Tax" v={String(r.codaTax)} />}
          {r.buyerFeesUSD != null && <Fact k="Buyer fees" v={`$${Number(r.buyerFeesUSD).toFixed(2)}`} />}
          {r.codaTxnId && <Fact k="Coda txn" v={r.codaTxnId} mono />}
          {r.tokenHash && <Fact k="Token (hash)" v={r.tokenHash} mono />}
          {r.lastError?.providerStatus && <Fact k="Provider said" v={`${r.lastError.providerStatus} · ${r.lastError.providerMessage || ''}`} />}
        </div>
      </div>

      {b && (
        <Section title="Buyer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <UserAvatar src={b.avatar} size={36} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{b.username ? `@${b.username}` : b.uid}</div>
              <div style={{ fontSize: 11, color: C.textDim }}>{b.email || 'no email on file'} · joined {fmtRelative(b.createdAt)}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
            <Fact k="Coin balance" v={fmtNumber(b.balance)} tone={b.balance < 0 ? '#f04060' : undefined} />
            <Fact k="Boost coins" v={fmtNumber(b.boostCoins)} />
            <Fact k="Country" v={b.country || '—'} />
            <Fact k="Plan" v={b.plan || 'free'} />
            <Fact k="Payment issues" v={b.incidentCount == null ? '—' : fmtNumber(b.incidentCount)} />
            <Fact k="Buying" v={b.purchaseBanUntil && b.purchaseBanUntil > Date.now() ? `blocked until ${new Date(b.purchaseBanUntil).toLocaleDateString()}` : 'allowed'} tone={b.purchaseBanUntil > Date.now() ? '#f04060' : undefined} />
          </div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 8, fontFamily: 'DM Mono, monospace' }}>{b.uid}</div>
        </Section>
      )}

      <Section title="Provider" right={orderId && <button onClick={refreshProvider} disabled={busy} style={miniBtn(C.accent)}>Refresh from {/^GPA\./.test(orderId) ? 'Google' : 'Coda'}</button>}>
        {!orderId && <div style={{ fontSize: 12, color: C.textDim }}>No provider order id on this record yet, so there is nothing to look up. A Google order id appears once Google confirms the purchase.</div>}
        {orderId && !provider && <div style={{ fontSize: 12, color: C.textDim }}>Press Refresh to ask the provider for its live view of this order.</div>}
        {provider && <ProviderView p={provider} />}
      </Section>

      <Section title="Timeline">
        {r.events?.length ? r.events.map((e, i) => <TimelineRow key={i} e={e} />) : <div style={{ fontSize: 12, color: C.textDim }}>
          {data.source === 'coda' ? `Created ${fmtTime(r.createdAt)}${r.settledAt ? `, paid and credited ${fmtTime(r.settledAt)}` : ''}${r.expiredAt ? `, closed ${fmtTime(r.expiredAt)} (${r.lastStatus || ''})` : ''}.`
            : `Credited ${fmtTime(r.creditedAt)} with no problems.`}
        </div>}
      </Section>

      <Section title="Actions">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {r.canRecheck && <button disabled={busy} onClick={() => act('recheck', {}, 'Re-checked with the provider')} style={miniBtn(C.accent)}>Re-check with provider</button>}
          {isIncident && b && <button disabled={busy} onClick={() => setPrompt('credit')} style={miniBtn('#22c55e')}>Credit coins</button>}
          {b && <button disabled={busy} onClick={() => setPrompt('remove')} style={miniBtn('#f04060', true)}>Remove coins</button>}
          {r.canRefund && <button disabled={busy} onClick={() => setPrompt('refund')} style={miniBtn('#f5a524', true)}>Refund via Google Play</button>}
          {b && (b.purchaseBanUntil > Date.now()
            ? <button disabled={busy} onClick={() => act('purchaseBan', { uid: b.uid, days: 0 }, 'Buying allowed again')} style={miniBtn(C.textDim, true)}>Lift buying block</button>
            : <button disabled={busy} onClick={() => setPrompt('ban')} style={miniBtn('#f04060', true)}>Block from buying</button>)}
          {isIncident && <button disabled={busy} onClick={() => setPrompt('note')} style={miniBtn(C.textDim, true)}>Add note</button>}
          {isIncident && r.status !== 'resolved' && <button disabled={busy} onClick={() => setPrompt('resolve')} style={miniBtn('#22c55e', true)}>Mark resolved</button>}
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 10 }}>Every action asks for your authenticator code and is written to the audit log.</div>
      </Section>

      {prompt === 'credit' && (
        <ReasonPrompt title="Credit coins" danger={false}
          message="Adds coins to the buyer's wallet, recorded against this payment. Use when you have confirmed they paid."
          extraField={{ label: 'Coins', type: 'number', required: true, defaultValue: r.coinsToCredit || '' }}
          onCancel={() => setPrompt(null)}
          onConfirm={({ reason, extra }) => { setPrompt(null); act('credit', { coins: Number(extra), reason }, 'Coins credited'); }} />
      )}
      {prompt === 'remove' && (
        <ReasonPrompt title="Remove coins"
          message="Takes coins back. If the buyer has already spent them the wallet goes negative, and their next purchase repays it first."
          extraField={{ label: 'Coins', type: 'number', required: true }}
          onCancel={() => setPrompt(null)}
          onConfirm={({ reason, extra }) => { setPrompt(null); act('removeCoins', { uid: b.uid, coins: Number(extra), reason }, 'Coins removed'); }} />
      )}
      {prompt === 'refund' && (
        <ReasonPrompt title="Refund through Google Play"
          message={`Google refunds order ${orderId} to the buyer. Type "revoke" in the box above to also take the item back on their phone. Coins are not removed automatically: use Remove coins for that.`}
          extraField={{ label: 'Type revoke to also revoke the item (optional)', placeholder: 'revoke' }}
          onCancel={() => setPrompt(null)}
          onConfirm={({ reason, extra }) => { setPrompt(null); act('refund', { orderId, revoke: String(extra).trim().toLowerCase() === 'revoke', reason }, 'Refund sent to Google'); }} />
      )}
      {prompt === 'ban' && (
        <ReasonPrompt title="Block from buying"
          message="Stops this account from buying coins for the number of days you set. You can lift it any time."
          extraField={{ label: 'Days', type: 'number', required: true, defaultValue: 90 }}
          onCancel={() => setPrompt(null)}
          onConfirm={({ reason, extra }) => { setPrompt(null); act('purchaseBan', { uid: b.uid, days: Number(extra), reason }, 'Buying blocked'); }} />
      )}
      {prompt === 'note' && (
        <ReasonPrompt title="Add a note" danger={false} placeholder="Note (only admins see this)"
          message="Added to this payment's timeline."
          onCancel={() => setPrompt(null)}
          onConfirm={({ reason }) => { setPrompt(null); act('note', { text: reason }, 'Note added'); }} />
      )}
      {prompt === 'resolve' && (
        <ReasonPrompt title="Mark resolved" danger={false} placeholder="What was done"
          message="Takes it off the Needs attention list. The note stays on the timeline."
          onCancel={() => setPrompt(null)}
          onConfirm={({ reason }) => { setPrompt(null); act('resolve', { text: reason }, 'Resolved'); }} />
      )}
    </Drawer>
  );
}

function ProviderView({ p }) {
  if (!p.ok) return <div style={{ fontSize: 12, color: '#ff8aa0' }}>{p.provider ? `${p.provider}: ` : ''}{p.error || `state ${p.state || 'unknown'}`}</div>;
  if (p.provider === 'coda') return <Fact k="Coda says" v={p.state} />;
  const o = p.order || {};
  const money = (m) => (m ? `${m.units || 0}.${String(Math.round((m.nanos || 0) / 1e7)).padStart(2, '0')} ${m.currencyCode || ''}` : '—');
  const hist = o.orderHistory || {};
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
      <Fact k="Google state" v={o.state || '—'} tone={/REFUND/.test(o.state || '') ? '#f5a524' : undefined} />
      <Fact k="Total" v={money(o.total)} />
      <Fact k="Tax" v={money(o.tax)} />
      <Fact k="Your revenue" v={money(o.developerRevenueInBuyerCurrency)} />
      <Fact k="Buyer region" v={[o.buyerAddress?.buyerCountry, o.buyerAddress?.buyerState].filter(Boolean).join(' / ') || '—'} />
      <Fact k="Channel" v={o.salesChannel || '—'} />
      <Fact k="Created" v={o.createTime ? fmtTime(Date.parse(o.createTime)) : '—'} />
      {o.pointsDetails && <Fact k="Play Points" v={String(o.pointsDetails.pointsSpent || '')} />}
      {hist.refundEvent && <Fact k="Refund" v={`${hist.refundEvent.refundReason || ''} ${hist.refundEvent.eventTime || ''}`} tone="#f04060" />}
      {hist.cancellationEvent && <Fact k="Cancelled" v={hist.cancellationEvent.eventTime || ''} tone="#f5a524" />}
    </div>
  );
}

function TimelineRow({ e }) {
  const tone = STATUS_TONE[e.status] || C.textDim;
  return (
    <div style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: `1px solid ${C.border}` }}>
      <div style={{ width: 8, height: 8, borderRadius: 4, background: tone, marginTop: 5, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>
          {STAGE_LABEL[e.type] || e.type} <span style={{ color: C.textDim, fontWeight: 400 }}>· {e.source} · {fmtTime(e.at)}</span>
        </div>
        {e.error && <div style={{ fontSize: 11, color: '#ff8aa0', marginTop: 2, fontFamily: 'DM Mono, monospace', wordBreak: 'break-word' }}>{errorLine(e.error, true)}</div>}
        {e.detail && <div style={{ fontSize: 11, color: C.textDim, marginTop: 2, wordBreak: 'break-word' }}>{e.detail}</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Small parts
// ─────────────────────────────────────────────────────────────────────

function errorLine(e, full = false) {
  if (!e) return '';
  const parts = [e.code, e.providerStatus && `${e.provider || 'provider'} ${e.providerStatus}`, e.providerMessage || e.message];
  if (full && e.providerApi) parts.push(`(${e.providerApi})`);
  return parts.filter(Boolean).join(' · ');
}

function amountText(r) {
  if (r.amount != null && r.currency) return `${r.amount} ${r.currency}`;
  if (r.amountUSD != null) return `$${Number(r.amountUSD).toFixed(2)}`;
  if (r.coins != null) return `${fmtNumber(r.coins)} coins`;
  return '—';
}

function StatusPill({ status, big = false }) {
  const tone = STATUS_TONE[status] || C.textDim;
  return (
    <span style={{
      display: 'inline-block', padding: big ? '4px 10px' : '2px 8px', borderRadius: 999,
      background: `${tone}22`, color: tone, fontSize: big ? 12 : 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>{String(status || 'unknown').replace(/_/g, ' ')}</span>
  );
}

function Fact({ k, v, mono = false, tone }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, color: C.textDim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</div>
      <div style={{ fontSize: 12, color: tone || C.text, marginTop: 2, fontFamily: mono ? 'DM Mono, monospace' : undefined, wordBreak: 'break-all' }}>{v}</div>
    </div>
  );
}

function Section({ title, right, children }) {
  return (
    <div style={{ padding: 20, borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', flex: 1 }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Drawer({ onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 640, maxWidth: '100vw', height: '100%', overflowY: 'auto', background: C.bg, borderLeft: `1px solid ${C.border}` }}>
        {children}
      </div>
    </div>
  );
}

const pill = (active) => ({
  padding: '7px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  border: 0, background: active ? C.accent : C.card2, color: active ? '#fff' : C.textDim,
});
const inputStyle = {
  width: '100%', padding: '8px 12px', background: '#0a0a14', border: `1px solid ${C.border}`,
  borderRadius: 8, color: C.text, fontSize: 13,
};
const smallSelect = {
  padding: '7px 10px', background: '#0a0a14', border: `1px solid ${C.border}`,
  borderRadius: 6, color: C.text, fontSize: 12, appearance: 'none', cursor: 'pointer',
};
const th = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' };
const td = { padding: '12px 14px', fontSize: 12, color: C.text };
const miniBtn = (color, ghost = false) => ({
  padding: '6px 11px', borderRadius: 6, border: `1px solid ${color}`,
  background: ghost ? 'transparent' : `${color}25`,
  color, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
});
