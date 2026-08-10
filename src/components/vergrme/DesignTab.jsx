import { useState, useEffect, useMemo, useRef } from 'react';
import Icon from '../Icon';
import { uploadToR2 } from '../../utils/r2Storage';
import {
  THEMES, FREE_THEMES, THEME_ORDER, MINIMAL_PRESETS, ACCENT_PRESETS, FONT_PRESETS, BLOCK_SHAPES,
  LINK_STYLES, HEADER_LAYOUTS, HEADER_VARIANTS, VERGRME_TIER_GATES,
  GRAD_DIRECTIONS, SHADOW_TYPES, AVATAR_SIZES, AVATAR_SHAPES, loadVergrMeFont,
  applyThemeTemplate,
} from '../../utils/vergrMeThemes';
import VergrMeView from '../VergrMeView';

export default function DesignTab({ form, patch, isPro, onProGate }) {
  const [busy, setBusy] = useState(false);
  // Load every preset's webfont so the picker's "Aa" previews are accurate.
  useEffect(() => { Object.keys(FONT_PRESETS).forEach(loadVergrMeFont); }, []);
  const gate = (feature, msg) => {
    if (VERGRME_TIER_GATES[feature] === 'pro' && !isPro) { onProGate(msg); return false; }
    return true;
  };
  const bg = form.background || { type: 'gradient' };
  const upBg = (o) => patch({ background: { ...bg, ...o } });
  const colors = form.colors || {};
  const upColors = (o) => patch({ colors: { ...colors, ...o } });
  const blockStyle = form.blockStyle || { shape: 'rounded' };
  const upBlock = (o) => patch({ blockStyle: { ...blockStyle, ...o } });
  const header = form.headerStyle || { layout: 'centered', variant: 'banner' };
  const upHeader = (o) => patch({ headerStyle: { ...header, ...o } });

  const uploadBg = async (file, type) => {
    if (!file) return;
    setBusy(true);
    try { const { url } = await uploadToR2(file, 'banner'); upBg({ type, url }); }
    catch (e) { console.error('bg upload failed', e); }
    finally { setBusy(false); }
  };

  const uploadBanner = async (file) => {
    if (!file) return;
    setBusy(true);
    try { const { url } = await uploadToR2(file, 'banner'); upHeader({ bannerUrl: url }); }
    catch (e) { console.error('banner upload failed', e); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Theme — each tile is a LIVE render of that design system, not a swatch. */}
      <Section title="Theme">
        <p className="text-[11px] text-text-muted mb-3 -mt-1">Each theme is a full design system: its own type, cards, spacing and feel. Tap one to apply it, then tweak anything below.</p>
        <div className="grid grid-cols-2 gap-3">
          {THEME_ORDER.map((key) => {
            const th = THEMES[key];
            const isCustom = key === 'custom';
            const locked = (isCustom || !FREE_THEMES.includes(key)) && !isPro;
            const sel = (form.theme || 'dark') === key;
            return (
              <button key={key}
                onClick={() => { if (locked && !gate('customTheme', isCustom ? 'Custom theme is Pro only.' : 'This theme is Pro only.')) return; patch(applyThemeTemplate(key)); }}
                className={`group relative rounded-2xl overflow-hidden border-2 transition-colors ${sel ? 'border-brand-violet' : 'border-white/10 hover:border-white/25'}`}>
                <ThemeTile themeKey={key} isCustom={isCustom} />
                {locked && <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/55 backdrop-blur flex items-center justify-center"><Icon name="lock" size={11} className="text-brand-gold-light" /></div>}
                {sel && <div className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-brand-violet flex items-center justify-center"><Icon name="check" size={13} className="text-bg-dark" /></div>}
                <span className="absolute bottom-0 inset-x-0 text-[10px] font-medium text-white bg-gradient-to-t from-black/75 to-transparent pt-4 pb-1.5 text-center">{th?.label || 'Custom'}</span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Minimal colour presets — where the retired colour themes live on. */}
      {(form.theme === 'dark' || form.theme === 'light') && (
        <Section title="Minimal colour">
          <p className="text-[11px] text-text-muted mb-2.5 -mt-1">One-tap palettes for the Minimal system.</p>
          <div className="flex flex-wrap gap-2">
            {MINIMAL_PRESETS.map((pre) => {
              const on = form.accentColor === pre.accent;
              return (
                <button key={pre.label}
                  onClick={() => patch({ accentColor: pre.accent, background: { ...bg, ...pre.bg, overlayOpacity: 0 } })}
                  className={`flex items-center gap-1.5 pl-1.5 pr-2.5 py-1.5 rounded-full border text-[11px] ${on ? 'border-brand-violet bg-brand-violet/10' : 'border-white/10 bg-surface-1'}`}>
                  <span className="w-4 h-4 rounded-full" style={{ background: pre.accent }} />
                  {pre.label}
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {/* Accent */}
      <Section title="Accent colour">
        <div className="flex gap-2.5 flex-wrap items-center">
          {ACCENT_PRESETS.map((c) => (
            <button key={c} onClick={() => patch({ accentColor: c })} style={{ background: c, transform: form.accentColor === c ? 'scale(1.18)' : 'scale(1)' }} className="w-7 h-7 rounded-full border border-white/20 transition-transform" />
          ))}
          <label className="w-7 h-7 rounded-full border border-dashed border-white/25 flex items-center justify-center cursor-pointer" title="Custom colour">
            <Icon name="colorize" size={13} className="text-text-muted" />
            <input type="color" value={form.accentColor || '#B44FFF'} onChange={(e) => { if (!gate('customColors', 'Custom accent colours are Pro only.')) return; patch({ accentColor: e.target.value }); }} className="sr-only" />
          </label>
        </div>
      </Section>

      {/* Background */}
      <Section title="Background">
        <div className="grid grid-cols-3 gap-2 mb-2">
          {[
            ['solid', 'Solid', 'square'],
            ['gradient', 'Gradient', 'gradient'],
            ['mesh', 'Mesh', 'blur_on'],
            ['aurora', 'Aurora', 'flare'],
            ['blobs', 'Blobs', 'bubble_chart'],
            ['particles', 'Particles', 'grain'],
            ['image', 'Image', 'image'],
            ['gif', 'GIF', 'gif'],
            ['video', 'Video', 'smart_display'],
          ].map(([type, label, icon]) => {
            const locked = (type === 'video' && !isPro) || (type === 'gif' && !isPro) || (type === 'particles' && !isPro);
            return (
              <button key={type}
                onClick={() => {
                  if (type === 'video' && !gate('videoBackground', 'Video backgrounds are Pro only.')) return;
                  if (type === 'gif' && !gate('gifBackground', 'GIF backgrounds are Pro only.')) return;
                  if (type === 'particles' && !gate('premiumBg', 'Particle backgrounds are Pro only.')) return;
                  upBg({ type });
                }}
                className={`relative flex flex-col items-center gap-1 py-2.5 rounded-xl border ${bg.type === type ? 'border-brand-violet bg-brand-violet/10' : 'border-white/10 bg-surface-1'}`}>
                <Icon name={icon} size={16} className={bg.type === type ? 'text-brand-violet-light' : 'text-text-muted'} />
                <span className="text-[10px]">{label}</span>
                {locked && <Icon name="lock" size={10} className="absolute top-1 right-1 text-brand-gold-light" />}
              </button>
            );
          })}
        </div>
        {bg.type === 'solid' && (
          <label className="flex items-center gap-2 input-mini cursor-pointer">
            <input type="color" value={bg.value || '#0b0b0d'} onChange={(e) => upBg({ value: e.target.value })} className="w-8 h-8 rounded" />
            <span className="text-xs text-text-muted">{bg.value || '#0b0b0d'}</span>
          </label>
        )}
        {bg.type === 'gradient' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="color" value={bg.color1 || form.accentColor || '#7B1FFF'} onChange={(e) => upBg({ color1: e.target.value })} className="w-8 h-8 rounded" />
                <span className="text-[11px] text-text-muted">Colour 1</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="color" value={bg.color2 || '#0b0b0d'} onChange={(e) => upBg({ color2: e.target.value })} className="w-8 h-8 rounded" />
                <span className="text-[11px] text-text-muted">Colour 2</span>
              </label>
            </div>
            <div>
              <p className="text-[11px] text-text-muted mb-1">Direction</p>
              <div className="grid grid-cols-3 gap-1.5">
                {Object.entries(GRAD_DIRECTIONS).map(([k, d]) => (
                  <button key={k} onClick={() => upBg({ direction: k })} className={`py-1.5 text-[10px] rounded-md border ${(bg.direction || 'diagonal') === k ? 'border-brand-violet bg-brand-violet/10 text-brand-violet-light' : 'border-white/10 bg-surface-1 text-text-muted'}`}>{d.label}</button>
                ))}
              </div>
            </div>
            <MiniToggle label="Animate gradient" on={!!bg.animated} onClick={() => upBg({ animated: !bg.animated })} />
          </div>
        )}
        {bg.type === 'mesh' && (
          <MiniToggle label="Animate mesh" on={!!bg.animated} onClick={() => upBg({ animated: !bg.animated })} />
        )}
        {(bg.type === 'aurora' || bg.type === 'blobs' || bg.type === 'particles') && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="color" value={bg.color1 || form.accentColor || '#7B1FFF'} onChange={(e) => upBg({ color1: e.target.value })} className="w-8 h-8 rounded" />
              <span className="text-[11px] text-text-muted">{bg.type === 'particles' ? 'Particle colour' : 'Glow colour'}</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="color" value={bg.color2 || '#0b0b0d'} onChange={(e) => upBg({ color2: e.target.value })} className="w-8 h-8 rounded" />
              <span className="text-[11px] text-text-muted">Base</span>
            </label>
          </div>
        )}
        {(bg.type === 'image' || bg.type === 'gif' || bg.type === 'video') && (
          <div className="flex flex-col gap-3">
            <label className="flex items-center justify-center gap-2 py-2.5 border border-dashed border-white/10 rounded-lg text-xs text-text-muted cursor-pointer hover:text-text-secondary">
              <Icon name={busy ? 'hourglass_empty' : 'upload'} size={14} />
              {busy ? 'Uploading…' : bg.url ? 'Replace media' : `Upload ${bg.type}`}
              <input type="file" accept={bg.type === 'video' ? 'video/*' : 'image/*'} className="hidden" disabled={busy} onChange={(e) => e.target.files[0] && uploadBg(e.target.files[0], bg.type)} />
            </label>
            {bg.url && (
              <>
                <div>
                  <label className="text-[11px] text-text-muted">Tint</label>
                  <SegRow value={bg.tint || 'dark'} onChange={(v) => upBg({ tint: v })} options={[['dark', 'Darken'], ['light', 'Lighten']]} />
                </div>
                <div>
                  <label className="text-[11px] text-text-muted">Tint strength: {Math.round((bg.overlayOpacity ?? 0.35) * 100)}%</label>
                  <input type="range" min={0} max={0.85} step={0.05} value={bg.overlayOpacity ?? 0.35} onChange={(e) => upBg({ overlayOpacity: Number(e.target.value) })} className="w-full" style={{ accentColor: 'var(--brand-violet)' }} />
                </div>
                <div>
                  <label className="text-[11px] text-text-muted">Blur: {bg.blur || 0}px</label>
                  <input type="range" min={0} max={24} step={1} value={bg.blur || 0} onChange={(e) => upBg({ blur: Number(e.target.value) })} className="w-full" style={{ accentColor: 'var(--brand-violet)' }} />
                </div>
                {bg.type === 'video' && (
                  <MiniToggle label="Play video audio" on={!!bg.audio} onClick={() => upBg({ audio: !bg.audio })} />
                )}
              </>
            )}
          </div>
        )}
      </Section>

      {/* Custom colours (Pro) */}
      <Section title="Custom colours" badge={!isPro ? 'Pro' : null}>
        <div className="grid grid-cols-2 gap-2">
          {[
            ['pageBg', 'Page bg'],
            ['text', 'Text'],
            ['title', 'Title'],
            ['bio', 'Bio'],
            ['blockBg', 'Block bg'],
            ['blockText', 'Block text'],
            ['buttonBg', 'Button'],
            ['buttonText', 'Button text'],
          ].map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 p-2 bg-surface-1 rounded-lg border border-white/5 cursor-pointer">
              <input type="color" value={colors[k] || '#000000'} onChange={(e) => { if (!gate('customColors', 'Custom colours are Pro only.')) return; upColors({ [k]: e.target.value }); }} className="w-7 h-7 rounded" />
              <span className="text-xs">{label}</span>
            </label>
          ))}
        </div>
        {Object.keys(colors).length > 0 && (
          <button onClick={() => patch({ colors: {} })} className="text-[11px] text-text-muted mt-2">Reset custom colours</button>
        )}
      </Section>

      {/* Font */}
      <Section title="Font">
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(FONT_PRESETS).map(([key, f]) => (
            <button key={key} onClick={() => patch({ font: key })} className={`py-3 rounded-xl border ${(form.font || 'vergr') === key ? 'border-brand-violet bg-brand-violet/10' : 'border-white/10 bg-surface-1'}`}>
              <div className="text-xl" style={{ fontFamily: f.heading }}>Aa</div>
              <div className="text-[10px] text-text-muted mt-0.5">{f.label}</div>
            </button>
          ))}
        </div>
      </Section>

      {/* Block shape */}
      <Section title="Block style">
        <p className="text-[11px] text-text-muted mb-1">Shape</p>
        <SegRow value={blockStyle.shape || 'rounded'} onChange={(v) => upBlock({ shape: v })} options={Object.entries(BLOCK_SHAPES).map(([k, s]) => [k, s.label])} />
        <p className="text-[11px] text-text-muted mb-1 mt-3">Shadow</p>
        <SegRow
          value={blockStyle.shadowType || (blockStyle.shadow ? 'soft' : 'none')}
          onChange={(v) => upBlock({ shadowType: v, shadow: v === 'soft' })}
          options={Object.entries(SHADOW_TYPES)}
        />
        {(blockStyle.shadowType === 'hard' || blockStyle.shadowType === 'soft') && (
          <label className="flex items-center gap-2 mt-2 cursor-pointer">
            <input type="color" value={blockStyle.shadowColor || '#000000'} onChange={(e) => upBlock({ shadowColor: e.target.value })} className="w-7 h-7 rounded" />
            <span className="text-[11px] text-text-muted">Shadow colour</span>
          </label>
        )}
        <div className="flex gap-2 mt-3">
          <MiniToggle label="Outline" on={!!blockStyle.outline} onClick={() => upBlock({ outline: !blockStyle.outline })} />
        </div>
        {blockStyle.outline && (
          <label className="flex items-center gap-2 mt-2 cursor-pointer">
            <input type="color" value={blockStyle.outlineColor || form.accentColor || '#B44FFF'} onChange={(e) => upBlock({ outlineColor: e.target.value })} className="w-7 h-7 rounded" />
            <span className="text-[11px] text-text-muted">Outline colour</span>
          </label>
        )}
      </Section>

      {/* Link style */}
      <Section title="Link style">
        <div className="grid grid-cols-4 gap-2">
          {Object.keys(LINK_STYLES).map((key) => (
            <button key={key} onClick={() => patch({ linkStyle: key })} className={`py-2.5 rounded-xl border text-xs capitalize ${(form.linkStyle || 'classic') === key ? 'border-brand-violet bg-brand-violet/10 text-brand-violet-light' : 'border-white/10 bg-surface-1 text-text-muted'}`}>{key}</button>
          ))}
        </div>
      </Section>

      {/* Header */}
      <Section title="Header style">
        <p className="text-[11px] text-text-muted mb-1.5">Alignment</p>
        <SegRow value={header.layout || 'centered'} onChange={(v) => upHeader({ layout: v })} options={Object.entries(HEADER_LAYOUTS)} />
        <p className="text-[11px] text-text-muted mb-1.5 mt-3">Avatar size</p>
        <SegRow value={header.avatarSize || 'standard'} onChange={(v) => { if (v === 'hero' && !gate('animatedHeader', 'The hero avatar is Pro only.')) return; upHeader({ avatarSize: v }); }} options={Object.entries(AVATAR_SIZES)} />
        <p className="text-[11px] text-text-muted mb-1.5 mt-3">Avatar shape</p>
        <SegRow value={header.avatarShape || 'circle'} onChange={(v) => upHeader({ avatarShape: v })} options={Object.entries(AVATAR_SHAPES)} />
        <p className="text-[11px] text-text-muted mb-1.5 mt-3">Style</p>
        <div className="grid grid-cols-4 gap-2">
          {Object.entries(HEADER_VARIANTS).map(([key, label]) => {
            const locked = key === 'animated' && !isPro;
            return (
              <button key={key} onClick={() => { if (locked && !gate('animatedHeader', 'Animated headers are Pro only.')) return; upHeader({ variant: key }); }}
                className={`relative py-2.5 rounded-xl border text-[11px] ${(header.variant || 'banner') === key ? 'border-brand-violet bg-brand-violet/10 text-brand-violet-light' : 'border-white/10 bg-surface-1 text-text-muted'}`}>
                {label}
                {locked && <Icon name="lock" size={9} className="absolute top-1 right-1 text-brand-gold-light" />}
              </button>
            );
          })}
        </div>

        {/* Banner image — only the banner header shows a top strip, so the upload
            lives here (not under Background, which is the whole-page backdrop). */}
        {(header.variant || 'banner') === 'banner' && (
          <div className="mt-3">
            <p className="text-[11px] text-text-muted mb-1.5">Banner image</p>
            {header.bannerUrl ? (
              <div className="relative rounded-xl overflow-hidden border border-white/10">
                <img src={header.bannerUrl} alt="" className="w-full h-20 object-cover" />
                <button onClick={() => upHeader({ bannerUrl: null })}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 backdrop-blur flex items-center justify-center text-white hover:bg-black/80">
                  <Icon name="close" size={13} />
                </button>
              </div>
            ) : (
              <label className={`flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-white/15 bg-surface-1 text-text-muted text-xs ${busy ? 'opacity-60 pointer-events-none' : 'cursor-pointer hover:border-white/30'}`}>
                <Icon name={busy ? 'hourglass_empty' : 'add_photo_alternate'} size={15} />
                {busy ? 'Uploading…' : 'Upload banner image'}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadBanner(e.target.files?.[0])} />
              </label>
            )}
            <p className="text-[10px] text-text-muted mt-1.5">Wide image works best (a soft fade keeps your avatar readable). No image = the theme's accent banner.</p>
          </div>
        )}
      </Section>
    </div>
  );
}

// Live theme preview — renders the REAL shared renderer (VergrMeView) at the
// theme's applied design system, scaled to the tile width. This is the single
// source of truth, so a preview can never drift from the actual page.
const PREVIEW_W = 300;
const PREVIEW_H = 360;
function previewData(key) {
  return {
    theme: key,
    ...applyThemeTemplate(key),
    displayName: 'Alex Rivera',
    username: 'alexr',
    bio: 'Creator · streamer · coffee addict',
    verified: true,
    showShare: false, showSubscribe: false, floatingActions: false, hideBranding: true,
    blocks: [
      { id: 'h', type: 'header', text: 'My links' },
      { id: 'a', type: 'link', title: 'Latest video', subtitle: 'youtube.com/@alexr', icon: '▶' },
      { id: 'b', type: 'link', title: 'Join my Discord', icon: '💬' },
      { id: 's', type: 'socials', socials: { instagram: 'a', x: 'a', youtube: 'a', twitch: 'a' } },
    ],
  };
}

function ThemeTile({ themeKey, isCustom }) {
  const ref = useRef(null);
  const [w, setW] = useState(150);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => { for (const e of entries) setW(e.contentRect.width); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const scale = w / PREVIEW_W;
  const data = useMemo(() => previewData(themeKey), [themeKey]);

  if (isCustom) {
    return (
      <div ref={ref} style={{ width: '100%', height: PREVIEW_H * scale, position: 'relative', background: 'linear-gradient(150deg,#1a1a2a,#0b0b14)' }} className="flex flex-col items-center justify-center gap-1.5">
        <Icon name="palette" size={26} className="text-brand-violet-light" />
        <span className="text-[11px] text-text-secondary">Build your own</span>
      </div>
    );
  }
  return (
    <div ref={ref} style={{ width: '100%', height: PREVIEW_H * scale, overflow: 'hidden', position: 'relative' }}>
      <div style={{ width: PREVIEW_W, height: PREVIEW_H, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }}>
        <VergrMeView data={data} interactive={false} />
      </div>
    </div>
  );
}

function Section({ title, badge, children }) {
  return (
    <div className="flex flex-col gap-3 bg-surface-1/70 backdrop-blur-xl rounded-2xl p-5 border border-white/10 shadow-lg">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        {badge && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-brand-gold-light/15 text-brand-gold-light font-semibold">{badge}</span>}
      </div>
      {children}
    </div>
  );
}

function SegRow({ value, onChange, options }) {
  return (
    <div className="flex gap-1 p-1 bg-surface-2 rounded-lg">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className={`flex-1 py-1.5 text-[11px] rounded-md font-medium capitalize ${value === v ? 'bg-brand-violet text-white' : 'text-text-muted'}`}>{label}</button>
      ))}
    </div>
  );
}

function MiniToggle({ label, on, onClick }) {
  return (
    <button onClick={onClick} className={`flex-1 flex items-center justify-between px-3 py-2 rounded-lg border ${on ? 'border-brand-violet/40 bg-brand-violet/10' : 'border-white/10 bg-surface-1'}`}>
      <span className="text-xs">{label}</span>
      <span className={`relative w-10 h-[22px] rounded-full transition-colors duration-200 shrink-0 ${on ? 'bg-brand-violet' : 'bg-white/15'}`}>
        <span className={`absolute top-1/2 -translate-y-1/2 w-[18px] h-[18px] bg-white rounded-full shadow transition-[left] duration-200 ${on ? 'left-[20px]' : 'left-[2px]'}`} />
      </span>
    </button>
  );
}
