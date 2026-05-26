// Go Live setup — redesigned per Claude Design.
// Preview area + device controls + numbered config sections + right side panel.
// Note: actual stream startup is unchanged (toast + navigate). Wire to real backend later.
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import BroadcasterScreen from './BroadcasterScreen';
import ViewerStreamScreen from './ViewerStreamScreen';

const C = {
  bg: '#09090f',
  card: '#12121e',
  cardSoft: '#0f0f1a',
  border: 'rgba(255,255,255,0.09)',
  borderSoft: 'rgba(255,255,255,0.06)',
  text: '#e8e8f0',
  textDim: '#a0a0b8',
  textMuted: '#6b7280',
  purple: '#7B1FFF',
  purpleLight: '#b44fff',
  purpleSoft: 'rgba(123,31,255,0.15)',
  cyan: '#4DFFD4',
  green: '#22c55e',
  red: '#ef4444',
  amber: '#f59e0b',
  divider: 'rgba(255,255,255,0.06)',
};

const GAME_OPTIONS = [
  { name: 'VALORANT', short: 'VAL' },
  { name: 'Apex Legends', short: 'APX' },
  { name: 'Fortnite', short: 'FN' },
  { name: 'CS2', short: 'CS2' },
  { name: 'League of Legends', short: 'LOL' },
  { name: 'Overwatch 2', short: 'OW2' },
  { name: 'Elden Ring', short: 'ELD' },
];

const RESOLUTIONS = ['720p', '1080p', '1440p', '4K'];

export default function GoLiveSetupScreen() {
  const navigate = useNavigate();
  const { profile } = useUser();
  const { showToast } = useUI();
  const { isDesktop, isMobile } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState(['Valorant', 'Ranked']);
  const [tagInput, setTagInput] = useState('');
  const [audience, setAudience] = useState('public'); // public | friends | squad
  const [game, setGame] = useState(GAME_OPTIONS[0]);
  const [autoDetect, setAutoDetect] = useState(true);
  const [resolution, setResolution] = useState('1080p');
  const [bitrate, setBitrate] = useState(6000);
  const [monetize, setMonetize] = useState(true);
  const [entryFee, setEntryFee] = useState(0);
  const [tournamentMode, setTournamentMode] = useState(false);
  const [activeDevice, setActiveDevice] = useState('mic'); // mic | camera | screen | game | audio
  const [showGameMenu, setShowGameMenu] = useState(false);
  const [previewMode, setPreviewMode] = useState(null); // 'broadcaster' | 'viewer' | null

  const goLive = () => {
    if (!title.trim()) {
      showToast('Add a title', 'error');
      return;
    }
    showToast("You're now LIVE! 🔴", 'success');
    navigate('/');
  };

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, '');
    if (!t || tags.includes(t)) return;
    setTags(prev => [...prev, t]);
    setTagInput('');
  };

  // Inline preview overlays
  if (previewMode === 'broadcaster') {
    return (
      <div className="relative">
        <button
          onClick={() => setPreviewMode(null)}
          className="fixed top-4 right-4 z-50 px-3 py-2 rounded-full bg-brand-ember text-white text-xs font-bold flex items-center gap-1.5 shadow-lg"
        >
          <Icon name="close" size={14} /> Exit Preview
        </button>
        <BroadcasterScreen />
      </div>
    );
  }
  if (previewMode === 'viewer') {
    return (
      <div className="relative">
        <button
          onClick={() => setPreviewMode(null)}
          className="fixed top-4 right-4 z-50 px-3 py-2 rounded-full bg-brand-ember text-white text-xs font-bold flex items-center gap-1.5 shadow-lg"
        >
          <Icon name="close" size={14} /> Exit Preview
        </button>
        <ViewerStreamScreen />
      </div>
    );
  }

  return (
    <div style={{
      background: C.bg, minHeight: '100%', color: C.text,
      fontFamily: '"Inter", "DM Sans", system-ui, sans-serif',
    }}>
      {isMobile && <TopBar title="Go Live" showBack />}

      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 24px 16px', flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 22, fontWeight: 800 }}>
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke={C.purpleLight} strokeWidth="1.5"/>
              <circle cx="8" cy="8" r="3" fill={C.purpleLight}/>
              <circle cx="8" cy="8" r="5.5" stroke={C.purpleLight} strokeWidth="1" opacity="0.4"/>
            </svg>
            Go Live
          </div>
          <div style={{ fontSize: 12, color: C.textDim, marginTop: 4 }}>
            Broadcast to the world or your squad. You're live in seconds.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setPreviewMode('broadcaster')}
            style={btnOutline}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="8" cy="8" r="3" fill="currentColor" opacity="0.5"/>
            </svg>
            Test Stream
          </button>
          <button
            type="button"
            onClick={goLive}
            style={btnPrimary}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="white" strokeWidth="1.5"/>
              <circle cx="8" cy="8" r="3" fill="white"/>
            </svg>
            Go Live
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isDesktop ? 'minmax(0,1fr) 320px' : '1fr',
        gap: 16, padding: '0 24px 32px',
      }}>
        {/* MAIN CONTENT */}
        <div>
          {/* Preview */}
          <div style={{
            position: 'relative', aspectRatio: '16/9', width: '100%',
            background: 'radial-gradient(circle at 50% 60%, #2a1850 0%, #0a0a14 70%)',
            borderRadius: 12, overflow: 'hidden', marginBottom: 12,
            border: `1px solid ${C.border}`,
          }}>
            <div style={{
              position: 'absolute', inset: 0,
              backgroundImage: 'linear-gradient(180deg, transparent 60%, rgba(123,31,255,0.15) 100%)',
            }}/>
            <div style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              fontSize: 64, fontWeight: 900, letterSpacing: 2,
              background: 'linear-gradient(135deg, #fff, #b44fff)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              opacity: 0.4,
            }}>VC</div>
            <div style={{
              position: 'absolute', top: 12, left: 12,
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', background: 'rgba(0,0,0,0.5)', borderRadius: 4,
              fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
            }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: C.purpleLight }}/>
              PREVIEW
            </div>
            <div style={{ position: 'absolute', top: 10, right: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)' }}>videocam</span>
              <VolumeBars/>
            </div>
          </div>

          {/* Device controls */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px',
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
            marginBottom: 16, flexWrap: 'wrap',
          }}>
            {[
              { id: 'mic',    label: 'Mic',    icon: 'mic' },
              { id: 'camera', label: 'Camera', icon: 'videocam' },
              { id: 'screen', label: 'Screen', icon: 'cast' },
              { id: 'game',   label: 'Game',   icon: 'sports_esports' },
              { id: 'audio',  label: 'Audio',  icon: 'graphic_eq' },
            ].map(d => (
              <button
                key={d.id}
                type="button"
                onClick={() => setActiveDevice(d.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px',
                  background: activeDevice === d.id ? C.purpleSoft : 'transparent',
                  border: activeDevice === d.id ? `1px solid ${C.purple}` : `1px solid transparent`,
                  borderRadius: 7, color: activeDevice === d.id ? C.purpleLight : C.textDim,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{d.icon}</span>
                {d.label}
              </button>
            ))}
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 8,
              minWidth: 120, marginLeft: 'auto',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)' }}>volume_up</span>
              <VolumeBars/>
            </div>
            <button type="button" style={{
              background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer', display: 'flex', alignItems: 'center',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>settings</span>
            </button>
          </div>

          {/* 1. Basic Info */}
          <SectionHeader n="1" label="Basic Info"/>
          <div style={{ marginBottom: 18 }}>
            <FieldLabel>Title</FieldLabel>
            <input
              value={title}
              onChange={e => setTitle(e.target.value.slice(0, 140))}
              placeholder="Give your stream a title…"
              style={inputField}
            />
            <CharCount value={title.length} max={140}/>

            <FieldLabel>Description</FieldLabel>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value.slice(0, 280))}
              placeholder="What's this stream about?"
              style={{ ...inputField, height: 64, resize: 'vertical', fontFamily: 'inherit' }}
            />
            <CharCount value={description.length} max={280}/>

            <FieldLabel>Tags</FieldLabel>
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 6,
              padding: '9px 12px', background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${C.border}`, borderRadius: 8,
            }}>
              {tags.map(t => (
                <span key={t} style={tagPill}>
                  #{t}
                  <span
                    style={{ cursor: 'pointer', opacity: 0.7 }}
                    onClick={() => setTags(prev => prev.filter(x => x !== t))}
                  >×</span>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                placeholder="+ Add"
                style={{
                  background: 'transparent', border: 'none', color: C.text,
                  fontSize: 12, outline: 'none', minWidth: 80, padding: '3px 6px',
                }}
              />
            </div>
          </div>

          {/* 2. Audience + 3. Game */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 18 }}>
            <div>
              <SectionHeader n="2" label="Audience"/>
              <div style={{ display: 'flex', gap: 6 }}>
                {[
                  { id: 'public',  label: 'Public',     icon: 'public' },
                  { id: 'friends', label: 'Friends',    icon: 'group' },
                  { id: 'squad',   label: 'Squad Only', icon: 'shield' },
                ].map(a => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAudience(a.id)}
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '10px 12px',
                      background: audience === a.id ? C.purpleSoft : 'rgba(255,255,255,0.04)',
                      border: audience === a.id ? `1px solid ${C.purple}` : `1px solid ${C.border}`,
                      borderRadius: 8,
                      color: audience === a.id ? C.purpleLight : C.textDim,
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{a.icon}</span>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <SectionHeader n="3" label="Game Selection"/>
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setShowGameMenu(v => !v)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', background: 'rgba(255,255,255,0.04)',
                    border: `1px solid ${C.border}`, borderRadius: 8,
                    cursor: 'pointer', color: C.text,
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 6,
                    background: 'linear-gradient(135deg,#3d1f7a,#7c3aed)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 800, color: '#fff',
                  }}>{game.short}</div>
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{game.name}</div>
                  </div>
                  <span className="material-symbols-outlined" style={{ fontSize: 14, color: C.textMuted }}>expand_more</span>
                </button>
                {showGameMenu && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                    marginTop: 4, background: C.card, border: `1px solid ${C.border}`,
                    borderRadius: 8, overflow: 'hidden', maxHeight: 240, overflowY: 'auto',
                  }}>
                    {GAME_OPTIONS.map(g => (
                      <button
                        key={g.name}
                        type="button"
                        onClick={() => { setGame(g); setShowGameMenu(false); }}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 12px', background: g.name === game.name ? C.purpleSoft : 'transparent',
                          border: 'none', cursor: 'pointer', color: C.text, fontSize: 13, textAlign: 'left',
                        }}
                      >
                        <div style={{
                          width: 24, height: 24, borderRadius: 4,
                          background: 'linear-gradient(135deg,#3d1f7a,#7c3aed)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 9, fontWeight: 800, color: '#fff',
                        }}>{g.short}</div>
                        {g.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: C.textDim }}>
                <span>Auto-detect game</span>
                <ToggleSm checked={autoDetect} onChange={setAutoDetect} style={{ marginLeft: 'auto' }}/>
              </div>
            </div>
          </div>

          {/* 4. Quality + 5. Monetization */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 18 }}>
            <div>
              <SectionHeader n="4" label="Stream Quality"/>
              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>Resolution</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                {RESOLUTIONS.map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setResolution(r)}
                    style={{
                      padding: '7px 14px',
                      background: resolution === r ? C.purple : 'rgba(255,255,255,0.04)',
                      border: resolution === r ? `1px solid ${C.purpleLight}` : `1px solid ${C.border}`,
                      borderRadius: 7, color: resolution === r ? '#fff' : C.textMuted,
                      fontSize: 12, fontWeight: resolution === r ? 700 : 600, cursor: 'pointer',
                    }}
                  >{r}</button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>
                Bitrate: <span style={{ color: '#fff', fontWeight: 700 }}>{bitrate.toLocaleString()} kbps</span>
              </div>
              <input
                type="range" min={1500} max={10000} step={100}
                value={bitrate} onChange={e => setBitrate(Number(e.target.value))}
                style={{ width: '100%', accentColor: C.purpleLight }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.textDim, marginTop: 2 }}>
                <span>1500</span><span>6000</span><span>10000</span>
              </div>
            </div>

            <div>
              <SectionHeader n="5" label="Monetization"/>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Enable Monetization</span>
                <ToggleSm checked={monetize} onChange={setMonetize}/>
              </div>
              {monetize && (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Entry Fee (Optional)</div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '8px 12px', background: 'rgba(255,255,255,0.04)',
                      border: `1px solid ${C.border}`, borderRadius: 8,
                    }}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill={C.purpleLight}>
                        <polygon points="8,1 10,6 15,6 11,9.5 12.5,15 8,11.5 3.5,15 5,9.5 1,6 6,6"/>
                      </svg>
                      <input
                        type="number"
                        min={0}
                        value={entryFee}
                        onChange={e => setEntryFee(Math.max(0, Number(e.target.value)))}
                        style={{
                          flex: 1, background: 'transparent', border: 'none',
                          color: '#fff', fontSize: 13, fontWeight: 700, outline: 'none',
                        }}
                      />
                      <span style={{ fontSize: 11, color: C.textDim }}>coins</span>
                    </div>
                    <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>
                      Note: a flat 10% platform fee applies to all tips.
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: C.textDim }}>
                    <span>Tournament Mode</span>
                    <ToggleSm checked={tournamentMode} onChange={setTournamentMode}/>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Footer */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 0', borderTop: `1px solid ${C.divider}`,
            fontSize: 12, color: C.textDim, gap: 12, flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14, color: C.purpleLight }}>info</span>
              Make sure to review our{' '}
              <button
                type="button"
                onClick={() => navigate('/settings/help')}
                style={{ background: 'none', border: 'none', color: C.purpleLight, cursor: 'pointer', fontSize: 12, padding: 0 }}
              >Community Guidelines</button>{' '}
              before going live.
            </div>
            <button
              type="button"
              onClick={() => setPreviewMode('viewer')}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', background: 'transparent',
                border: `1px solid ${C.border}`, borderRadius: 7,
                color: C.textMuted, fontSize: 12, cursor: 'pointer',
              }}
            >
              Viewer Preview
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>open_in_new</span>
            </button>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <PanelSection title={
            <>
              Stream Status
              <span style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: C.textMuted,
              }}>
                <div style={{ width: 7, height: 7, background: C.textMuted, borderRadius: '50%' }}/>
                OFFLINE
              </span>
            </>
          }>
            <StatusRow k="Status" v={<span style={{ color: C.green, fontWeight: 600 }}>Ready to Stream</span>}/>
            <StatusRow k="Connection" v={
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.green, fontWeight: 600 }}>
                Excellent <SignalBars/>
              </span>
            }/>
            <StatusRow k="Bitrate" v={<span style={{ color: '#fff', fontWeight: 600 }}>0 kbps</span>}/>
          </PanelSection>

          <PanelSection title={
            <>
              Viewers
              <span style={{ fontSize: 12, color: C.textDim, fontWeight: 400, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>visibility</span> 0
              </span>
            </>
          }>
            <div style={{ textAlign: 'center', padding: '12px 0 4px', color: C.textDim, fontSize: 12 }}>Be the first one!</div>
            <div style={{ textAlign: 'center', color: C.textMuted, fontSize: 11, marginBottom: 10 }}>
              Invite your squad and start streaming.
            </div>
            <div style={{ display: 'flex', gap: 5, justifyContent: 'center' }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }}/>
              ))}
            </div>
          </PanelSection>

          <PanelSection title="Earnings · Today">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <Stat label="Coins" value={(profile?.todayCoinsEarned ?? 0).toLocaleString()} color="#fff" iconColor={C.purpleLight}/>
              <Stat label="VP" value={(profile?.todayVPEarned ?? 0).toLocaleString()} color={C.purpleLight}/>
              <Stat label="Gems" value={(profile?.todayGemsEarned ?? 0).toLocaleString()} color={C.cyan}/>
            </div>
            <div style={{ marginTop: 8, fontSize: 10, color: C.textMuted, lineHeight: 1.4 }}>
              Tips are subject to a flat 10% platform fee. VP→gem conversion uses your tier rate.
            </div>
          </PanelSection>

          <PanelSection title="Quick Actions">
            <QAItem icon="group_add" onClick={() => navigate('/squads')}>Invite Squad</QAItem>
            <QAItem icon="share" onClick={() => {
              navigator.clipboard?.writeText(window.location.href);
              showToast('Stream link copied', 'success');
            }}>Share Stream</QAItem>
            <QAItem icon="emoji_events" onClick={() => navigate('/tournaments')}>Start Tournament Stream</QAItem>
            <QAItem icon="content_cut" shortcut="Ctrl+K">Clip Moment</QAItem>
          </PanelSection>

          <div style={{
            background: 'linear-gradient(135deg, rgba(123,31,255,0.18), rgba(180,79,255,0.06))',
            border: '1px solid rgba(180,79,255,0.3)', borderRadius: 12, padding: 14,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>👑</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Level Up Your Stream</div>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 10 }}>
              Unlock higher quality, custom overlays, and more ways to earn.
            </div>
            <button
              type="button"
              onClick={() => navigate('/settings/subscription')}
              style={{
                width: '100%', padding: '8px 12px',
                background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
                border: 'none', borderRadius: 7, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >View Plans</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────
function SectionHeader({ n, label }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 800, textTransform: 'uppercase',
      letterSpacing: '0.08em', color: C.textDim, marginBottom: 10,
    }}>
      {n}. {label}
    </div>
  );
}

function FieldLabel({ children }) {
  return <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6, marginTop: 12 }}>{children}</div>;
}

function CharCount({ value, max }) {
  return (
    <div style={{
      fontSize: 10, color: value > max * 0.9 ? C.amber : C.textMuted,
      textAlign: 'right', marginTop: 2,
    }}>
      {value} / {max}
    </div>
  );
}

function PanelSection({ title, children }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em',
        color: C.text, marginBottom: 10,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function StatusRow({ k, v }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '6px 0', borderBottom: `1px solid ${C.divider}`,
    }}>
      <span style={{ fontSize: 12, color: C.textDim }}>{k}</span>
      <span style={{ fontSize: 12 }}>{v}</span>
    </div>
  );
}

function Stat({ label, value, color = '#fff' }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color, marginTop: 3 }}>{value}</div>
    </div>
  );
}

function QAItem({ icon, children, shortcut, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px',
        cursor: onClick ? 'pointer' : 'default', fontSize: 13, color: C.text,
        borderBottom: `1px solid ${C.divider}`,
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 16, color: C.textDim }}>{icon}</span>
      <span style={{ flex: 1 }}>{children}</span>
      {shortcut && (
        <span style={{
          fontSize: 10, color: C.textMuted, padding: '2px 6px',
          border: `1px solid ${C.border}`, borderRadius: 4,
        }}>{shortcut}</span>
      )}
    </div>
  );
}

function VolumeBars() {
  const heights = [6, 9, 12, 10, 7, 11, 8, 5, 4];
  const colors = [C.green, C.green, C.green, C.green, C.green, C.amber, C.amber, C.red, C.red];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 14 }}>
      {heights.map((h, i) => (
        <div key={i} style={{
          width: 3, height: h, background: colors[i],
          opacity: i >= 7 ? 0.4 : 1, borderRadius: 1,
        }}/>
      ))}
    </div>
  );
}

function SignalBars() {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 10 }}>
      <div style={{ width: 3, height: 4, background: C.green, borderRadius: 1 }}/>
      <div style={{ width: 3, height: 7, background: C.green, borderRadius: 1 }}/>
      <div style={{ width: 3, height: 10, background: C.green, borderRadius: 1 }}/>
    </div>
  );
}

function ToggleSm({ checked, onChange, style }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        width: 32, height: 18, borderRadius: 9, position: 'relative',
        background: checked ? `linear-gradient(135deg,${C.purple},${C.purpleLight})` : 'rgba(255,255,255,0.1)',
        border: 'none', cursor: 'pointer', flexShrink: 0, ...style,
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: checked ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%', background: '#fff',
        transition: 'left 0.15s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
      }}/>
    </button>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const btnOutline = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', background: 'transparent',
  border: `1px solid ${C.border}`, borderRadius: 8,
  color: C.textDim, fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
const btnPrimary = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 18px',
  background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
  border: 'none', borderRadius: 8,
  color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  boxShadow: '0 0 16px rgba(123,31,255,0.4)',
};
const inputField = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`,
  borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 13, outline: 'none',
};
const tagPill = {
  display: 'flex', alignItems: 'center', gap: 5,
  padding: '3px 9px', background: C.purpleSoft,
  border: '1px solid rgba(180,79,255,0.3)', borderRadius: 20,
  fontSize: 12, color: C.purpleLight,
};
