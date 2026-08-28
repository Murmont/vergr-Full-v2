// AdminConfigScreen — /admin/config
//
// 9 sub-tabs that all read+write a single Firestore doc: app_config/general.
// Whitelist enforced server-side in functions/adminConfig.js (FIELD_WHITELIST).
//
// "Sensitive" fields (maintenance mode, kill switches, custom CSS) trigger an
// automatic TOTP step-up via useGuardedCall().

import { useState, useEffect, useCallback } from 'react';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import AdminShell, { ADMIN_COLORS as C } from './AdminShell';
import { call, fmtRelative, useGuardedCall, Tabs } from './_adminGuarded';

const TABS = [
  { id: 'general',       label: 'General' },
  { id: 'features',      label: 'Features & Modules' },
  { id: 'security',      label: 'Security' },
  { id: 'payments',      label: 'Payments' },
  { id: 'integrations',  label: 'Integrations' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'appearance',    label: 'Appearance' },
  { id: 'localization',  label: 'Localization' },
  { id: 'system',        label: 'System' },
];

export default function AdminConfigScreen() {
  const [tab, setTab] = useState('general');
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
      subtitle="Manage global app configuration, features, and system preferences."
      topBarRight={
        <button
          onClick={saveDraft}
          disabled={!dirty || loading}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 0,
            background: dirty ? C.accent : '#2a2a3e',
            color: '#fff', fontSize: 13, fontWeight: 700,
            cursor: dirty ? 'pointer' : 'not-allowed',
            opacity: dirty ? 1 : 0.5,
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
          {!loading && tab === 'general'       && <GeneralTab get={get} setField={setField} />}
          {!loading && tab === 'features'      && <FeaturesTab get={get} setField={setField} />}
          {!loading && tab === 'security'      && <SecurityTab get={get} setField={setField} />}
          {!loading && tab === 'payments'      && <PaymentsTab get={get} setField={setField} />}
          {!loading && tab === 'integrations'  && <IntegrationsTab />}
          {!loading && tab === 'notifications' && <NotificationsTab get={get} setField={setField} />}
          {!loading && tab === 'appearance'    && <AppearanceTab get={get} setField={setField} />}
          {!loading && tab === 'localization'  && <LocalizationTab get={get} setField={setField} />}
          {!loading && tab === 'system'        && <SystemTab cfg={cfg} />}
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
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: 16, marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        {icon && (
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: `${color}20`, border: `1px solid ${color}30`, color,
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

function Field({ label, hint, children }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.textDim, marginBottom: 6 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={e => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', padding: '10px 12px',
        background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8,
        color: C.text, fontSize: 13,
      }}
    />
  );
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%', padding: '10px 12px',
        background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8,
        color: C.text, fontSize: 13,
      }}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function Toggle({ label, hint, value, onChange, sensitive }) {
  const on = !!value;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 12px', background: '#0a0a14',
      border: `1px solid ${C.border}`, borderRadius: 8,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          {label}
          {sensitive && (
            <span title="Requires TOTP step-up"
              style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                background: '#f0a50020', color: '#f0a500' }}>TOTP</span>
          )}
        </div>
        {hint && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{hint}</div>}
      </div>
      <button
        type="button"
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

// ───────────────────────────────────────────────────────────
// Sub-tabs
// ───────────────────────────────────────────────────────────

function GeneralTab({ get, setField }) {
  return (
    <>
      <Group title="Application Settings" icon="apps" color="#7c3aed">
        <Field label="App Name"><TextInput value={get('appName', 'VERGR')} onChange={v => setField('appName', v)} /></Field>
        <Field label="App Tagline"><TextInput value={get('appTagline', '')} onChange={v => setField('appTagline', v)} placeholder="The Gaming Social Platform" /></Field>
        <Field label="Support Email"><TextInput value={get('supportEmail', 'support@vergr.app')} onChange={v => setField('supportEmail', v)} /></Field>
        <Field label="Default Timezone">
          <Select value={get('defaultTimezone', 'UTC')} onChange={v => setField('defaultTimezone', v)}
            options={[
              { value: 'UTC', label: 'UTC' },
              { value: 'Europe/London', label: 'Europe/London' },
              { value: 'America/New_York', label: 'America/New_York' },
              { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
            ]} />
        </Field>
        <Field label="Items Per Page">
          <TextInput type="number" value={get('itemsPerPage', 10)} onChange={v => setField('itemsPerPage', v)} />
        </Field>
      </Group>

      <Group title="Platform Settings" icon="settings" color="#3b82f6">
        <Toggle label="Maintenance Mode" hint="Show platform-wide maintenance banner" sensitive
          value={get('maintenanceMode', false)} onChange={v => setField('maintenanceMode', v)} />
        <Toggle label="Allow New Registrations" hint="Permit new signups" sensitive
          value={get('allowNewRegistrations', true)} onChange={v => setField('allowNewRegistrations', v)} />
        <Toggle label="Allow Guest Browsing" hint="Logged-out users may browse public surfaces"
          value={get('allowGuestBrowsing', true)} onChange={v => setField('allowGuestBrowsing', v)} />
        <Toggle label="Require Email Verification"
          value={get('requireEmailVerification', true)} onChange={v => setField('requireEmailVerification', v)} />
        <Toggle label="Enforce Terms Acceptance"
          value={get('enforceTermsAcceptance', true)} onChange={v => setField('enforceTermsAcceptance', v)} />
        <Field label="Session Timeout (minutes)">
          <TextInput type="number" value={get('sessionTimeoutMin', 60)} onChange={v => setField('sessionTimeoutMin', v)} />
        </Field>
      </Group>

      <Group title="Content & Communication" icon="chat" color="#22c55e">
        <Toggle label="Allow Direct Messages" value={get('allowDirectMessages', true)} onChange={v => setField('allowDirectMessages', v)} />
        <Toggle label="Enable User Mentions" value={get('enableUserMentions', true)} onChange={v => setField('enableUserMentions', v)} />
        <Toggle label="Content Auto-Moderation"
          hint="Run Gemini classifier on every post and message before publishing"
          value={get('contentAutoModerate', true)} onChange={v => setField('contentAutoModerate', v)} />
        <Field label="Max Message Length">
          <TextInput type="number" value={get('maxMessageLength', 1000)} onChange={v => setField('maxMessageLength', v)} />
        </Field>
      </Group>

      <Group title="Links & Legal" icon="gavel" color="#f0a500">
        <Field label="Terms of Service URL"><TextInput value={get('tosUrl', '/terms')} onChange={v => setField('tosUrl', v)} /></Field>
        <Field label="Privacy Policy URL"><TextInput value={get('privacyUrl', '/privacy')} onChange={v => setField('privacyUrl', v)} /></Field>
        <Field label="Refund Policy URL"><TextInput value={get('refundUrl', '/refund-policy')} onChange={v => setField('refundUrl', v)} /></Field>
        <Field label="Community Guidelines URL"><TextInput value={get('guidelinesUrl', '/code-of-conduct')} onChange={v => setField('guidelinesUrl', v)} /></Field>
      </Group>

      <Group title="Data & Retention" icon="storage" color="#b44fff">
        <Field label="Data Retention Period">
          <Select value={get('dataRetentionPeriod', '2yr')} onChange={v => setField('dataRetentionPeriod', v)}
            options={[
              { value: '6mo', label: '6 months' },
              { value: '1yr', label: '1 year' },
              { value: '2yr', label: '2 years' },
              { value: 'forever', label: 'Forever' },
            ]} />
        </Field>
        <Field label="Log Retention Period">
          <Select value={get('logRetentionPeriod', '365d')} onChange={v => setField('logRetentionPeriod', v)}
            options={[
              { value: '90d', label: '90 days' },
              { value: '180d', label: '180 days' },
              { value: '365d', label: '365 days' },
            ]} />
        </Field>
        <Toggle label="Allow Data Export by Users"
          value={get('allowUserDataExport', true)} onChange={v => setField('allowUserDataExport', v)} />
        <Toggle label="Anonymize Data After Retention"
          value={get('anonymizeDataAfterRetention', true)} onChange={v => setField('anonymizeDataAfterRetention', v)} />
      </Group>
    </>
  );
}

function FeaturesTab({ get, setField }) {
  const features = [
    { key: 'liveStreamingPaused', label: 'Live Streaming', invert: true, hint: 'Master switch for HLS + browser ingest. ON = streaming allowed.', sensitive: true },
    // 'tournamentsEnabled' removed 2026-08-17: there is nothing left for it to
    // switch, and a toggle that reads ON for a retired feature is worse than no
    // toggle. Ticketed events are separate and have no kill switch of their own.
    { key: 'squadsEnabled', label: 'Squads', defaultOn: true, hint: 'Group / guild surfaces + voice hangouts.' },
    { key: 'newsBotsEnabled', label: 'News Bots', defaultOn: true, hint: 'Auto-syndicated gaming news posts.' },
    { key: 'verificationEnabled', label: 'Account Verification', defaultOn: true, hint: 'KYC + creator verification surfaces.' },
    { key: 'vergrMeEnabled', label: 'Vergr.me Public Profiles', defaultOn: true, hint: 'Pro-only Linktree-style profile page.' },
    { key: 'streamBoostsEnabled', label: 'Stream Boosts', defaultOn: true, hint: 'Pay 50c to amplify discovery.' },
    { key: 'cohostEnabled', label: 'Co-Host Streams', defaultOn: true, hint: 'Two broadcasters in one HLS stream (Pro).' },
    { key: 'streamFollowerGateEnabled', label: 'Min-Follower Requirement (Go Live)', defaultOn: true, hint: 'ON = free users need 100 followers to stream public. OFF = anyone can go live.' },
    { key: 'giftingEnabled', label: 'Live Gifting', defaultOn: false, hint: 'TikTok-style animated gifts (deferred until profit-positive).' },
  ];

  return (
    <Group title="Features & Modules" icon="extension" color="#7c3aed">
      <div style={{ fontSize: 12, color: C.textDim, marginBottom: 8 }}>
        Each toggle controls a single feature surface. Disabling a feature hides
        its UI surfaces and rejects its server callables.
      </div>
      {features.map(f => {
        // For inverted fields (e.g. liveStreamingPaused) the toggle ON state
        // means "feature enabled" i.e. !paused.
        const raw = get(f.key, f.invert ? false : f.defaultOn);
        const on = f.invert ? !raw : !!raw;
        return (
          <Toggle
            key={f.key}
            label={f.label}
            hint={f.hint}
            sensitive={f.sensitive}
            value={on}
            onChange={v => setField(f.key, f.invert ? !v : v)}
          />
        );
      })}
    </Group>
  );
}

function SecurityTab({ get, setField }) {
  return (
    <>
      <Group title="Authentication" icon="lock" color="#7c3aed">
        <Field label="Failed Login Threshold" hint="Number of attempts before lockout">
          <TextInput type="number" value={get('failedLoginThreshold', 5)} onChange={v => setField('failedLoginThreshold', v)} />
        </Field>
        <Field label="Failed Login Lockout (minutes)">
          <TextInput type="number" value={get('failedLoginLockoutMin', 15)} onChange={v => setField('failedLoginLockoutMin', v)} />
        </Field>
        <Field label="Min Password Length">
          <TextInput type="number" value={get('minPasswordLength', 8)} onChange={v => setField('minPasswordLength', v)} />
        </Field>
      </Group>

      <Group title="Access Control" icon="vpn_key" color="#f04060">
        <Field label="Admin Step-Up Window (seconds)" hint="How long a TOTP verification stays fresh">
          <TextInput type="number" value={get('stepUpWindowSec', 300)} onChange={v => setField('stepUpWindowSec', v)} />
        </Field>
        <Toggle label="Auto-Revoke Tokens on Suspicious Activity"
          hint="Force re-auth when an account triggers anomaly detection"
          value={get('suspiciousAutoRevoke', false)} onChange={v => setField('suspiciousAutoRevoke', v)} />
        <Field label="Admin IP Allowlist (CIDR, comma-separated)" hint="Empty = no IP restriction">
          <TextInput value={get('ipAllowlist', '')} onChange={v => setField('ipAllowlist', v)} placeholder="0.0.0.0/0" />
        </Field>
      </Group>
    </>
  );
}

function PaymentsTab({ get, setField }) {
  return (
    <>
      <Group title="Kill Switches" icon="power_settings_new" color="#f04060">
        {/* These two labels described coin→gem conversion and a withdrawal
            queue, neither of which exists any more, and BOTH disagreed with
            what /admin/economy calls the very same flags. An operator reading
            this screen would have thought "Pause Coin → Gem Conversions"
            stopped a dead feature when the flag now gates creator revenue
            accrual. Wording matches AdminEconomyScreen exactly. */}
        <Toggle label="Pause revenue-share accrual" sensitive
          hint="Stops earned coins accruing a creator share. For use during an economy investigation."
          value={get('conversionsPaused', false)} onChange={v => setField('conversionsPaused', v)} />
        <Toggle label="Pause creator payouts" sensitive
          hint="The scheduled payout run skips everyone. Accrual continues, so nothing is lost; creators are paid on the next run after this is resumed."
          value={get('payoutsPaused', false)} onChange={v => setField('payoutsPaused', v)} />
        <Toggle label="Pause Tipping" sensitive
          hint="Disables coin tipping platform-wide"
          value={get('tipsPaused', false)} onChange={v => setField('tipsPaused', v)} />
      </Group>

      <Group title="Settings" icon="payments" color="#f5c542">
        <Field label="Min Payout (Gems)" hint="Floor below which users cannot request a withdrawal">
          <TextInput type="number" value={get('minPayoutGems', 1000)} onChange={v => setField('minPayoutGems', v)} />
        </Field>
        <Field label="Default Payout Currency">
          <Select value={get('defaultPayoutCurrency', 'USDT-TRX')} onChange={v => setField('defaultPayoutCurrency', v)}
            options={[
              { value: 'USDT-TRX', label: 'USDT (TRON)' },
              { value: 'USDT-ETH', label: 'USDT (Ethereum)' },
              { value: 'USDC-POL', label: 'USDC (Polygon)' },
              { value: 'BTC',      label: 'BTC' },
            ]} />
        </Field>
      </Group>

      <Group title="Processor Status (read-only)" icon="vpn_lock" color="#7c3aed">
        <div style={{ fontSize: 12, color: C.textDim }}>
          Cryptomus is the sole inbound + outbound processor. Approval pending —
          when keys flip from placeholder to live, payments activate automatically.
          Rotate via Firebase Secrets ( <code>CRYPTOMUS_*</code> ); do not store
          processor credentials here.
        </div>
      </Group>
    </>
  );
}

function IntegrationsTab() {
  // Read-only display; secret rotation lives in Firebase Secrets, not here.
  const providers = [
    { name: 'Twitch',       status: 'configured', cat: 'OAuth' },
    { name: 'YouTube',      status: 'configured', cat: 'OAuth' },
    { name: 'Discord',      status: 'configured', cat: 'OAuth' },
    { name: 'Battle.net',   status: 'configured', cat: 'OAuth' },
    { name: 'Steam',        status: 'configured', cat: 'OpenID' },
    { name: 'xbl.io (Xbox)',status: 'configured', cat: 'API' },
    { name: 'Apex Legends', status: 'configured', cat: 'API' },
    { name: 'Riot Games',   status: 'pending',    cat: 'OAuth', note: 'Production key in review' },
    { name: 'Epic Games',   status: 'unconfigured', cat: 'OAuth' },
    { name: 'Cryptomus',    status: 'pending',    cat: 'Payments', note: 'Underwriting in progress' },
    { name: 'Gemini AI',    status: 'configured', cat: 'AI' },
  ];
  const color = (s) => s === 'configured' ? '#22c55e' : s === 'pending' ? '#f0a500' : '#f04060';
  return (
    <Group title="External Integrations" icon="hub" color="#7c3aed">
      <div style={{ fontSize: 12, color: C.textDim, marginBottom: 8 }}>
        Read-only view. Rotate credentials via{' '}
        <code style={{ background: '#0a0a14', padding: '1px 6px', borderRadius: 4 }}>
          firebase functions:secrets:set
        </code>{' '}— never store secrets in app_config.
      </div>
      {providers.map(p => (
        <div key={p.name} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 12px', background: '#0a0a14',
          border: `1px solid ${C.border}`, borderRadius: 8,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{p.name}</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{p.cat}{p.note ? ` · ${p.note}` : ''}</div>
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 999,
            background: `${color(p.status)}20`, color: color(p.status),
            border: `1px solid ${color(p.status)}50`, textTransform: 'uppercase',
          }}>{p.status}</span>
        </div>
      ))}
    </Group>
  );
}

function NotificationsTab({ get, setField }) {
  return (
    <>
      <Group title="Delivery Settings" icon="notifications" color="#7c3aed">
        <Field label="Quiet Hours Start (HH:MM, user-local)">
          <TextInput value={get('quietHoursStart', '22:00')} onChange={v => setField('quietHoursStart', v)} />
        </Field>
        <Field label="Quiet Hours End (HH:MM, user-local)">
          <TextInput value={get('quietHoursEnd', '08:00')} onChange={v => setField('quietHoursEnd', v)} />
        </Field>
        <Field label="Max Notifications Per User Per Day">
          <TextInput type="number" value={get('maxNotificationsPerDay', 50)} onChange={v => setField('maxNotificationsPerDay', v)} />
        </Field>
      </Group>

      <Group title="Email" icon="mail" color="#3b82f6">
        <Field label="Email Sender Name">
          <TextInput value={get('emailSenderName', 'VERGR')} onChange={v => setField('emailSenderName', v)} />
        </Field>
        <Field label="Reply-To Address">
          <TextInput value={get('emailReplyTo', 'noreply@vergr.app')} onChange={v => setField('emailReplyTo', v)} />
        </Field>
        <div style={{ fontSize: 11, color: C.textMuted }}>
          Per-template / per-channel toggles (e.g. "send event reminders by email")
          will land in a follow-up pass once an email provider is wired.
        </div>
      </Group>
    </>
  );
}

function AppearanceTab({ get, setField }) {
  return (
    <>
      <Group title="Theme" icon="palette" color="#7c3aed">
        <Field label="Theme" hint="Dark theme only at this time">
          <Select value={get('theme', 'dark')} onChange={() => {}}
            options={[{ value: 'dark', label: 'Dark (locked)' }]} />
        </Field>
        <Field label="Accent Color (hex)">
          <TextInput value={get('accentColor', '#7c3aed')} onChange={v => setField('accentColor', v)} />
        </Field>
      </Group>

      <Group title="Custom CSS" icon="code" color="#f04060">
        <Field label="Custom CSS"
          hint="DANGEROUS. Any string here renders on every page. Test in staging first.">
          <textarea
            value={get('customCss', '') ?? ''}
            onChange={e => setField('customCss', e.target.value)}
            rows={6}
            style={{
              width: '100%', padding: '10px 12px',
              background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8,
              color: C.text, fontSize: 12, fontFamily: 'ui-monospace, monospace',
              resize: 'vertical',
            }}
            placeholder="/* /* CSS overrides */"
          />
        </Field>
      </Group>
    </>
  );
}

function LocalizationTab({ get, setField }) {
  const langs = ['en', 'es', 'fr', 'de', 'pt', 'ja', 'ko', 'zh'];
  const selected = new Set(get('supportedLanguages', ['en']) || ['en']);
  return (
    <Group title="Supported Languages" icon="language" color="#7c3aed">
      <div style={{ fontSize: 12, color: C.textDim, marginBottom: 8 }}>
        Languages that show in the user language picker. English is always
        available regardless of this setting.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {langs.map(code => {
          const on = selected.has(code);
          return (
            <button
              key={code}
              type="button"
              onClick={() => {
                const next = new Set(selected);
                if (on) next.delete(code); else next.add(code);
                if (!next.has('en')) next.add('en');
                setField('supportedLanguages', Array.from(next));
              }}
              style={{
                padding: '6px 14px', borderRadius: 999,
                background: on ? `${C.accent}30` : '#0a0a14',
                border: `1px solid ${on ? C.accent : C.border}`,
                color: on ? '#fff' : C.textDim,
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                textTransform: 'uppercase',
              }}
            >{code}</button>
          );
        })}
      </div>
    </Group>
  );
}

function SystemTab({ cfg }) {
  return (
    <Group title="System Info" icon="info" color="#7c3aed">
      <Row label="Environment" value={cfg?.environment || 'production'} />
      <Row label="Firebase Region" value="europe-west1" />
      <Row label="Last Config Update" value={cfg?._updatedAt ? fmtRelative(cfg._updatedAt) : '—'} />
      <div style={{ fontSize: 12, color: C.textDim, marginTop: 12 }}>
        Cache purge, search reindex, and config import/export will land in a
        follow-up pass once we wire the Cloudflare API.
      </div>
    </Group>
  );
}

function Row({ label, value }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 12px', background: '#0a0a14',
      border: `1px solid ${C.border}`, borderRadius: 8,
    }}>
      <span style={{ fontSize: 12, color: C.textDim }}>{label}</span>
      <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Right rail — summary + system status + quick actions
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
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>Configuration Summary</h3>
        <Row label="Last Updated" value={cfg?._updatedAt ? fmtRelative(cfg._updatedAt) : '—'} />
        <div style={{ height: 8 }} />
        <Row label="Dirty Fields" value={dirty ? 'Yes — save pending' : 'No'} />
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>System Status</h3>
        {!health && <div style={{ fontSize: 12, color: C.textDim }}>Loading…</div>}
        {health?.services?.map(s => (
          <div key={s.name} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 4px', borderBottom: `1px dashed ${C.border}`,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: s.status === 'healthy' ? '#22c55e' : s.status === 'down' ? '#f04060' : '#f0a500',
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 12, color: C.text, flex: 1 }}>{s.name}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999,
              color: s.status === 'healthy' ? '#22c55e' : '#f04060',
              background: s.status === 'healthy' ? '#22c55e20' : '#f0406020',
              textTransform: 'uppercase',
            }}>{s.status}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
