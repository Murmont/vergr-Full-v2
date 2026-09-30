// Equip the cosmetics your level has unlocked.
//
// Lives on /prestige rather than in Settings on purpose: this is where somebody
// is already thinking about their rank, and a reward you have to go hunting for
// in a settings tree may as well not exist.
//
// ── LAYOUT: THREE TABS, NOT ONE LONG SCROLL ─────────────────────────
// Founder, 2026-08-24: "I don't want a 100 mile long page that users need to
// scroll through just to make a change to something." Correct — every unlock had
// been appended as one more full-width Row, so the page grew every time anything
// shipped, and that scales badly for the ~10 unlocks still to come.
//
// Now: NAME / PROFILE / EFFECTS. Each holds one subject, each fits a screen, and
// a new unlock joins an existing tab instead of lengthening the page. The
// animated-name toggle sits WITH the gradient it switches on, because they are
// one feature and splitting them was the thing that made the page feel endless.
//
// ⚠ NO OUTLINE-ONLY SELECTED STATES ANYWHERE IN HERE. Founder: "I HATE THE
// OUTLINE FAKE GLASS you used for the selected/active typeface, this is bad UI
// and I can't stand how cheap it looks." Selection is shown by a SOLID accent
// fill and a real value step, never a hairline ring on a transparent box. Same
// rule as [[feedback-no-border-soup]].
//
// COST: one Firestore WRITE when you commit a choice, and nothing else. The
// options are computed from `level`, which the page already has. No read, no
// callable, no listener.
//
// SECURITY: the level check here is advisory. firestore.rules re-checks every
// id against `resource.data.vpLevel` (cosmeticMinLevel), so a crafted write
// cannot equip something above your rank.
import { useState } from 'react';
import Icon from '../Icon';
import { useUser } from '../../context/UserContext';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { updateUser } from '../../firebase/firestore';
import {
  PROFILE_ACCENTS, PROFILE_THEMES, isUnlocked,
  nameGradientFor, nameSweepImage, nameColorFor, accentFor,
  NAME_FONTS, ensureNameFont, EFFECTS, isEffectOn,
  TYPING_STYLES, TYPING_STYLE_LEVEL, typingStyleFor, canUseFont,
} from '../../utils/rankUnlocks';
import { ensureContrast } from '../../utils/color';
import { TypingGlyph } from '../effects';
import GradientEditor from './GradientEditor';
import ColorField from './ColorField';
import ColorPopover from './ColorPopover';
import ProfileAudioPicker from './ProfileAudioPicker';
// Swatch and profile read the SAME table, so a preview cannot show something
// the page will not paint.
import { themeStyle } from '../../utils/profileThemes';

const TABS = [
  { id: 'name',    label: 'Name',    icon: 'badge' },
  { id: 'profile', label: 'Profile', icon: 'account_circle' },
  { id: 'effects', label: 'Effects', icon: 'auto_awesome' },
];

function Block({ title, sub, children, locked }) {
  if (locked) return null;
  return (
    <div className="py-4 first:pt-0">
      <h3 className="font-syne font-bold text-sm text-white">{title}</h3>
      {sub && <p className="text-[11px] text-text-secondary mt-0.5 mb-3">{sub}</p>}
      {children}
    </div>
  );
}

/** A locked row states the level plainly instead of showing a dimmed control. */
function LockedNote({ label, level }) {
  return (
    <div className="py-3 flex items-center gap-2 text-text-muted">
      <Icon name="lock" size={14} />
      <span className="text-[12px]">{label} unlocks at level {level}</span>
    </div>
  );
}

function Toggle({ on, onClick, disabled, label }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-2.5 disabled:opacity-45 disabled:cursor-not-allowed"
    >
      <span
        className="w-9 h-5 rounded-full relative transition-colors"
        style={{ background: on ? 'var(--brand-violet,#7B1FFF)' : 'rgba(255,255,255,0.14)' }}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
          style={{ left: on ? 18 : 2 }}
        />
      </span>
      <span className="text-xs font-bold text-white">{label}</span>
    </button>
  );
}

export default function CosmeticEquip({ level = 1 }) {
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const [saving, setSaving] = useState(null);
  const [tab, setTab] = useState('name');
  // Optimistic local copy: the write is one round trip and the profile snapshot
  // catches up on its own, so waiting for it would make every tap feel broken.
  const [local, setLocal] = useState(() => profile?.cosmetics || {});

  const equip = async (patch, label) => {
    if (!currentUser?.uid) return;
    const next = { ...local, ...patch };
    setLocal(next);
    setSaving(Object.keys(patch)[0]);
    try {
      await updateUser(currentUser.uid, { cosmetics: next });
      showToast?.(`${label} saved`, 'success');
    } catch {
      setLocal(local);   // roll back to what was on screen before the tap
      showToast?.('Could not save that yet', 'error');
    }
    setSaving(null);
  };

  // ADMIN OVERRIDE. The founder needs to see every cosmetic to judge it, and
  // levelling an account to 100 to look at a background is absurd. Mirrored in
  // firestore.rules cosmeticsAllowed(), which reads role off the doc being
  // written, so it costs no extra read. Admin-only: not a debug flag, a query
  // param or a localStorage key, any of which a normal account could use.
  const isAdmin = profile?.role === 'admin';
  const effLevel = isAdmin ? 100 : level;

  const theme = local.theme || 'default';
  const nameEffect = local.nameEffect !== false;   // OPT-OUT: undefined means on
  const unlockedAccents = PROFILE_ACCENTS.filter((p) => effLevel >= p.level);

  // ⚠ NOT isUnlocked('typing_style'): no ladder row has that id (the rows are
  // typing_wave, typing_bars, ...), so it was false for every account and the
  // picker never opened. TYPING_STYLE_LEVEL is the first styled unlock; rules check each style at its own level.
  const canTyping = effLevel >= TYPING_STYLE_LEVEL;
  // The resolver, not `local.typingStyle` directly: it is the same function the
  // chat surfaces call, so the tile that looks selected here is the one that
  // will actually draw. A preview and a render disagreeing is what killed the
  // theme system.
  const typingNow = typingStyleFor({ ...profile, vpLevel: effLevel, cosmetics: local });
  const canFont = isUnlocked('name_font', effLevel);
  const canColor = isUnlocked('name_color', effLevel);
  const canSweep = isUnlocked('name_effect', effLevel);

  // Every preview resolves through the SAME functions <UserName> uses, so what
  // is shown here IS what ships. The theme system died of a preview and a
  // profile disagreeing; that must not happen again.
  const draftColor = local.nameColor || '#b44fff';
  const shownColor = nameColorFor({ ...profile, cosmetics: { ...local, nameColor: draftColor } }, effLevel, '#0B0B14');
  const draftStops = nameGradientFor({ ...profile, cosmetics: local }, effLevel) || [];
  const accentHexNow = accentFor({ ...profile, cosmetics: local });
  const myName = profile?.displayName || profile?.username || 'Your name';

  return (
    <div className="rounded-2xl bg-surface-1 p-4">
      {/* Segmented tabs. The active one is a SOLID fill — no outline, no glass. */}
      <div className="flex gap-1 p-1 rounded-xl bg-surface-2 mb-3">
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors"
              style={{
                background: on ? 'var(--brand-violet,#7B1FFF)' : 'transparent',
                color: on ? '#fff' : 'var(--text-secondary,#9CA3AF)',
              }}
            >
              <Icon name={t.icon} size={15} />
              <span className="text-xs font-bold">{t.label}</span>
            </button>
          );
        })}
      </div>

      {tab === 'name' && (
        <div className="divide-y divide-white/[0.06]">
          {canFont ? (
            <Block title="Typeface" sub="Your name, in your face. Tap one to try it.">
              {/* Each tile renders YOUR name in that face, so the tile IS the
                  preview. The face is demand-loaded on hover/render, which is
                  why the grid can offer 18 without any of them costing anything
                  until they are seen. */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {NAME_FONTS.map((f) => {
                  ensureNameFont(f.id);
                  const on = (local.nameFont || 'default') === f.id;
                  // ⚠ PER-FONT NOW. The faces are drip-fed across the ladder
                  // (one row each in rankUnlocks), so a single canFont boolean
                  // would offer all 18 the moment you hit L3. A locked tile is
                  // shown, not hidden: seeing the face you have not earned yet
                  // is the point of a ladder.
                  const locked = !canUseFont(f.id, effLevel);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      disabled={locked || saving === 'nameFont'}
                      onClick={() => !locked && equip({ nameFont: f.id }, f.name)}
                      className="rounded-xl px-3 py-3 text-left transition-colors"
                      style={{
                        background: on ? 'var(--brand-violet,#7B1FFF)' : 'rgba(255,255,255,0.04)',
                        opacity: locked ? 0.4 : 1,
                        cursor: locked ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <div
                        className="truncate"
                        style={{
                          fontFamily: f.stack, fontWeight: f.weight, fontSize: 17,
                          color: '#fff', lineHeight: 1.35,
                        }}
                      >
                        {myName}
                      </div>
                      <div className="text-[10px] mt-1" style={{ color: on ? 'rgba(255,255,255,0.75)' : 'var(--text-muted,#6B7280)' }}>
                        {locked ? f.name + ' · level ' + f.level : f.name}
                      </div>
                    </button>
                  );
                })}
              </div>
            </Block>
          ) : <LockedNote label="Typeface" level={3} />}

          {canColor ? (
            <Block title="Colour" sub="Any colour you like. It replaces the one your rank gives you.">
              <div className="flex items-start gap-3">
                <ColorPopover
                  value={draftColor}
                  presets={unlockedAccents}
                  onChange={(hex) => setLocal((s) => ({ ...s, nameColor: hex }))}
                  onCommit={() => equip({ nameColor: draftColor }, 'Name colour')}
                  title="Pick your name colour"
                />
                <div className="min-w-0">
                  <span className="text-[22px] font-extrabold truncate block" style={{ color: shownColor }}>
                    {myName}
                  </span>
                  {shownColor && shownColor.toLowerCase() !== draftColor.toLowerCase() ? (
                    <p className="text-[11px] text-text-secondary mt-0.5">
                      Lifted from {draftColor} to stay readable on dark.
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => equip({ nameColor: null }, 'Default name colour')}
                      className="text-[11px] text-text-secondary hover:text-white mt-0.5"
                    >
                      Reset to my rank colour
                    </button>
                  )}
                </div>
              </div>
            </Block>
          ) : <LockedNote label="Name colour" level={12} />}

          {canSweep ? (
            <Block title="Animated name" sub="Your name sweeps through your own colours, on a loop.">
              {/* The toggle lives WITH the gradient because it switches exactly
                  this on. They were two separate sections, which is what the
                  founder called out: one feature, one place. */}
              <Toggle
                on={nameEffect}
                disabled={saving === 'nameEffect'}
                label={nameEffect ? 'On' : 'Off'}
                onClick={() => equip({ nameEffect: !nameEffect }, 'Animated name')}
              />
              {nameEffect && (
                <div className="mt-3 space-y-3">
                  <GradientEditor
                    stops={draftStops}
                    onChange={(next) => setLocal((s) => ({ ...s, nameGradient: { stops: next } }))}
                    presets={unlockedAccents}
                  />
                  <span
                    className="vg-name-sweep text-[26px] font-extrabold block truncate"
                    style={{ backgroundImage: nameSweepImage(draftStops) }}
                  >
                    {myName}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={saving === 'nameGradient'}
                      onClick={() => equip({ nameGradient: { stops: draftStops } }, 'Gradient')}
                      className="px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-50"
                      style={{ background: 'var(--brand-violet,#7B1FFF)' }}
                    >
                      {saving === 'nameGradient' ? 'Saving…' : 'Save colours'}
                    </button>
                    <button
                      type="button"
                      onClick={() => equip({ nameGradient: null }, 'Default gradient')}
                      className="px-3 py-2 rounded-xl text-xs font-bold text-text-secondary hover:text-white"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              )}
            </Block>
          ) : <LockedNote label="Animated name" level={63} />}
        </div>
      )}

      {tab === 'profile' && (
        <div className="divide-y divide-white/[0.06]">
          <Block
            title="Accent"
            sub="Colours your profile header, highlights and avatar orbit. Never the avatar ring, which belongs to live and status."
          >
            <div className="flex flex-wrap items-center gap-2.5">
              <ColorPopover
                value={accentHexNow}
                presets={unlockedAccents}
                onChange={(hex) => setLocal((s) => ({ ...s, accentHex: hex }))}
                onCommit={() => equip({ accentHex: local.accentHex || accentHexNow }, 'Accent')}
                title="Pick any accent colour"
              />
              <span className="w-px h-7 bg-white/10" />
              {PROFILE_ACCENTS.map((a) => {
                const have = effLevel >= a.level;
                const on = !local.accentHex && local.accent === a.id;
                return (
                  <button
                    key={a.id}
                    disabled={!have || saving === 'accent'}
                    onClick={() => equip({ accent: a.id, accentHex: null }, a.name)}
                    className="relative w-8 h-8 rounded-full transition-transform disabled:cursor-not-allowed"
                    style={{
                      background: a.color,
                      transform: on ? 'scale(1.15)' : 'scale(1)',
                      boxShadow: on ? '0 0 0 2px #fff' : 'inset 0 0 0 1px rgba(255,255,255,0.18)',
                      opacity: have ? 1 : 0.3,
                    }}
                    title={have ? a.name : `${a.name}, unlocks at level ${a.level}`}
                  >
                    {!have && (
                      <span className="absolute inset-0 grid place-items-center rounded-full bg-black/55">
                        <span className="text-[9px] font-dmmono font-bold text-white/80">{a.level}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </Block>

          {/* ⚠ THIS IS "PROFILE GRADIENT", NOT "PROFILE THEME". The multi-surface
              theme system was deleted on 2026-08-24 (it needed to restyle every
              surface in the app and any surface it missed read as a bug). What
              survives is exactly this: one gradient behind the profile, plus the
              accent above. The heading said "theme" and "surface treatment" long
              after that was true, which is why it looked like dead UI. */}
          <Block title="Profile gradient" sub="One gradient behind your profile page. Your accent does the rest.">
            <div className="grid grid-cols-4 gap-2">
              {PROFILE_THEMES.map((t) => {
                const have = effLevel >= t.level;
                const on = theme === t.id;
                return (
                  <button
                    key={t.id}
                    disabled={!have || saving === 'theme'}
                    onClick={() => equip({ theme: t.id }, t.name)}
                    className="relative rounded-xl overflow-hidden transition-transform disabled:cursor-not-allowed"
                    style={{ transform: on ? 'scale(1.04)' : 'scale(1)', opacity: have ? 1 : 0.4 }}
                  >
                    <div className="h-14 w-full" style={themeStyle(t.id) || undefined} />
                    <div
                      className="px-1 py-1 text-[10px] font-bold truncate"
                      style={{ background: on ? 'var(--brand-violet,#7B1FFF)' : 'rgba(255,255,255,0.04)', color: '#fff' }}
                    >
                      {have ? t.name : t.level}
                    </div>
                  </button>
                );
              })}
            </div>
          </Block>
        </div>
      )}

      {tab === 'effects' && (
        <div className="divide-y divide-white/[0.06]">
          {/* Typing indicator. A PICKER, not a toggle: "Dots" is the off state
              and it is already in the list, so a separate on/off switch would
              be a second control saying the same thing. Every tile animates
              live in the user's own accent, because a still frame of a motion
              cosmetic tells you nothing about it. */}
          {canTyping ? (
            <Block title="Typing indicator" sub="What people watch while you write to them.">
              <div className="grid grid-cols-3 gap-2">
                {TYPING_STYLES.map((s) => {
                  const on = typingNow === s.id;
                  // A style above your level is shown, not hidden, and cannot be
                  // picked: typingStyleFor would only draw it as dots.
                  const locked = effLevel < s.level;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={locked || saving === 'typingStyle'}
                      onClick={() => !locked && equip({ typingStyle: s.id }, s.name)}
                      title={s.desc}
                      className="rounded-xl py-3 flex flex-col items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        background: on ? accentHexNow : 'rgba(255,255,255,0.045)',
                        color: on ? ensureContrast('#ffffff', accentHexNow) : 'var(--text-secondary,#9CA3AF)',
                      }}
                    >
                      <span className="h-4 flex items-center">
                        <TypingGlyph
                          style={s.id}
                          size={6}
                          ink={on ? ensureContrast('#ffffff', accentHexNow) : (s.id === 'dots' ? undefined : accentHexNow)}
                        />
                      </span>
                      <span className="text-[11px] font-bold">{locked ? `${s.name} · ${s.level}` : s.name}</span>
                    </button>
                  );
                })}
              </div>
            </Block>
          ) : (
            <LockedNote label="Custom typing indicator" level={TYPING_STYLE_LEVEL} />
          )}
          {EFFECTS.map((fx) => {
            const have = effLevel >= fx.level;
            if (!have) return <LockedNote key={fx.id} label={fx.name} level={fx.level} />;
            const on = isEffectOn(fx.id, { ...profile, vpLevel: effLevel, cosmetics: local });
            return (
              <Block key={fx.id} title={fx.name} sub={fx.desc}>
                <Toggle
                  on={on}
                  disabled={saving === 'fx'}
                  label={on ? 'On' : 'Off'}
                  onClick={() => equip({ fx: { ...(local.fx || {}), [fx.id]: !on } }, fx.name)}
                />
                {/* ⚠ THE ASSET LIVES WITH ITS OWN TOGGLE. docs/effects/09 §3
                    named EditProfileScreen for the upload, but the Effects tab
                    did not exist in this form when that was written, and an
                    effect whose switch is here and whose file is on another
                    screen is exactly the split that makes a feature feel
                    unfinished. Deviation is deliberate and recorded in doc 09. */}
                {fx.id === 'ambiance' && (
                  <ProfileAudioPicker
                    current={local.profileAudio}
                    saving={saving === 'profileAudio'}
                    onPick={(t) => equip({ profileAudio: t }, 'Profile music')}
                  />
                )}
              </Block>
            );
          })}
        </div>
      )}
    </div>
  );
}
