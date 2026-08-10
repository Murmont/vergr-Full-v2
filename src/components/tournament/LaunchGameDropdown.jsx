// LaunchGameDropdown — primary "Launch" button + dropdown with every
// known launcher for this game + a per-game cached .exe path fallback
// (Tauri only). Lives on TournamentMatchScreen + WarmupLobbyScreen so
// a player goes from match screen to in-game in one click.
//
// Behaviour:
//   - Primary click fires the FIRST option (cached exe if set, else the
//     game's linkedPlatform launcher).
//   - Chevron opens the dropdown with all options.
//   - "Set custom .exe" is a small panel under the menu — paste-in path,
//     persisted to localStorage. Once set, the exe becomes the first
//     option (one-click launch every match thereafter).
//
// On web (non-Tauri) the EXE option is hidden because browsers can't
// spawn local executables. Launcher deep-links still work everywhere.

import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import {
  getLaunchersForGame, getCachedExePath, setCachedExePath,
  exeOptionAvailable, launchExe, openLauncherUrl,
} from '../../utils/gameLaunchers';
import { useUI } from '../../context/UIContext';

export default function LaunchGameDropdown({ game, compact = false }) {
  const { showToast } = useUI();
  const [open, setOpen] = useState(false);
  const [exePath, setExePath] = useState(() => getCachedExePath(game?.id));
  const [editingExe, setEditingExe] = useState(false);
  const [exeDraft, setExeDraft] = useState(exePath);
  const wrapRef = useRef(null);

  useEffect(() => { setExePath(getCachedExePath(game?.id)); }, [game?.id]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!game) return null;
  const launchers = getLaunchersForGame(game);
  // Nothing to launch + no Tauri exe option = render nothing.
  if (launchers.length === 0 && !exeOptionAvailable()) return null;

  // Primary action picks the cached .exe first, else the first launcher.
  const primaryAction = exePath
    ? { kind: 'exe', label: 'Launch installed .exe', path: exePath }
    : launchers[0]
      ? { kind: 'url', label: `Launch in ${launchers[0].label}`, url: launchers[0].url, deep: launchers[0].hasDeepLink }
      : null;

  const fire = async (action) => {
    try {
      if (action.kind === 'exe') {
        await launchExe(action.path);
        showToast('Launching game…', 'success');
      } else if (action.kind === 'url') {
        await openLauncherUrl(action.url);
        showToast(action.deep ? 'Opening game in launcher…' : 'Opening launcher…', 'info');
      }
    } catch (err) {
      showToast(err?.message || 'Launch failed', 'error');
    }
    setOpen(false);
  };

  const saveExe = () => {
    const trimmed = (exeDraft || '').trim();
    setCachedExePath(game.id, trimmed);
    setExePath(trimmed);
    setEditingExe(false);
    if (trimmed) showToast('Saved. Launch will use this .exe next time.', 'success');
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      {/* Split button: primary action on the left, dropdown chevron on the right. */}
      <div style={{ display: 'inline-flex', borderRadius: 10, overflow: 'hidden',
        border: '1px solid rgba(180, 79, 255,0.35)', background: 'rgba(180, 79, 255,0.10)' }}>
        <button
          onClick={() => primaryAction && fire(primaryAction)}
          disabled={!primaryAction}
          style={{
            padding: compact ? '6px 12px' : '10px 16px',
            background: 'transparent', border: 'none',
            color: '#B44FFF', fontSize: compact ? 12 : 13, fontWeight: 800,
            cursor: primaryAction ? 'pointer' : 'not-allowed',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          <Icon name="play_arrow" size={compact ? 14 : 16} />
          {primaryAction?.label || 'Launch'}
        </button>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            padding: compact ? '6px 8px' : '10px 10px',
            background: 'transparent', border: 'none',
            borderLeft: '1px solid rgba(180, 79, 255,0.25)',
            color: '#B44FFF', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center',
          }}
          title="More launch options"
        >
          <Icon name={open ? 'expand_less' : 'expand_more'} size={16} />
        </button>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: '110%', right: 0, zIndex: 50,
          minWidth: 260, padding: 8, borderRadius: 12,
          background: '#14141F', border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)',
            letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 800,
            padding: '4px 10px 6px' }}>
            Open with
          </div>

          {/* Cached .exe option — pinned to top once set. */}
          {exePath && (
            <Row
              icon="folder"
              label="Installed .exe"
              sub={exePath}
              onClick={() => fire({ kind: 'exe', path: exePath })}
            />
          )}

          {/* All launcher options. */}
          {launchers.map((opt) => (
            <Row
              key={opt.key}
              icon={iconForLauncher(opt.key)}
              label={`Open in ${opt.label}`}
              sub={opt.hasDeepLink ? 'Direct launch' : 'Opens launcher home'}
              onClick={() => fire({ kind: 'url', url: opt.url, deep: opt.hasDeepLink })}
            />
          ))}

          {launchers.length === 0 && !exePath && (
            <div style={{ padding: '8px 10px', fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
              No launcher deep-link for this game. Set a direct .exe below.
            </div>
          )}

          {/* EXE editor — Tauri-only; web hides. */}
          {exeOptionAvailable() && (
            <div style={{
              marginTop: 6, padding: 10, borderRadius: 8,
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
            }}>
              {editingExe ? (
                <>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
                    Paste the absolute path to the game executable.
                  </div>
                  <input
                    type="text"
                    placeholder="C:\Games\MyGame\MyGame.exe"
                    value={exeDraft}
                    onChange={(e) => setExeDraft(e.target.value)}
                    style={{
                      width: '100%', padding: '6px 8px', borderRadius: 6,
                      background: '#0B0B14', color: '#fff',
                      border: '1px solid rgba(255,255,255,0.10)',
                      fontSize: 11, fontFamily: 'DM Mono, monospace',
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button onClick={saveExe} style={smallBtn('#B44FFF', true)}>Save</button>
                    {exePath && (
                      <button onClick={() => { setExeDraft(''); setCachedExePath(game.id, ''); setExePath(''); setEditingExe(false); }}
                        style={smallBtn('#F04060')}>Clear</button>
                    )}
                    <button onClick={() => { setExeDraft(exePath); setEditingExe(false); }}
                      style={smallBtn('rgba(255,255,255,0.5)')}>Cancel</button>
                  </div>
                </>
              ) : (
                <button onClick={() => { setExeDraft(exePath); setEditingExe(true); }}
                  style={{
                    width: '100%', padding: '6px 10px', borderRadius: 6,
                    background: 'transparent', color: 'rgba(255,255,255,0.7)',
                    border: '1px dashed rgba(255,255,255,0.18)',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    textAlign: 'left',
                  }}>
                  {exePath ? '✎ Edit .exe path' : '＋ Set a direct .exe path'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ icon, label, sub, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 10px', borderRadius: 8,
      background: 'transparent', border: 'none', color: '#fff',
      cursor: 'pointer', textAlign: 'left',
    }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon name={icon} size={16} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{label}</div>
        {sub && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            fontFamily: 'DM Mono, monospace',
          }}>
            {sub}
          </div>
        )}
      </div>
    </button>
  );
}

function iconForLauncher(key) {
  return ({
    steam:     'sports_esports',
    battlenet: 'shield',
    ea:        'sports_soccer',
    origin:    'sports_soccer',
    epic:      'rocket_launch',
    ubisoft:   'flag',
    xbox:      'videogame_asset',
    gog:       'storefront',
    riot:      'bolt',
    nintendo:  'videogame_asset',
  })[key] || 'play_arrow';
}

const smallBtn = (color, solid = false) => ({
  flex: 1, padding: '5px 8px', borderRadius: 6,
  background: solid ? color : 'transparent',
  color: solid ? '#000' : color,
  border: solid ? 'none' : `1px solid ${color}55`,
  fontSize: 10, fontWeight: 800, cursor: 'pointer',
});
