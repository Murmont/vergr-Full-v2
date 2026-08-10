// Clone-from-Discord as a stepped popup (replaces the old full-screen
// /messages/clone-discord). Phase 1: clones a Discord server's STRUCTURE
// (text channels → Vergr groups, voice channels → Vergr voice channels).
// Members re-join via the group invite links; message history = Phase 2.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDiscordCloneSetup, cloneDiscordServerStructure, importDiscordMessages, subscribeCommunityImport } from '../../firebase/firestore';
import Icon from '../Icon';
import InviteMembersSheet from './InviteMembersSheet';
import { useUI } from '../../context/UIContext';

const STEPS = ['Add bot', 'Your server', 'Done'];

// Real Discord logo (Simple Icons path, 24×24 viewBox).
const DISCORD_PATH = 'M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z';
function DiscordLogo({ size = 20, className = '' }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className} aria-hidden="true">
      <path d={DISCORD_PATH} />
    </svg>
  );
}

export default function CloneDiscordModal({ onClose }) {
  const navigate = useNavigate();
  const { showToast } = useUI();
  const [step, setStep] = useState(1);          // 1..3
  const [setup, setSetup] = useState(null);     // { configured, botInstallUrl }
  const [guildId, setGuildId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);     // { text, installUrl? }
  // Phase 2: message-history import (runs on the box after the clone).
  const [impRange, setImpRange] = useState('90d');   // '90d' | 'full' (Pro)
  const [gdprAck, setGdprAck] = useState(false);
  const [impBusy, setImpBusy] = useState(false);
  const [impJob, setImpJob] = useState(null);        // live community_imports doc
  const [impError, setImpError] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const impUnsubRef = useRef(null);

  useEffect(() => () => { impUnsubRef.current?.(); }, []);

  useEffect(() => {
    getDiscordCloneSetup().then(setSetup).catch(() => setSetup({ configured: false, botInstallUrl: null }));
  }, []);

  const openInstall = (url) => { if (url) window.open(url, '_blank', 'noopener'); };

  const clone = async () => {
    const id = guildId.trim();
    if (!/^\d{5,25}$/.test(id)) { showToast('Enter a valid Discord server ID', 'error'); return; }
    setBusy(true); setError(null);
    try {
      const res = await cloneDiscordServerStructure(id);
      setResult(res);
      setStep(3);
    } catch (err) {
      const msg = err?.message || 'Clone failed';
      try {
        const parsed = JSON.parse(msg);
        if (parsed?.reason === 'bot_not_in_server') {
          setError({ text: 'The Vergr bot isn\'t in that server yet. Add it in step 1, then try again.', installUrl: parsed.botInstallUrl });
        } else { setError({ text: msg }); }
      } catch {
        setError({ text: msg === 'discord_bot_unconfigured' ? 'Discord cloning is being set up on our side. Check back soon.' : msg });
      }
    } finally { setBusy(false); }
  };

  const done = () => { onClose?.(); navigate('/messages'); };

  const startImport = async () => {
    if (!gdprAck) { showToast('Please confirm the notice first', 'error'); return; }
    setImpBusy(true); setImpError('');
    try {
      const res = await importDiscordMessages(guildId.trim(), { fullHistory: impRange === 'full', gdprAck: true });
      const id = res?.importId;
      if (id) {
        impUnsubRef.current?.();
        impUnsubRef.current = subscribeCommunityImport(id, setImpJob);
      }
    } catch (err) {
      const msg = err?.message || 'Import failed';
      setImpError(
        msg === 'full_history_pro_only' ? 'Full history is a Pro perk — the last 90 days is free.'
          : msg === 'clone_first' ? 'Clone the server first, then import.'
            : msg
      );
    } finally { setImpBusy(false); }
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-xl rounded-2xl bg-surface-1 border border-white/[0.08] overflow-hidden">
        {/* Header + stepper */}
        <div className="px-7 pt-6 pb-5 border-b border-white/[0.05]">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-[#5865F2]/15 flex items-center justify-center">
                <DiscordLogo size={20} className="text-[#5865F2]" />
              </span>
              <h2 className="font-syne text-xl font-extrabold text-text-primary">Clone from Discord</h2>
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary"><Icon name="close" size={22} /></button>
          </div>
          <div className="flex items-center gap-2">
            {STEPS.map((label, i) => {
              const n = i + 1;
              const active = step === n, done = step > n;
              return (
                <div key={label} className="flex items-center gap-2 flex-1 last:flex-none">
                  <div className={`flex items-center gap-1.5 ${active || done ? 'text-text-primary' : 'text-text-muted'}`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                      done ? 'bg-brand-violet text-white' : active ? 'bg-brand-violet/30 text-brand-violet-light' : 'bg-white/[0.06]'
                    }`}>
                      {done ? <Icon name="check" size={12} /> : n}
                    </span>
                    <span className="text-[10px] font-dmmono uppercase tracking-wider hidden sm:inline">{label}</span>
                  </div>
                  {n < STEPS.length && <div className={`flex-1 h-px ${done ? 'bg-brand-violet/50' : 'bg-white/[0.08]'}`} />}
                </div>
              );
            })}
          </div>
        </div>

        <div className="px-7 py-6 min-h-[240px] flex flex-col">
          {/* Step 1 — add bot */}
          {step === 1 && (
            <div className="flex flex-col flex-1">
              <p className="text-text-secondary text-[15px] leading-relaxed mb-6">
                Every Discord text channel becomes a Vergr group and every voice channel becomes a
                Vergr voice channel. First, add the Vergr bot to your server — you need the
                <b className="text-text-primary"> Manage Server</b> permission on Discord.
              </p>
              {setup && !setup.configured && (
                <p className="text-brand-gold text-xs mb-4">Cloning is still being set up on our side — you can add the bot now, but the clone may not run yet.</p>
              )}
              <div className="mt-auto space-y-2.5">
                <button
                  onClick={() => openInstall(setup?.botInstallUrl)}
                  disabled={!setup?.botInstallUrl}
                  className="w-full py-3 rounded-xl bg-[#5865F2] text-white text-sm font-bold hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <DiscordLogo size={18} className="text-white" />
                  Add Vergr bot to Discord
                </button>
                <button
                  onClick={() => setStep(2)}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white text-sm font-bold hover:brightness-110"
                >
                  I've added the bot → Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 2 — server id */}
          {step === 2 && (
            <div>
              <p className="text-text-muted text-xs leading-relaxed mb-3">
                We confirm you own the server by matching your linked Discord account to the server owner —
                link it in <button className="text-brand-violet-light font-bold" onClick={() => { onClose?.(); navigate('/settings/linked-accounts'); }}>Settings → Linked Accounts</button> if you haven't.
              </p>
              <label className="text-text-muted text-[10px] font-bold uppercase tracking-widest mb-1.5 block">Discord server ID</label>
              <p className="text-text-muted text-[11px] mb-2">
                In Discord: Settings → Advanced → enable <b>Developer Mode</b>, then right-click your server icon → <b>Copy Server ID</b>.
              </p>
              <input
                autoFocus
                value={guildId}
                onChange={e => setGuildId(e.target.value.replace(/[^\d]/g, '').slice(0, 25))}
                placeholder="e.g. 123456789012345678"
                inputMode="numeric"
                className="w-full bg-surface-2 border border-white/[0.08] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand-violet/40 mb-3"
              />
              {error && (
                <div className="rounded-xl border border-brand-ember/30 bg-brand-ember/10 p-3 text-xs text-white mb-3">
                  {error.text}
                  {error.installUrl && (
                    <button onClick={() => openInstall(error.installUrl)} className="block mt-1.5 text-[#A8B0FF] font-bold">Add the bot →</button>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => setStep(1)} className="px-4 py-2.5 rounded-xl bg-white/[0.05] text-text-secondary text-sm font-bold hover:bg-white/[0.08]">Back</button>
                <button
                  onClick={clone}
                  disabled={busy || !guildId.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white text-sm font-bold hover:brightness-110 disabled:opacity-50"
                >
                  {busy ? 'Cloning…' : 'Clone server'}
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — done + optional message-history import */}
          {step === 3 && result && (
            <div className="py-1">
              <div className="text-center mb-4">
                <Icon name="check_circle" size={40} className="text-brand-violet-light mx-auto mb-2" />
                <h3 className="text-white font-syne font-extrabold text-lg mb-1">Cloned {result.guildName}</h3>
                <p className="text-text-secondary text-sm">
                  Created <b className="text-white">{result.created.groups}</b> group{result.created.groups === 1 ? '' : 's'} and{' '}
                  <b className="text-white">{result.created.voiceChannels}</b> voice channel{result.created.voiceChannels === 1 ? '' : 's'}.
                  {result.skipped > 0 && <span className="text-text-muted text-xs"> {result.skipped} skipped (per-clone limit).</span>}
                </p>
              </div>

              {/* Message-history import */}
              <div className="rounded-xl border border-white/[0.08] bg-surface-2/60 p-4 mb-3">
                <p className="text-white text-sm font-bold mb-1">Bring the message history too?</p>
                {!impJob && (
                  <>
                    <div className="flex gap-2 mb-3 mt-2">
                      {[['90d', 'Last 90 days'], ['full', 'Full history (Pro)']].map(([v, label]) => (
                        <button key={v} onClick={() => setImpRange(v)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${impRange === v ? 'border-brand-violet/60 bg-brand-violet/15 text-white' : 'border-white/[0.08] text-text-secondary hover:bg-white/[0.04]'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-start gap-2 text-[11px] text-text-muted leading-relaxed mb-3 cursor-pointer">
                      <input type="checkbox" checked={gdprAck} onChange={(e) => setGdprAck(e.target.checked)} className="mt-0.5 accent-[#7B1FFF]" />
                      <span>
                        I understand imported messages keep their original Discord author names and content.
                        Members who join can delete their own imported messages, and I can remove any of them as the group owner.
                      </span>
                    </label>
                    {impError && <p className="text-brand-ember text-xs mb-2">{impError}</p>}
                    <button onClick={startImport} disabled={impBusy || !gdprAck}
                      className="w-full py-2.5 rounded-xl bg-[#5865F2] text-white text-sm font-bold hover:brightness-110 disabled:opacity-50">
                      {impBusy ? 'Starting…' : 'Import messages'}
                    </button>
                  </>
                )}
                {impJob && (
                  <div className="mt-2">
                    {impJob.status === 'error' ? (
                      <p className="text-brand-ember text-xs">Import failed: {impJob.error || 'unknown error'}. It will not retry — reopen this flow to try again.</p>
                    ) : impJob.status === 'done' ? (
                      <p className="text-brand-violet-light text-sm font-bold">
                        Done — {impJob.progress?.totalImported || 0} messages imported.
                        {impJob.progress?.skippedLarge > 0 && <span className="text-text-muted text-xs font-normal"> ({impJob.progress.skippedLarge} large files skipped)</span>}
                      </p>
                    ) : (
                      <p className="text-text-secondary text-sm flex items-center gap-2">
                        <span className="w-3.5 h-3.5 rounded-full border-2 border-brand-violet-light border-t-transparent animate-spin inline-block" />
                        {impJob.status === 'queued' ? 'Queued…' : `Importing… ${impJob.progress?.totalImported || 0} messages so far`}
                      </p>
                    )}
                    <p className="text-text-muted text-[10px] mt-1.5">Runs in the background — you can close this and keep using Vergr.</p>
                  </div>
                )}
              </div>

              <button onClick={() => setShowInvite(true)}
                className="w-full py-2.5 mb-2 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white text-sm font-bold hover:brightness-110 flex items-center justify-center gap-2">
                <Icon name="group_add" size={18} /> Invite your members
              </button>
              <button onClick={done} className="w-full py-2.5 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white text-sm font-bold hover:bg-white/[0.1]">
                Go to Messages
              </button>
            </div>
          )}
          {showInvite && result && (
            <InviteMembersSheet
              groups={result.groupList || []}
              source="discord"
              guildId={guildId.trim()}
              onClose={() => setShowInvite(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
