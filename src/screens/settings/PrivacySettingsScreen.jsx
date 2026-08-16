// Redesigned Privacy settings — visibility, communication, content perms, discoverability.
// Persists to profile.settings via updateUserSettings.
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import { updateUserSettings, getBlockedUsers, saveFeedPrefs, getFeedPrefs } from '../../firebase/firestore';
import TopBar from '../../components/TopBar';
import useResponsive from '../../hooks/useResponsive';
import { C, Toggle, SelectDropdown, SectionLabel, PageShell } from './_settingsUI';
import { PRIVACY_DEFAULTS } from '../../utils/privacy';
import { getLocalNsfwPref, setLocalNsfwPref, isAgeVerified, platformAllowsNsfw } from '../../utils/nsfw';
import useNsfwPlatformFlag, { nsfwCfgFrom } from '../../hooks/useNsfwPlatformFlag';

const VIS_OPTIONS = ['Everyone', 'Friends & Followers', 'Only me'];

// Single source of truth lives in utils/privacy.js so the screen and the
// enforcement code can never drift apart.
const DEFAULTS = PRIVACY_DEFAULTS;

export default function PrivacySettingsScreen() {
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const { isMobile } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();
  const navigate = useNavigate();
  const [vals, setVals] = useState(DEFAULTS);
  const [blockedCount, setBlockedCount] = useState(0);
  // Adult content preference. Deliberately NOT part of `vals`: it does not live
  // in profile.settings.privacy, it needs a device-local mirror so the very
  // first feed frame can filter before any Firestore read lands, and turning it
  // ON has a precondition the other rows do not have.
  const [showNsfw, setShowNsfw] = useState(() => getLocalNsfwPref());
  const nsfwPlatformOk = useNsfwPlatformFlag();
  // Whether this build may show adult content at all. Hides the row entirely
  // rather than showing a switch that silently does nothing.
  const nsfwAvailable = platformAllowsNsfw(nsfwCfgFrom(nsfwPlatformOk));
  const saveTimer = useRef(null);

  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  useEffect(() => {
    if (profile?.settings?.privacy) setVals(prev => ({ ...prev, ...profile.settings.privacy }));
  }, [profile]);

  // The account is the source of truth; localStorage is only a fast mirror.
  // A device that has never seen this account starts OFF and is corrected here.
  useEffect(() => {
    if (!currentUser) return;
    getFeedPrefs(currentUser.uid).then((p) => {
      if (!p || typeof p.showNsfw !== 'boolean') return;
      setShowNsfw(p.showNsfw);
      setLocalNsfwPref(p.showNsfw);
    }).catch(() => {});
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    getBlockedUsers(currentUser.uid).then(list => setBlockedCount(list?.length || 0)).catch(() => {});
  }, [currentUser]);

  const set = (k, v) => {
    setVals(prev => {
      const updated = { ...prev, [k]: v };
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          await updateUserSettings(currentUser.uid, { privacy: updated });
        } catch (err) {
          console.error('Failed to save privacy:', err);
          showToast('Failed to save', 'error');
        }
      }, 800);
      return updated;
    });
  };

  /**
   * Turning adult content ON has a precondition the other rows do not: the
   * viewer must be age-verified. Self-declaring 18 at signup is not age
   * assurance, and the server refuses to serve the media either way
   * (functions/entitlements.js), so letting the switch flip without
   * verification would just produce a feed of items that fail to open.
   *
   * Turning it OFF is unconditional and instant. A safety control must never
   * be harder to engage than to disengage.
   */
  const toggleNsfw = async (next) => {
    if (!next) {
      setShowNsfw(false);
      setLocalNsfwPref(false);
      if (currentUser) saveFeedPrefs(currentUser.uid, { showNsfw: false });
      return;
    }
    if (!nsfwAvailable) {
      showToast('Adult content is not available in this version of the app.', 'info');
      return;
    }
    if (!isAgeVerified(profile)) {
      showToast('Verify your age first to turn this on.', 'info');
      navigate('/creator/verify');
      return;
    }
    setShowNsfw(true);
    setLocalNsfwPref(true);
    if (currentUser) saveFeedPrefs(currentUser.uid, { showNsfw: true });
  };

  const RowSelect = ({ label, desc, k }) => (
    <div style={rowStyle}>
      <div style={{ flex: 1 }}>
        <div style={lblStyle}>{label}</div>
        <div style={descStyle}>{desc}</div>
      </div>
      <SelectDropdown value={vals[k]} options={VIS_OPTIONS} onChange={v => set(k, v)} />
    </div>
  );

  const RowToggle = ({ label, desc, k, icon }) => (
    <div style={rowStyle}>
      {icon && <IconWrap icon={icon}/>}
      <div style={{ flex: 1 }}>
        <div style={lblStyle}>{label}</div>
        <div style={descStyle}>{desc}</div>
      </div>
      <Toggle checked={!!vals[k]} onChange={v => set(k, v)} />
    </div>
  );

  return (
    <div style={{ background: C.bg, minHeight: '100%' }}>
      {isMobile && <TopBar title="Privacy" showBack />}
      <PageShell>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
          {/* Left col */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Section>
              <SectionLabel>Profile Visibility</SectionLabel>
              <RowSelect label="Profile visibility" desc="Choose who can see your profile and activity." k="profileVis"/>
              <RowSelect label="Search visibility" desc="Choose whether you appear in search results." k="searchVis"/>
            </Section>

            <Section>
              <SectionLabel>Communication</SectionLabel>
              <RowSelect label="Receive messages" desc="Allow others to send you direct messages." k="receiveMsg"/>
              <RowToggle label="Message requests" desc="Allow messages from people you don't follow." k="msgReq" icon="person"/>
              <RowSelect label="Who can tag me" desc="Choose who can tag you in content." k="tagMe"/>
              <RowToggle label="Read receipts" desc="Show others when you've read their messages." k="readReceipts" icon="done_all"/>
            </Section>

            <Section>
              <SectionLabel>Content & Activity</SectionLabel>
              <RowToggle label="Show online status" desc="Let others see when you're online." k="onlineStatus" icon="circle"/>
              <RowToggle label="Show activity feed" desc="Allow others to see your recent activity in the feed." k="activityFeed" icon="bar_chart"/>
              <RowToggle label="Allow friend requests" desc="Let others send you friend requests." k="friendReq" icon="group_add"/>
              {/* Not a RowToggle: this one is gated on age verification and is
                  mirrored to localStorage, so it cannot be bound to `vals`. */}
              {nsfwAvailable && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: C.text }}>Show adult content</div>
                    <div style={{ fontSize: 13, color: C.textDim, marginTop: 2 }}>
                      {isAgeVerified(profile)
                        ? 'Include content marked NSFW in your feed. Off by default.'
                        : 'Requires age verification. Off by default.'}
                    </div>
                  </div>
                  <Toggle checked={showNsfw} onChange={toggleNsfw} />
                </div>
              )}
              <div
                style={{ ...rowStyle, cursor: 'pointer' }}
                onClick={() => navigate('/settings/export-data')}
              >
                <IconWrap icon="shield"/>
                <div style={{ flex: 1 }}>
                  <div style={lblStyle}>Data & personalization</div>
                  <div style={descStyle}>Manage how your data is used to personalize your experience.</div>
                </div>
                <Chev/>
              </div>
            </Section>
          </div>

          {/* Right col */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Section>
              <SectionLabel>Content Permissions</SectionLabel>
              <RowSelect label="Who can comment on my content" desc="Choose who can comment on your posts and clips." k="commentContent"/>
              <RowToggle label="Allow downloads" desc="Allow others to download your content." k="allowDownloads" icon="download"/>
            </Section>

            <Section>
              <SectionLabel>Discoverability</SectionLabel>
              <RowToggle label="Appear in suggested users" desc="Allow your profile to be recommended to others." k="suggestedUsers" icon="group"/>
              <RowToggle label="Show in hashtag searches" desc="Allow your content to appear in hashtag searches." k="hashtagSearch" icon="tag"/>
              <RowToggle label="Show in trending" desc="Allow your content to be considered for trending." k="showTrending" icon="trending_up"/>
            </Section>

            <Section>
              <SectionLabel>Blocked Users</SectionLabel>
              <div
                style={{ ...rowStyle, cursor: 'pointer' }}
                onClick={() => navigate('/settings/blocked-users')}
              >
                <IconWrap icon="block"/>
                <div style={{ flex: 1 }}>
                  <div style={lblStyle}>Blocked users</div>
                  <div style={descStyle}>Manage users you've blocked.</div>
                </div>
                <span style={{ color: C.purple, fontSize: 13, fontWeight: 600, marginRight: 8 }}>
                  {blockedCount} blocked
                </span>
                <Chev/>
              </div>
            </Section>

            <div style={{
              background: 'linear-gradient(135deg,rgba(124,58,237,0.08),rgba(109,40,217,0.04))',
              border: '1px solid rgba(124,58,237,0.2)', borderRadius: 12, padding: 16,
              display: 'flex', alignItems: 'center', gap: 14,
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: C.purpleSoft, border: '1px solid rgba(124,58,237,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: C.purple }}>shield</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Your privacy matters</div>
                <div style={{ fontSize: 12, color: C.textVeryDim, marginTop: 2 }}>
                  We'll never share your personal data without your consent.
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate('/settings/privacy-policy')}
                style={{
                  background: C.card, border: `1px solid ${C.borderHard}`, borderRadius: 8,
                  color: C.text, fontSize: 12, padding: '7px 14px', cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >Learn more</button>
            </div>
          </div>
        </div>
      </PageShell>
    </div>
  );
}

const rowStyle = { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: `1px solid ${C.borderSoft}` };
const lblStyle = { fontSize: 13, color: '#d0d0e8', fontWeight: 500 };
const descStyle = { fontSize: 11, color: C.textVeryDim, marginTop: 2 };

function Section({ children }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      {children}
    </div>
  );
}

function IconWrap({ icon }) {
  return (
    <div style={{
      width: 30, height: 30, borderRadius: 8,
      background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.15)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <span className="material-symbols-outlined" style={{ fontSize: 14, color: C.purple }}>{icon}</span>
    </div>
  );
}

function Chev() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3a3a5a" strokeWidth="2">
      <path d="M9 18l6-6-6-6"/>
    </svg>
  );
}
