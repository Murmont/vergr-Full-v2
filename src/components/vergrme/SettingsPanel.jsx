import { useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import Icon from '../Icon';
import { vergrMeUrl, VERGRME_DISPLAY_PREFIX } from '../../utils/vergrMeUrl';
import { Card, ToggleRow } from './EditorUI';

export default function SettingsPanel({ form, up, patch, isPro, canHideBranding, onProGate, copyUrl, copied, onOpen, username, uid }) {
  const rows = [
    { key: 'isPublic', label: 'Public page', sub: 'Anyone with the link can view', icon: 'public' },
    { key: 'showFollowers', label: 'Show follower count', sub: 'Display your follower count', icon: 'group' },
    { key: 'showShare', label: 'Share button', sub: 'Let visitors share your page', icon: 'ios_share' },
    { key: 'showSubscribe', label: 'Follow button', sub: 'Let visitors follow you', icon: 'person_add' },
    { key: 'floatingActions', label: 'Floating share/follow', sub: 'Show buttons that stay as visitors scroll', icon: 'touch_app' },
  ];

  const fwd = form.redirect || {};
  const upFwd = (o) => patch({ redirect: { ...fwd, ...o } });
  const pixels = form.pixels || {};
  const upPixel = (k, v) => patch({ pixels: { ...pixels, [k]: v } });
  const utm = form.utm || {};
  const upUtm = (o) => patch({ utm: { ...utm, ...o } });
  const pageUrl = vergrMeUrl(username);

  // Lead export (Pro) — pull vergrMeLeads → CSV download.
  const [exporting, setExporting] = useState(false);
  const exportLeads = async () => {
    if (!isPro) { onProGate('Lead export is a Pro feature.'); return; }
    if (!uid) return;
    setExporting(true);
    try {
      const snap = await getDocs(collection(db, 'users', uid, 'vergrMeLeads'));
      const rows = snap.docs.map((d) => d.data());
      const cols = ['name', 'email', 'phone', 'message'];
      const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
      const head = ['date', ...cols].join(',');
      const body = rows.map((r) => {
        const date = r.ts?.toDate ? r.ts.toDate().toISOString() : '';
        return [date, ...cols.map((c) => esc(r[c]))].join(',');
      }).join('\n');
      const blob = new Blob([`${head}\n${body}`], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `vergr-me-leads-${username || 'page'}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { console.error('lead export failed', e); }
    finally { setExporting(false); }
  };

  // QR customisation
  const [qrFg, setQrFg] = useState('#000000');
  const [qrBg, setQrBg] = useState('#ffffff');
  const qrRef = useRef(null);
  const downloadQr = () => {
    const canvas = qrRef.current?.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `vergr-me-${username}.png`;
    a.click();
  };

  return (
    <div className="flex flex-col gap-4">
      <Card title="Page settings">
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <ToggleRow key={r.key} icon={r.icon} label={r.label} sub={r.sub} on={form[r.key] !== false} onClick={() => up(r.key, !(form[r.key] !== false))} />
          ))}
          <ToggleRow
            icon="visibility_off"
            label="Hide Vergr branding"
            sub="Remove the 'Made with Vergr' footer"
            badge={!canHideBranding ? 'Lite' : null}
            on={!!form.hideBranding}
            onClick={() => { if (!canHideBranding) { onProGate('Hiding branding is available on Lite and Pro.'); return; } up('hideBranding', !form.hideBranding); }}
          />
        </div>
      </Card>

      <Card title="Your link">
        <p className="text-sm text-brand-violet-light font-mono mb-3">{VERGRME_DISPLAY_PREFIX}{username}</p>
        <div className="flex gap-2">
          <button onClick={copyUrl} className="flex-1 py-2 text-xs border border-white/10 rounded-lg text-text-secondary hover:text-text-primary">{copied ? 'Copied!' : 'Copy link'}</button>
          <button onClick={onOpen} className="flex-1 py-2 text-xs border border-white/10 rounded-lg text-text-secondary hover:text-text-primary">Open page</button>
        </div>
      </Card>

      {/* Link forwarding — turn the whole page into a redirect (Cat 5). */}
      <Card title="Link forwarding">
        <ToggleRow icon="open_in_new" label="Forward visitors" sub="Send everyone straight to another URL" on={!!fwd.enabled} onClick={() => upFwd({ enabled: !fwd.enabled })} />
        {fwd.enabled && (
          <div className="flex flex-col gap-2 mt-2">
            <input value={fwd.url || ''} onChange={(e) => upFwd({ url: e.target.value })} className="input-mini" placeholder="https://destination.com" type="url" />
            <label className="text-[11px] text-text-muted">Countdown: {fwd.countdown || 0}s {(!fwd.countdown) && '(instant)'}</label>
            <input type="range" min={0} max={10} step={1} value={fwd.countdown || 0} onChange={(e) => upFwd({ countdown: Number(e.target.value) })} className="w-full" style={{ accentColor: 'var(--brand-violet)' }} />
          </div>
        )}
      </Card>

      {/* SEO — controls the title + description that show on Google and in
          link previews (iMessage / WhatsApp / Slack). */}
      <Card title="SEO & sharing">
        <div className="flex flex-col gap-2">
          <label className="text-[11px] text-text-muted">Meta title</label>
          <input value={form.seoTitle || ''} onChange={(e) => up('seoTitle', e.target.value)} maxLength={70} className="input-mini" placeholder={form.displayName || username} />
          <label className="text-[11px] text-text-muted mt-1">Meta description</label>
          <textarea value={form.seoDescription || ''} onChange={(e) => up('seoDescription', e.target.value)} maxLength={160} rows={2} className="input-mini resize-none" placeholder="What people see when your link is shared" />
        </div>
      </Card>

      {/* Tracking pixels (Pro) — fire on the public page for retargeting. */}
      <Card title="Tracking pixels" badge={!isPro ? 'Pro' : null}>
        <div className="flex flex-col gap-2">
          {[
            ['meta', 'Meta (Facebook) pixel ID'],
            ['tiktok', 'TikTok pixel ID'],
            ['snap', 'Snapchat pixel ID'],
            ['ga', 'Google Analytics ID (G-…)'],
          ].map(([k, ph]) => (
            <input
              key={k}
              value={pixels[k] || ''}
              onChange={(e) => { if (!isPro) { onProGate('Tracking pixels are a Pro feature.'); return; } upPixel(k, e.target.value.trim()); }}
              className="input-mini"
              placeholder={ph}
            />
          ))}
        </div>
      </Card>

      {/* UTM — auto-append campaign tags to every outbound link. */}
      <Card title="UTM parameters">
        <ToggleRow icon="sell" label="Auto-tag outbound links" sub="Append UTM params to track clicks" on={!!utm.enabled} onClick={() => upUtm({ enabled: !utm.enabled })} />
        {utm.enabled && (
          <div className="flex flex-col gap-2 mt-2">
            <input value={utm.source || ''} onChange={(e) => upUtm({ source: e.target.value })} className="input-mini" placeholder="utm_source (e.g. vergrme)" />
            <input value={utm.medium || ''} onChange={(e) => upUtm({ medium: e.target.value })} className="input-mini" placeholder="utm_medium (e.g. bio)" />
            <input value={utm.campaign || ''} onChange={(e) => upUtm({ campaign: e.target.value })} className="input-mini" placeholder="utm_campaign (optional)" />
          </div>
        )}
      </Card>

      {/* Custom QR */}
      <Card title="QR code">
        <div className="flex items-center gap-4">
          <div ref={qrRef} className="p-2 rounded-lg" style={{ background: qrBg }}>
            <QRCodeCanvas value={pageUrl} size={92} fgColor={qrFg} bgColor={qrBg} level="M" includeMargin={false} />
          </div>
          <div className="flex-1 flex flex-col gap-2">
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="color" value={qrFg} onChange={(e) => setQrFg(e.target.value)} className="w-7 h-7 rounded" />
                <span className="text-[11px] text-text-muted">Dots</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="color" value={qrBg} onChange={(e) => setQrBg(e.target.value)} className="w-7 h-7 rounded" />
                <span className="text-[11px] text-text-muted">Background</span>
              </label>
            </div>
            <button onClick={downloadQr} className="py-2 text-xs border border-white/10 rounded-lg text-text-secondary hover:text-text-primary flex items-center justify-center gap-1.5">
              <Icon name="download" size={14} /> Download PNG
            </button>
          </div>
        </div>
      </Card>

      {/* Leads — captured by the Contact form + email pop-up; export to CSV (Pro). */}
      <Card title="Leads" badge={!isPro ? 'Pro' : null}>
        <p className="text-[11px] text-text-muted mb-2 leading-relaxed">Names + emails from your Contact form and email pop-up. Download them to import into your mailing list or CRM.</p>
        <button onClick={exportLeads} disabled={exporting} className="w-full py-2 text-xs border border-white/10 rounded-lg text-text-secondary hover:text-text-primary flex items-center justify-center gap-1.5 disabled:opacity-50">
          <Icon name="download" size={14} /> {exporting ? 'Exporting…' : 'Export leads (CSV)'}
        </button>
      </Card>

      {/* Lead webhook (Pro) — POSTs each new lead to the creator's endpoint. */}
      <Card title="Lead webhook" badge={!isPro ? 'Pro' : null}>
        <p className="text-[11px] text-text-muted mb-2 leading-relaxed">Every new lead is POSTed as JSON to this URL (Zapier, Make, your own server). Requests are signed with the secret via HMAC-SHA256 in the <span className="font-mono">X-Vergr-Signature</span> header.</p>
        <div className="flex flex-col gap-2">
          <input
            value={form.webhookUrl || ''}
            onChange={(e) => { if (!isPro) { onProGate('Lead webhooks are a Pro feature.'); return; } up('webhookUrl', e.target.value.trim()); }}
            onFocus={() => { if (!isPro) onProGate('Lead webhooks are a Pro feature.'); }}
            className="input-mini"
            type="url"
            placeholder="https://hooks.example.com/leads"
          />
          {isPro && (form.webhookUrl || form.webhookSecret) && (
            <div className="flex items-center gap-2">
              <input value={form.webhookSecret || ''} readOnly className="input-mini flex-1 font-mono text-[11px]" placeholder="Signing secret" />
              <button
                onClick={() => up('webhookSecret', Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join(''))}
                className="px-3 py-2 text-xs border border-white/10 rounded-lg text-text-secondary hover:text-text-primary shrink-0">
                {form.webhookSecret ? 'Rotate' : 'Generate'} secret
              </button>
            </div>
          )}
        </div>
      </Card>

      {/* Custom CSS (Pro) — full creative freedom, sandboxed for security:
          CSS only (no JS), scoped to the page, off-domain/script vectors stripped. */}
      <Card title="Custom CSS" badge={!isPro ? 'Pro' : null}>
        <textarea
          value={form.customCss || ''}
          onChange={(e) => { if (!isPro) { onProGate('Custom CSS is a Pro feature.'); return; } up('customCss', e.target.value); }}
          onFocus={() => { if (!isPro) onProGate('Custom CSS is a Pro feature.'); }}
          rows={6}
          spellCheck={false}
          className="input-mini resize-y font-mono text-[11px] leading-relaxed"
          placeholder={'button { border-radius: 0 !important; }\nh1 { letter-spacing: 0.1em !important; }'}
        />
        <p className="text-[11px] text-text-muted mt-2 leading-relaxed">Styles only your page (scoped). Inline styles win, so use <span className="font-mono">!important</span>. CSS only — scripts, <span className="font-mono">@import</span>, and off-site URLs are removed for safety.</p>
      </Card>

      {/* The "Custom domain" card was REMOVED 2026-08-20 (founder decision).
          It had never worked: the entire implementation was a line reading
          "Contact support to point your domain at this page". The self-serve
          build that replaced it needs Cloudflare for SaaS custom hostnames,
          which this account has no quota for (API errors 1456 and 1404), and
          the only route to it is Enterprise. Rather than keep selling it, the
          claim is gone from the plan too. */}
    </div>
  );
}
