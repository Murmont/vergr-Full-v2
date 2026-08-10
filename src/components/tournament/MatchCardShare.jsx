// MatchCardShare — generates a 1080x1080 PNG of the match result for
// social sharing. Pure client-side canvas; no server roundtrip.
// Includes both avatars, score, game, prize, tamper-proof match hash.

import { useEffect, useRef, useState } from 'react';
import { useUI } from '../../context/UIContext';

const C = {
  bg: '#0B0B14', surface: '#14141F',
  gold: '#F0A500', goldLight: '#F5C842', cyan: '#B44FFF',
  text: '#fff', dim: 'rgba(255,255,255,0.65)',
};

export default function MatchCardShare({ match, tournament, p1, p2, onClose }) {
  const canvasRef = useRef(null);
  const { showToast } = useUI();
  const [busy, setBusy] = useState(false);

  useEffect(() => { draw(); /* eslint-disable-next-line */ }, [match, tournament, p1, p2]);

  const draw = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = 1080; canvas.height = 1080;
    const ctx = canvas.getContext('2d');

    // BG
    const grad = ctx.createRadialGradient(540, 540, 50, 540, 540, 700);
    grad.addColorStop(0, '#1a1325');
    grad.addColorStop(1, C.bg);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 1080, 1080);

    // Top brand
    ctx.fillStyle = C.gold;
    ctx.font = 'bold 28px Syne, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('VERGR TOURNAMENT', 540, 90);

    ctx.fillStyle = C.text;
    ctx.font = 'bold 44px Syne, sans-serif';
    ctx.fillText(tournament?.name || 'Tournament', 540, 150);

    ctx.fillStyle = C.dim;
    ctx.font = '500 24px DM Sans, sans-serif';
    ctx.fillText(tournament?.game || '', 540, 190);

    // VS box
    const winner = match?.winner;
    const w1 = winner === match?.player1, w2 = winner === match?.player2;

    drawPlayer(ctx, 200, 420, p1, w1, await loadImg(p1?.avatar));
    drawPlayer(ctx, 880, 420, p2, w2, await loadImg(p2?.avatar));

    ctx.fillStyle = C.gold;
    ctx.font = 'bold 90px Syne, sans-serif';
    ctx.fillText('VS', 540, 460);

    // Result
    if (winner) {
      ctx.fillStyle = C.cyan;
      ctx.font = 'bold 20px DM Mono, monospace';
      ctx.fillText('WINNER', 540, 700);
      ctx.fillStyle = C.text;
      ctx.font = 'bold 56px Syne, sans-serif';
      const wName = (w1 ? p1?.username : p2?.username) || 'TBA';
      ctx.fillText(wName, 540, 760);
    }

    // Prize
    if (tournament?.entryFee) {
      const prize = tournament.entryFee * (tournament.participants?.length || 0);
      ctx.fillStyle = C.gold;
      ctx.font = 'bold 32px DM Mono, monospace';
      ctx.fillText(`Prize Pool · ${prize.toLocaleString()} c`, 540, 850);
    }

    // Tamper-proof hash
    const hash = await tamperHash(match, tournament);
    ctx.fillStyle = C.dim;
    ctx.font = '14px DM Mono, monospace';
    ctx.fillText(`Verify · vergr.app/v/${hash.slice(0, 12)}`, 540, 1020);

    ctx.fillStyle = C.gold;
    ctx.font = 'bold 12px DM Mono, monospace';
    ctx.fillText('VERGR.APP', 540, 1050);
  };

  const handleDownload = () => {
    setBusy(true);
    try {
      const url = canvasRef.current.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `vergr-match-${match?.id || 'result'}.png`;
      a.click();
    } finally { setBusy(false); }
  };

  const handleShare = async () => {
    setBusy(true);
    try {
      const blob = await new Promise((r) => canvasRef.current.toBlob(r, 'image/png'));
      if (navigator.share && navigator.canShare?.({ files: [new File([blob], 'match.png', { type: 'image/png' })] })) {
        await navigator.share({
          title: tournament?.name || 'VERGR match',
          text: `Match result on VERGR`,
          files: [new File([blob], 'match.png', { type: 'image/png' })],
        });
      } else {
        handleDownload();
      }
    } catch (err) {
      showToast(err?.message || 'Share cancelled', 'info');
    } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.surface, borderRadius: 18, padding: 16,
        maxWidth: 500, width: '100%',
      }}>
        <canvas ref={canvasRef} style={{ width: '100%', borderRadius: 12 }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={handleShare} disabled={busy} style={ctaPrimary}>Share</button>
          <button onClick={handleDownload} disabled={busy} style={ctaSecondary}>Download</button>
        </div>
      </div>
    </div>
  );
}

function drawPlayer(ctx, cx, cy, user, isWinner, img) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 110, 0, Math.PI * 2);
  ctx.clip();
  if (img) ctx.drawImage(img, cx - 110, cy - 110, 220, 220);
  else { ctx.fillStyle = '#333'; ctx.fillRect(cx - 110, cy - 110, 220, 220); }
  ctx.restore();
  ctx.strokeStyle = isWinner ? C.gold : 'rgba(255,255,255,0.2)';
  ctx.lineWidth = isWinner ? 8 : 3;
  ctx.beginPath(); ctx.arc(cx, cy, 110, 0, Math.PI * 2); ctx.stroke();

  ctx.fillStyle = C.text;
  ctx.font = 'bold 32px Syne, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(user?.username || '?', cx, cy + 170);
}

function loadImg(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const i = new Image(); i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i); i.onerror = () => resolve(null);
    i.src = src;
  });
}

async function tamperHash(match, tournament) {
  const s = `${tournament?.id || ''}:${match?.id || ''}:${match?.winner || ''}:${match?.completedAt?.seconds || 0}`;
  const buf = new TextEncoder().encode(s);
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ctaPrimary = {
  flex: 1, padding: 12, borderRadius: 10, border: 'none',
  background: `linear-gradient(135deg, ${C.gold}, ${C.goldLight})`,
  color: '#000', fontSize: 14, fontWeight: 900, cursor: 'pointer',
};
const ctaSecondary = {
  flex: 1, padding: 12, borderRadius: 10, border: `1px solid rgba(255,255,255,0.15)`,
  background: 'transparent', color: C.text, fontSize: 14, fontWeight: 700, cursor: 'pointer',
};
