// Redesigned Notifications settings — push/email matrix grouped by category.
// Persists to profile.settings.notifications via updateUserSettings.
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import { updateUserSettings } from '../../firebase/firestore';
import TopBar from '../../components/TopBar';
import useResponsive from '../../hooks/useResponsive';
import { C, Toggle, PageShell } from './_settingsUI';

const SECTIONS = [
  { title: 'ENGAGEMENT', desc: 'Interactions with your content and followers.', icon: 'favorite', color: '#ec4899', items: [
    { label: 'Likes on my content', key: 'likes' },
    { label: 'Comments on my content', key: 'comments' },
    { label: 'Mentions', key: 'mentions' },
    { label: 'New followers', key: 'followers' },
  ]},
  { title: 'MESSAGES', desc: 'Direct messages and message requests.', icon: 'chat', color: '#3b82f6', items: [
    { label: 'Direct messages', key: 'dm' },
    { label: 'Message requests', key: 'msgreq' },
  ]},
  { title: 'CALLS', desc: 'Incoming voice and video calls.', icon: 'call', color: '#22c55e', items: [
    { label: 'Incoming calls', key: 'calls' },
  ]},
  { title: 'LIVE', desc: 'When streamers you follow go live or schedule a stream.', icon: 'sensors', color: '#f04060', items: [
    { label: 'Live & scheduled streams', key: 'live' },
  ]},
  { title: 'TIPS & REWARDS', desc: 'Tips, payouts, and earnings activity.', icon: 'monetization_on', color: C.purple, items: [
    { label: 'Tips received', key: 'tips' },
    { label: 'Payout status updates', key: 'payout' },
    { label: 'Monthly summary', key: 'summary' },
  ]},
  { title: 'SQUADS', desc: 'Updates and activity from your squads.', icon: 'shield', color: C.purple, items: [
    { label: 'Invites & requests', key: 'squads_inv' },
    { label: 'Squad activity', key: 'squads_act' },
  ]},
  { title: 'LIVE STREAMS', desc: 'Notifications about creators and streams you follow.', icon: 'live_tv', color: C.amber, items: [
    { label: 'Stream starts', key: 'stream_start' },
    { label: 'Co-stream invites', key: 'stream_invite' },
    { label: 'Membership & tips', key: 'stream_support' },
  ]},
  { title: 'SYSTEM', desc: 'Important system updates and account security.', icon: 'settings', color: '#6366f1', items: [
    { label: 'Security alerts', key: 'security' },
    { label: 'Product updates', key: 'updates' },
    { label: 'Surveys & feedback', key: 'surveys' },
  ]},
];

// Push-only. VERGR has no email-sending backend, so an Email column would be
// purely cosmetic — every honored preference is a *_push key (see
// functions/index.js pushCategoryAllowed).
const DEFAULTS = SECTIONS.flatMap(s => s.items).reduce((acc, item) => {
  acc[`${item.key}_push`] = true;
  return acc;
}, {});

export default function NotificationSettingsScreen() {
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const { isMobile } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();
  const [settings, setSettings] = useState(DEFAULTS);
  const saveTimer = useRef(null);

  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  useEffect(() => {
    if (profile?.settings?.notifications) {
      setSettings(prev => ({ ...prev, ...profile.settings.notifications }));
    }
  }, [profile]);

  const toggle = (key) => {
    setSettings(prev => {
      const updated = { ...prev, [key]: !prev[key] };
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          await updateUserSettings(currentUser.uid, { notifications: updated });
        } catch (err) {
          console.error('Failed to save notif settings:', err);
          showToast('Failed to save', 'error');
        }
      }, 800);
      return updated;
    });
  };

  return (
    <div style={{ background: C.bg, minHeight: '100%' }}>
      {isMobile && <TopBar title="Notifications" showBack />}
      <PageShell>
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
          gap: 12, marginBottom: 12,
        }}>
          {SECTIONS.map(section => (
            <div key={section.title} style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: `${section.color}18`, border: `1px solid ${section.color}30`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: section.color }}>{section.icon}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: C.purple, textTransform: 'uppercase' }}>
                    {section.title}
                  </div>
                  <div style={{ fontSize: 11, color: C.textVeryDim, marginTop: 2 }}>{section.desc}</div>
                </div>
                <ColHead label="Push" icon="phone_iphone" />
              </div>
              <div style={{ height: 1, background: C.border, marginBottom: 8 }}/>
              {section.items.map(item => (
                <div key={item.key} style={{ display: 'flex', alignItems: 'center', padding: '6px 0' }}>
                  <span style={{ flex: 1, fontSize: 13, color: C.textSoft }}>{item.label}</span>
                  <div style={{ width: 60, display: 'flex', justifyContent: 'center' }}>
                    <Toggle small checked={!!settings[`${item.key}_push`]} onChange={() => toggle(`${item.key}_push`)} />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
          padding: '10px 16px', fontSize: 12, color: C.textVeryDim,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>info</span>
          Changes are saved automatically.
        </div>
      </PageShell>
    </div>
  );
}

function ColHead({ label, icon }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, width: 60 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 14, color: C.textVeryDim }}>{icon}</span>
      <span style={{ fontSize: 10, color: C.textVeryDim }}>{label}</span>
    </div>
  );
}
