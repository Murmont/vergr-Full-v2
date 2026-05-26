// Redesigned Account Deletion page — warning banner, 30-day timeline,
// what-gets-deleted list, password confirmation. Uses Firebase Auth deleteUser
// (Cloud Function onUserDeleted handles Firestore cleanup).
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import { deleteUser, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth } from '../../firebase/config';
import TopBar from '../../components/TopBar';
import useResponsive from '../../hooks/useResponsive';
import { C, PageShell } from './_settingsUI';

export default function AccountDeletionScreen() {
  const { isMobile } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const [pwVisible, setPwVisible] = useState(false);
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  const handleDelete = async () => {
    if (!password || deleting) return;
    setDeleting(true);
    try {
      const user = auth.currentUser;
      if (user.email) {
        const cred = EmailAuthProvider.credential(user.email, password);
        await reauthenticateWithCredential(user, cred);
      }
      await deleteUser(user);
      // auth state change will redirect to /login
    } catch (err) {
      console.error('Delete failed:', err);
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        showToast('Incorrect password.', 'error');
      } else if (err.code === 'auth/requires-recent-login') {
        showToast('Please log out and log back in, then try again', 'error');
      } else {
        showToast('Failed to delete account. Please try again.', 'error');
      }
      setDeleting(false);
    }
  };

  const timeline = [
    { icon: 'event', step: 'Today', desc: 'You started account deletion', active: true },
    { icon: 'schedule', step: 'In 30 days', desc: 'Your account and data will be permanently deleted', active: true },
    { icon: 'close', step: 'After 30 days', desc: 'Your username can be claimed by others', active: false },
  ];

  const willDelete = [
    { icon: 'person', title: 'Your profile and account', desc: 'Your username, email, profile info, and settings' },
    { icon: 'emoji_events', title: 'Your activity and progress', desc: 'Match history, tournament entries, squad activity, and stats' },
    { icon: 'account_balance_wallet', title: 'Your wallet and rewards', desc: 'VERGR points, balances, rewards, and payout history' },
    { icon: 'description', title: 'Your content and data', desc: 'Uploaded content, messages, and any other data' },
    { icon: 'link', title: 'Connected accounts', desc: 'All linked third-party accounts will be disconnected' },
  ];

  return (
    <div style={{ background: C.bg, minHeight: '100%' }}>
      {isMobile && <TopBar title="Account Deletion" showBack />}
      <PageShell>
        {/* Warning */}
        <div style={{
          background: 'linear-gradient(135deg,rgba(239,68,68,0.08),rgba(185,28,28,0.04))',
          border: '1px solid rgba(239,68,68,0.25)', borderRadius: 12, padding: 20,
          display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 12,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10, background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 24, color: C.red }}>warning</span>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.red, marginBottom: 4 }}>
              Delete your account and all data
            </div>
            <div style={{ fontSize: 12, color: '#c08080' }}>
              This action is permanent and cannot be undone. Once your account is deleted, you will lose access to all your data, progress, and rewards.
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 12 }}>
          {/* Timeline */}
          <Card>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 16 }}>
              We'll delete your account in 30 days
            </div>
            <div style={{
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-around',
              marginBottom: 16, position: 'relative',
            }}>
              <div style={{
                position: 'absolute', top: 24, left: '20%', right: '20%',
                height: 1, borderTop: `2px dashed ${C.borderHard}`, zIndex: 0,
              }}/>
              {timeline.map(s => (
                <div key={s.step} style={{ textAlign: 'center', zIndex: 1, flex: 1, padding: '0 6px' }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: '50%',
                    background: s.active ? 'rgba(239,68,68,0.15)' : C.borderSoft,
                    border: s.active ? '1.5px solid rgba(239,68,68,0.4)' : `1.5px solid ${C.borderHard}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 8px',
                  }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20, color: s.active ? C.red : C.textVeryDim }}>
                      {s.icon}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4 }}>{s.step}</div>
                  <div style={{ fontSize: 11, color: C.textVeryDim, lineHeight: 1.4 }}>{s.desc}</div>
                </div>
              ))}
            </div>
            <InfoBar text="During this 30-day period, you can cancel the deletion process by logging back in to your account." />
          </Card>

          {/* What gets deleted */}
          <Card>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>What will be deleted</div>
            <div style={{ fontSize: 12, color: C.textVeryDim, marginBottom: 14 }}>After 30 days, the following will be permanently deleted:</div>
            {willDelete.map(item => (
              <div key={item.title} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '8px 0', borderBottom: `1px solid ${C.borderSoft}`,
              }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: C.red, opacity: 0.7 }}>{item.icon}</span>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#d0c0c0' }}>{item.title}</div>
                  <div style={{ fontSize: 11, color: C.textVeryDim, marginTop: 2 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </Card>
        </div>

        {/* Confirm */}
        <Card>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>Confirm account deletion</div>
          <div style={{ fontSize: 12, color: C.textVeryDim, marginBottom: 16 }}>
            To continue, please confirm your password. This helps us make sure it's really you.
          </div>
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap',
          }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>Enter your password</div>
              <div style={{ position: 'relative' }}>
                <input
                  type={pwVisible ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  style={{
                    width: '100%', background: C.cardSoft, border: `1px solid ${C.borderHard}`,
                    borderRadius: 8, padding: '11px 40px 11px 14px', fontSize: 14,
                    color: C.text, outline: 'none', boxSizing: 'border-box',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setPwVisible(v => !v)}
                  style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'transparent', border: 'none', color: C.textVeryDim, cursor: 'pointer',
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    {pwVisible ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={handleDelete}
              disabled={!password || deleting}
              style={{
                background: `linear-gradient(135deg,${C.redDeep},#991b1b)`,
                border: 'none', borderRadius: 10, padding: '12px 24px', color: '#fff',
                cursor: deleting ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', flexShrink: 0,
                minWidth: 220, opacity: !password || deleting ? 0.6 : 1,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18, marginRight: 8 }}>delete</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{deleting ? 'Deleting…' : 'Delete my account'}</div>
                <div style={{ fontSize: 11, opacity: 0.8 }}>This action cannot be undone</div>
              </div>
            </button>
          </div>
        </Card>

        {/* Footer */}
        <div style={{
          marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 16px',
          gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.textVeryDim }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>info</span>
            If you have any questions or need help, contact our support team before deleting your account.
          </div>
          <button
            type="button"
            onClick={() => navigate('/settings/help')}
            style={{
              background: 'transparent', border: 'none', color: C.purple,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
            }}
          >
            Contact Support
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>open_in_new</span>
          </button>
        </div>
      </PageShell>
    </div>
  );
}

function Card({ children }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
      {children}
    </div>
  );
}

function InfoBar({ text }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, padding: '8px 12px',
      background: C.cardSoft, border: `1px solid ${C.borderSoft}`, borderRadius: 8,
      fontSize: 11, color: C.textVeryDim,
    }}>
      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>info</span>
      <span>{text}</span>
    </div>
  );
}
