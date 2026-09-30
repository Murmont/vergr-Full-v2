// AdminConfigScreen — App Config.
//
// Reads and writes one Firestore doc, app_config/general, through
// functions/adminConfig.js (FIELD_WHITELIST). "Sensitive" switches trigger an
// authenticator step-up via useGuardedCall().
//
// ⚠⚠ EVERY CONTROL ON THIS SCREEN MUST DO SOMETHING. Until 2026-09-21 it
// offered ~50 settings across nine tabs and nothing in the app, the functions
// or the servers read them: Maintenance Mode, Allow New Registrations, an admin
// IP allowlist, a failed-login lockout, a minimum password length, Custom CSS,
// quiet hours, retention periods, languages. Saving them changed nothing. The
// three that matter were wired (maintenance, registrations, DMs) and the rest
// were removed here and from the server allow-list.
// `scripts/admin-config-check.mjs` fails the build if a saved key has no reader.

import { useState, useEffect, useCallback } from 'react';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import AdminShell, { ADMIN_COLORS as C } from './AdminShell';
import { call, fmtRelative, useGuardedCall, Tabs } from './_adminGuarded';

const TABS = [
  { id: 'platform',     label: 'Platform' },
  { id: 'features',     label: 'Features' },
  { id: 'payments',     label: 'Payments' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'system',       label: 'System' },
];

export default function AdminConfigScreen() {
  const [tab, setTab] = useState('platform');
  const { guarded, overlay } = useGuardedCall();
  const { showToast } = useUI();

  // The whole config doc, loaded once and re-fetched after any save.
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);

  // Local draft for save-all flow — sub-tabs use setDraft to stage values.
  const [draft, setDraft] = useState({});
  const dirty = Object.keys(draft).length > 0;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('adminGetConfig');
      setCfg(r.config || {});
      setDraft({});
    } catch (e) {
      showToast(e?.message || 'Failed to load config', 'error');
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const saveDraft = async () => {
    if (!dirty) return;
    await guarded(async () => {
      const r = await call('adminBulkSetConfig', { fields: draft });
      if (r.errors?.length) {
        const failed = r.errors.map(e => e.key || e.field || JSON.stringify(e)).join(', ');
        showToast(`${r.count} saved, ${r.errors.length} failed: ${failed}`, 'error');
      } else {
        showToast(`Saved ${r.count} field${r.count === 1 ? '' : 's'}`, 'success');
      }
      await load();
    });
  };

  const setField = (key, value) => setDraft(d => ({ ...d, [key]: value }));

  // Effective value = draft override OR persisted cfg
  const get = (key, fallback = '') =>
    draft[key] !== undefined ? draft[key] : (cfg?.[key] ?? fallback);

  return (
    <AdminShell
      screen="config"
      title="App Config"
      subtitle="Platform switches. Every one here takes effect for real."
      topBarRight={
        <button
          onClick={saveDraft}
          disabled={!dirty || loading}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 0,
            background: dirty ? C.accent : '#2a2a3e',
            color: dirty ? '#fff' : C.textMuted, fontSize: 13, fontWeight: 700,
            cursor: dirty ? 'pointer' : 'not-allowed',
          }}
        >
          {dirty ? `Save Changes (${Object.keys(draft).length})` : 'No Changes'}
        </button>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20 }}>
        <div style={{ minWidth: 0 }}>
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
          {loading && <div style={{ color: C.textDim, padding: 24 }}>Loading…</div>}
          {!loading && tab === 'platform'     && <PlatformTab get={get} setField={setField} />}
          {!loading && tab === 'features'     && <FeaturesTab get={get} setField={setField} />}
          {!loading && tab === 'payments'     && <PaymentsTab get={get} setField={setField} />}
          {!loading && tab === 'integrations' && <IntegrationsTab />}
          {!loading && tab === 'system'       && <SystemTab cfg={cfg} />}
        </div>
        <RightRail cfg={cfg} dirty={dirty} />
      </div>
      {overlay}
    </AdminShell>
  );
}

// ───────────────────────────────────────────────────────────
// Form primitives
// ───────────────────────────────────────────────────────────

function Group({ title, icon, color = C.accent, children }) {
  return (
    <div style={{ background: C.card, borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        {icon && (
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: '#1c1c2c', color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name={icon} size={17} />
          </div>
        )}
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>{title}</h3>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  );
}

function Choice({ label, hint, value, onChange, options, sensitive }) {
  return (
    <div style={{ padding: '10px 12px', background: '#0a0a14', borderRadius: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{label}{sensitive && (<span title="Needs a fresh authenticator code" style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#3a2c0c', color: '#f0a500', marginLeft: 8 }}>2FA</span>)}</div>
      {hint && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2, lineHeight: 1.5 }}>{hint}</div>}
      <div className="flex gap-2 mt-2">
        {options.map(([v, l]) => (
          <button key={v} type="button" onClick={() => v !== value && onChange(v)}
            className="rounded-lg px-3 py-1.5 text-xs font-bold"
            style={v === value ? { background: '#7c3aed', color: '#fff' } : { background: '#1C1B26', color: '#9CA3AF' }}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, hint, value, onChange, sensitive }) {
  const on = !!value;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 12px', background: '#0a0a14', borderRadius: 8,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          {label}
          {sensitive && (
            <span title="Needs a fresh authenticator code"
              style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                background: '#3a2c0c', color: '#f0a500' }}>2FA</span>
          )}
        </div>
        {hint && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2, lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        style={{
          flexShrink: 0, width: 42, height: 24, borderRadius: 999,
          background: on ? C.accent : '#2a2a3e', border: 0,
          position: 'relative', cursor: 'pointer',
          transition: 'background .15s',
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: on ? 20 : 2,
          width: 20, height: 20, borderRadius: '50%', background: '#fff',
          transition: 'left .15s',
        }} />
      </button>
    </div>
  );
}

function Note({ children }) {
  return <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6 }}>{children}</div>;
}

// ───────────────────────────────────────────────────────────
// Sub-tabs
// ───────────────────────────────────────────────────────────

function PlatformTab({ get, setField }) {
  return (
    <Group title="Platform switches" icon="settings" color="#3b82f6">
      <Toggle label="Maintenance mode" sensitive
        hint="Replaces every app screen with the maintenance page. The public site (Terms, help, downloads) and sign-in stay open. Staff accounts keep using the app, under a banner."
        value={get('maintenanceMode', false)} onChange={v => setField('maintenanceMode', v)} />
      <Toggle label="Allow new registrations" sensitive
        hint="Off stops new accounts from email sign-up, guest conversion and first-time Google sign-in. Existing accounts and guest browsing are unaffected."
        value={get('allowNewRegistrations', true)} onChange={v => setField('allowNewRegistrations', v)} />
      <Toggle label="Allow direct messages" sensitive
        hint="Off pauses sending in DMs and group chats, for everyone. People can still read. The chat server enforces it, not just the app. Squad chat and live-stream chat are not affected."
        value={get('allowDirectMessages', true)} onChange={v => setField('allowDirectMessages', v)} />
    </Group>
  );
}

function FeaturesTab({ get, setField }) {
  const streamingOn = !get('liveStreamingPaused', false);
  return (
    <Group title="Features" icon="extension" color="#7c3aed">
      <Toggle label="Live streaming" sensitive
        hint="Master switch. Off refuses every new stream, from the phone, the browser and OBS. Streams already live carry on."
        value={streamingOn} onChange={v => setField('liveStreamingPaused', !v)} />
      <Toggle label="Follower minimum to go live publicly"
        hint="On: a free account needs 100 followers and a 50-coin Stream Boost to stream in public. Off: anyone can go live in public, free."
        value={get('streamFollowerGateEnabled', true)} onChange={v => setField('streamFollowerGateEnabled', v)} />
    </Group>
  );
}

function PaymentsTab({ get, setField }) {
  return (
    <>
      <Group title="Kill switches" icon="power_settings_new" color="#f04060">
        <Toggle label="Pause revenue-share accrual" sensitive
          hint="Stops earned coins accruing a creator share. For use during an economy investigation."
          value={get('conversionsPaused', false)} onChange={v => setField('conversionsPaused', v)} />
        <Toggle label="Pause creator payouts" sensitive
          hint="The scheduled payout run skips everyone. Accrual continues, so nothing is lost; creators are paid on the next run after this is resumed."
          value={get('payoutsPaused', false)} onChange={v => setField('payoutsPaused', v)} />
        <Toggle label="Pause tipping" sensitive
          hint="Refuses every coin tip platform-wide."
          value={get('tipsPaused', false)} onChange={v => setField('tipsPaused', v)} />
      </Group>

      <Group title="Coda checkout (browser)" icon="credit_card" color="#7c3aed">
        <Note>
          Codapay, the second browser card rail beside PayRam. The buyer pays the
          normal price: the Coda agreement (clause 4.1) forbids adding Coda's fee.
          While Coda is in sandbox only staff can pay, because a test payment would
          otherwise credit real coins. It opens to everyone once the production key
          is installed. Coda reports: {get('codaEnv', 'sandbox') === 'production' ? 'production' : 'sandbox'}.
        </Note>
        <Choice label="Who can pay with Coda" sensitive
          value={get('codaCheckout', 'on')} onChange={v => setField('codaCheckout', v)}
          options={[['on', 'Everyone'], ['staff', 'Staff only'], ['off', 'Off']]} />
        <Toggle label="Saved cards" sensitive
          hint="Shows Coda's 'save card for next time' and the buyer's saved cards. Turn on only after Coda has enabled saved cards for Vergr."
          value={get('codaSaveCards', false)} onChange={v => setField('codaSaveCards', v)} />
        <Toggle label="Google Play user choice billing" sensitive
          hint="In the Play app, lets Google's choice screen offer Vergr's own checkout where Google runs user choice billing. Turn on only after Google approves the program. Billing choice and alternative billing switch on by themselves once Google allows them."
          value={get('playUserChoiceBilling', false)} onChange={v => setField('playUserChoiceBilling', v)} />
      </Group>

      <Group title="Creator payouts (read-only)" icon="payments" color="#f5c542">
        <Note>
          Nobody can withdraw. Vergr pays creators their revenue share on its own
          schedule. The minimum payout is $100 (<code>MIN_PAYOUT_MICRO_USD</code> in
          functions/creatorPayouts.js), and a creator's first payout also waits
          until the account is 30 days old.
        </Note>
      </Group>

      <Group title="How people pay (read-only)" icon="credit_card" color="#7c3aed">
        <Note>
          Web and desktop take card and crypto through PayRam (self-hosted,
          settles in USDC on Base). The Google Play build sells through Google
          Play Billing only, and the AppGallery build through HUAWEI IAP only.
          Rotate credentials in Firebase Secrets; never store them here.
        </Note>
      </Group>
    </>
  );
}

// What the platform actually talks to. Listed from the code, not from a wish
// list: until 2026-09-21 this showed Battle.net, Steam, Xbox, Apex Legends,
// Riot and Epic as "configured" long after those integrations were removed.
// No status pill: this screen does not check them, so it does not claim to.
const INTEGRATIONS = [
  { name: 'PayRam',              cat: 'Payments', note: 'Card and crypto on web and desktop' },
  { name: 'Google Play Billing', cat: 'Payments', note: 'Google Play build only' },
  { name: 'HUAWEI IAP',          cat: 'Payments', note: 'AppGallery build only' },
  { name: 'Circle',              cat: 'Payments', note: 'USDC wallet on Base (deposit reconciliation)' },
  { name: 'Didit',               cat: 'Identity', note: 'Creator identity checks before payouts' },
  { name: 'Gemini',              cat: 'AI',       note: 'Post, image and chat moderation' },
  { name: 'Cloudflare R2 + CDN', cat: 'Media',    note: 'Every upload, served from cdn.vergr.app' },
  { name: 'Twitch',              cat: 'Sign-in',  note: 'Account linking and the stream mirror' },
  { name: 'Discord',             cat: 'Sign-in',  note: 'Account linking and server import into Groups' },
  { name: 'Shopify',             cat: 'Commerce', note: 'VLink app and shop sync' },
];

function IntegrationsTab() {
  return (
    <Group title="Integrations in use" icon="hub" color="#7c3aed">
      <Note>
        Read-only. Rotate credentials with{' '}
        <code style={{ background: '#0a0a14', padding: '1px 6px', borderRadius: 4 }}>firebase functions:secrets:set</code>.
        Live health for the services Vergr runs itself is in the System Status panel on the right.
      </Note>
      {INTEGRATIONS.map(p => (
        <div key={p.name} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 12px', background: '#0a0a14', borderRadius: 8,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{p.name}</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{p.note}</div>
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '.06em' }}>{p.cat}</span>
        </div>
      ))}
    </Group>
  );
}

function SystemTab({ cfg }) {
  return (
    <Group title="System info" icon="info" color="#7c3aed">
      <Row label="Firebase project" value="vergr-44494" />
      <Row label="Functions region" value="europe-west1" />
      <Row label="Firestore database" value="vgrdb" />
      <Row label="Last config update" value={cfg?._updatedAt ? fmtRelative(cfg._updatedAt) : '—'} />
    </Group>
  );
}

function Row({ label, value }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 12px', background: '#0a0a14', borderRadius: 8,
    }}>
      <span style={{ fontSize: 12, color: C.textDim }}>{label}</span>
      <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Right rail: summary + live system status
// ───────────────────────────────────────────────────────────

function RightRail({ cfg, dirty }) {
  const [health, setHealth] = useState(null);
  useEffect(() => {
    let active = true;
    call('adminGetSystemHealth').then(r => { if (active) setHealth(r); }).catch(() => {});
    return () => { active = false; };
  }, []);

  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: C.card, borderRadius: 12, padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>Configuration</h3>
        <Row label="Last updated" value={cfg?._updatedAt ? fmtRelative(cfg._updatedAt) : '—'} />
        <div style={{ height: 8 }} />
        <Row label="Unsaved changes" value={dirty ? 'Yes' : 'No'} />
      </div>

      <div style={{ background: C.card, borderRadius: 12, padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>System status</h3>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10 }}>Checked live when this screen opens.</div>
        {!health && <div style={{ fontSize: 12, color: C.textDim }}>Checking…</div>}
        {health?.services?.map(s => {
          const ok = s.status === 'healthy';
          return (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: ok ? '#22c55e' : '#f04060', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: C.text, flex: 1 }}>{s.name}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: ok ? '#22c55e' : '#f04060', textTransform: 'uppercase' }}>
                {ok ? 'OK' : 'Down'}
              </span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
