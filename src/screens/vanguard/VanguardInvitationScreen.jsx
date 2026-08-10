// Vanguard invitation acceptance screen — `/vanguard/invitation`.
// Loaded from the notification link. Shows the program summary + the full
// Code of Conduct + an explicit checkbox the invitee must tick before the
// Accept button enables. Accepting writes the rank to their user doc and
// adds them to the Vanguard squad (server-side).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { getMyVanguardInvitations } from '../../firebase/firestore';
import { rankMeta } from '../../utils/vanguard';
import Icon from '../../components/Icon';

const C = { bg: '#0B0B14', card: '#12121e', border: '#1e1e30', text: '#fff', textDim: '#9CA3AF', purple: '#B44FFF', gold: '#F5C842' };

const CONDUCT = [
  '**Anonymity is absolute.** Never reveal your real identity to any user. First offence = demotion to Recruit. Second offence = removal + permanent ban from Vanguard.',
  '**No personal moderation.** Never moderate content involving someone you have an off-platform relationship with. Pass the case.',
  '**No retaliation.** Never use moderation powers against users who criticised you or the platform.',
  '**Tournament decisions are final** once posted unless appealed to Senior+.',
  '**Confidentiality.** Audit logs, evidence, user reports, and internal Vanguard chat content are never shared externally.',
  '**Consistency.** Apply the same rule to similar cases. Ask in squad chat when unsure.',
  '**Inactivity = forfeit.** No login in 30 days = inactive, treasury share suspended. 90 days = rank degrades by one.',
  '**Conflict of interest disclosure.** Declare any stake in content/tournaments you\'re moderating and recuse yourself.',
];

export default function VanguardInvitationScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const [inv, setInv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!currentUser?.uid) { setLoading(false); return; }
    getMyVanguardInvitations(currentUser.uid)
      .then((list) => setInv(list[0] || null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentUser?.uid]);

  const onAccept = async () => {
    if (!accepted || !inv) return;
    setBusy(true);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'acceptVanguardInvitation');
      await fn({ invitationId: inv.id, acceptedConductCode: true });
      showToast(`Welcome to the Vanguard, ${rankMeta(inv.startRank).label}.`, 'success');
      navigate('/vanguard/me');
    } catch (e) {
      showToast(e?.message || 'Could not accept', 'error');
      setBusy(false);
    }
  };
  const onDecline = async () => {
    if (!inv) return;
    if (!window.confirm('Decline this invitation? You can be re-invited later but this one will close.')) return;
    setBusy(true);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'declineVanguardInvitation');
      await fn({ invitationId: inv.id });
      showToast('Invitation declined', 'info');
      navigate('/');
    } catch (e) {
      showToast(e?.message || 'Failed', 'error');
      setBusy(false);
    }
  };

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: C.textDim, background: C.bg, minHeight: '100vh' }}>Loading…</div>;
  if (!inv) return (
    <div style={{ padding: 60, textAlign: 'center', color: C.textDim, background: C.bg, minHeight: '100vh' }}>
      <Icon name="mail" size={48} className="opacity-40 mx-auto" />
      <p style={{ marginTop: 12 }}>You have no pending Vanguard invitations.</p>
      <button onClick={() => navigate('/')} style={{ marginTop: 20, padding: '10px 20px', background: C.purple, color: '#fff', border: 0, borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>Back to Home</button>
    </div>
  );

  const meta = rankMeta(inv.startRank);

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px' }}>
        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src={meta.avatar} alt="" style={{ width: 96, height: 96, borderRadius: 18, objectFit: 'cover', margin: '0 auto 16px', boxShadow: `0 0 40px ${C.purple}55` }} />
          <div style={{ fontFamily: 'Syne', fontSize: 28, fontWeight: 800, marginBottom: 6 }}>You've been invited to the Vanguard</div>
          <div style={{ color: C.textDim, fontSize: 14, marginBottom: 16 }}>VERGR is offering you a starting position as <strong style={{ color: C.purple }}>{meta.label}</strong>.</div>
          {inv.message && (
            <div style={{ display: 'inline-block', textAlign: 'left', padding: '12px 16px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, maxWidth: 480, color: C.textDim, fontSize: 13, lineHeight: 1.55 }}>
              <strong style={{ color: '#fff', display: 'block', marginBottom: 4 }}>Message from the founder:</strong>
              {inv.message}
            </div>
          )}
        </div>

        {/* Program summary */}
        <section style={{ padding: 20, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 20 }}>
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 18, marginBottom: 12 }}>What you're signing up for</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13.5, lineHeight: 1.6, color: C.textDim }}>
            <div>• You are <strong style={{ color: '#fff' }}>anonymous to other users</strong>. They see you as "@{meta.usernameTag}" with your rank badge. Other Vanguard members + the founder see your real identity.</div>
            <div>• <strong style={{ color: '#fff' }}>This email is now your Vanguard account.</strong> If you want to participate as a regular user (tournaments, posts, etc.) you need a separate account with a different email.</div>
            <div>• <strong style={{ color: C.gold }}>Coin → Gem conversion is FREE</strong> for you (normal users pay 5–30% commission).</div>
            <div>• <strong style={{ color: C.gold }}>The Vanguard squad treasury</strong> receives the 5% mod fee from every tournament Vanguard moderates. Monthly auto-distribution to active members, weighted by rank × actions taken.</div>
            <div>• Every confirmed moderation action grants VP — pushes you to L100 fast, which is the 5% withdrawal-commission floor.</div>
            <div>• <strong style={{ color: '#fff' }}>Unlimited invites.</strong> Normal users have a per-week cap; you don't. More users = more tournament fees = more for Vanguard.</div>
          </div>
        </section>

        {/* Code of Conduct */}
        <section style={{ padding: 20, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 20 }}>
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 18, marginBottom: 12 }}>Vanguard Code of Conduct</div>
          <ol style={{ paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, lineHeight: 1.6, color: C.textDim }}>
            {CONDUCT.map((c, i) => (
              <li key={i} dangerouslySetInnerHTML={{ __html: c.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff">$1</strong>') }} />
            ))}
          </ol>
          <div style={{ marginTop: 16, padding: 12, background: 'rgba(240,64,96,.08)', border: '1px solid rgba(240,64,96,.25)', borderRadius: 8, fontSize: 12, color: '#fda4af', lineHeight: 1.55 }}>
            <strong style={{ color: '#f04060' }}>Consequences:</strong> minor breach = warning logged. Repeated minor / first major breach = demotion by one rank. Severe breach (anonymity break, leak, abuse of power) = immediate removal + permanent ban from the Vanguard.
          </div>
        </section>

        {/* Accept */}
        <section style={{ padding: 20, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14 }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 13.5, lineHeight: 1.5 }}>
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} style={{ marginTop: 3, accentColor: C.purple }} />
            <span>I have read and agree to the Vanguard Code of Conduct. I understand my identity will be masked from other users and that this email becomes my Vanguard account.</span>
          </label>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button onClick={onDecline} disabled={busy} style={{ flex: '0 0 auto', padding: '12px 18px', background: 'transparent', color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>Decline</button>
            <button onClick={onAccept} disabled={!accepted || busy} style={{ flex: 1, padding: '12px 18px', background: !accepted || busy ? '#444' : C.purple, color: '#fff', border: 0, borderRadius: 8, cursor: !accepted || busy ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 14 }}>
              {busy ? 'Joining the Vanguard…' : `Accept · Become ${meta.label}`}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
