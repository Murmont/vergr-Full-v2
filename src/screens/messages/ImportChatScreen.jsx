// /messages/import — WhatsApp group import (14_GROWTH_MIGRATION §2).
//
// Arrival paths: native share-target (WhatsApp → Export chat → share to
// Vergr; the Kotlin side stages the file and dispatches vergr:native-share-file)
// or a plain file-drop/pick on web + desktop.
//
// Flow: pick/receive file → instant LOCAL parse preview (shared parser, same
// one the box worker runs) → pick target (new group named after the export,
// or an existing group you admin) → upload to R2 staging → enqueue → live
// progress → done + "Invite your members".
//
// TEXT-ONLY v1 (founder decision): a .zip export (with media) is rejected with
// guidance to re-export "Without media".
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import TopBar from '../../components/TopBar';
import UserAvatar from '../../components/UserAvatar';
import InviteMembersSheet from '../../components/messages/InviteMembersSheet';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import useResponsive from '../../hooks/useResponsive';
import { parseWhatsAppExport } from '../../utils/whatsappExportParser';
import { consumeSharedFile, sharedMediaToFile } from '../../utils/shareIn';
import {
  getConversations, getImportUploadUrl, importWhatsAppExport, subscribeCommunityImport,
} from '../../firebase/firestore';

const ZIP_HINT = 'That export includes media. Re-export from WhatsApp choosing "Without media" — media import isn\'t supported yet.';

function defaultGroupName(fileName = '') {
  // "WhatsApp Chat with Alice.txt" / "WhatsApp Chat - Squad.txt" → the name.
  const base = fileName.replace(/\.txt$/i, '');
  const m = base.match(/WhatsApp Chat (?:with |[-–] ?)(.+)/i);
  return (m ? m[1] : base).trim().slice(0, 60) || 'Imported chat';
}

export default function ImportChatScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const { isMobile } = useResponsive();
  const fileInputRef = useRef(null);

  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [target, setTarget] = useState('new');       // 'new' | chatId
  const [groupName, setGroupName] = useState('');
  const [myGroups, setMyGroups] = useState([]);
  const [gdprAck, setGdprAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState(null);
  const [resultConvo, setResultConvo] = useState(null); // { id, name }
  const [showInvite, setShowInvite] = useState(false);
  const unsubRef = useRef(null);

  useEffect(() => () => unsubRef.current?.(), []);

  // Existing groups the caller admins (import-into-existing option).
  useEffect(() => {
    if (!currentUser?.uid) return;
    getConversations(currentUser.uid).then((convs) => {
      setMyGroups((convs || []).filter((c) =>
        c.isGroup && (c.createdBy === currentUser.uid || (c.admins || []).includes(currentUser.uid))));
    }).catch(() => {});
  }, [currentUser?.uid]);

  const acceptFile = async (f) => {
    if (!f) return;
    if (/\.zip$/i.test(f.name) || /zip/.test(f.type)) { showToast(ZIP_HINT, 'error'); return; }
    if (f.size > 30 * 1024 * 1024) { showToast('File too large (30MB max)', 'error'); return; }
    const text = await f.text();
    const p = parseWhatsAppExport(text);
    if (!p.messages.length) {
      showToast('That doesn\'t look like a WhatsApp chat export (.txt)', 'error');
      return;
    }
    setFile(f);
    setParsed(p);
    setGroupName(defaultGroupName(f.name));
  };

  // Native share-target arrival: the Kotlin side staged the file.
  useEffect(() => {
    const m = consumeSharedFile();
    if (!m) return;
    if (/zip/.test(m.mime || '') || /\.zip$/i.test(m.name || '')) { showToast(ZIP_HINT, 'error'); return; }
    sharedMediaToFile(m).then((f) => f && acceptFile(f)).catch(() => showToast('Could not read the shared file', 'error'));
  }, []); // eslint-disable-line

  const rangeLabel = useMemo(() => {
    if (!parsed?.firstTs) return '';
    const fmt = (ms) => new Date(ms).toLocaleDateString();
    return `${fmt(parsed.firstTs)} – ${fmt(parsed.lastTs)}`;
  }, [parsed]);

  const startImport = async () => {
    if (!file || !parsed) return;
    if (!gdprAck) { showToast('Please confirm the notice first', 'error'); return; }
    setBusy(true);
    try {
      // 1. Stage the raw export on R2 (the worker parses it authoritatively).
      const { uploadUrl, key } = await getImportUploadUrl(file.size);
      const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: file });
      if (!put.ok) throw new Error('Upload failed');
      // 2. Enqueue.
      const res = await importWhatsAppExport({
        exportKey: key,
        groupName: target === 'new' ? groupName : undefined,
        targetChatId: target === 'new' ? undefined : target,
        gdprAck: true,
      });
      setResultConvo({ id: res.convoId, name: target === 'new' ? (res.groupName || groupName) : (myGroups.find((g) => g.id === target)?.groupName || 'group') });
      unsubRef.current?.();
      unsubRef.current = subscribeCommunityImport(res.importId, setJob);
    } catch (err) {
      showToast(err?.message === 'full_history_pro_only' ? 'Full history is a Pro perk' : (err?.message || 'Import failed'), 'error');
    } finally { setBusy(false); }
  };

  const inputCls = 'w-full bg-surface-2 border border-white/[0.08] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand-violet/40';

  return (
    <div className="min-h-full bg-bg-dark">
      {isMobile && <TopBar title="Import a chat" showBack />}
      <div className="max-w-xl mx-auto px-4 py-6">
        {!isMobile && (
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => navigate('/messages')} className="text-text-muted hover:text-text-primary"><Icon name="arrow_back" size={22} /></button>
            <h1 className="font-syne text-xl font-extrabold text-text-primary">Import a chat</h1>
          </div>
        )}

        {/* Step 1: get the file */}
        {!parsed && (
          <div>
            <p className="text-text-secondary text-sm leading-relaxed mb-4">
              Move a WhatsApp group to Vergr: in WhatsApp open the group →
              <b className="text-text-primary"> ⋮ → More → Export chat → Without media</b>,
              then share the file to Vergr — or drop it here.
            </p>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); acceptFile(e.dataTransfer?.files?.[0]); }}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-2xl border-2 border-dashed border-white/[0.12] hover:border-brand-violet/40 bg-surface-1 px-6 py-12 text-center cursor-pointer transition-colors">
              <Icon name="upload_file" size={40} className="text-brand-violet-light mx-auto mb-3" />
              <p className="text-white text-sm font-bold mb-1">Drop the export here</p>
              <p className="text-text-muted text-xs">.txt from WhatsApp's "Export chat" (text only for now)</p>
            </div>
            <input ref={fileInputRef} type="file" accept=".txt,text/plain" className="hidden"
              onChange={(e) => { acceptFile(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        )}

        {/* Step 2: preview + target */}
        {parsed && !job && (
          <div>
            <div className="rounded-2xl border border-white/[0.08] bg-surface-1 p-4 mb-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="w-10 h-10 rounded-xl bg-[#25D366]/15 flex items-center justify-center shrink-0">
                  <Icon name="chat" size={20} className="text-[#25D366]" />
                </span>
                <div className="min-w-0">
                  <p className="text-white text-sm font-bold truncate">{file?.name}</p>
                  <p className="text-text-muted text-[11px]">{rangeLabel}</p>
                </div>
                <button onClick={() => { setFile(null); setParsed(null); }} className="ml-auto text-text-muted hover:text-text-primary"><Icon name="close" size={18} /></button>
              </div>
              <div className="flex gap-4 text-center">
                <div className="flex-1"><p className="text-white font-bold text-lg tabular-nums">{parsed.messages.length.toLocaleString()}</p><p className="text-text-muted text-[10px] uppercase tracking-wider">Messages</p></div>
                <div className="flex-1"><p className="text-white font-bold text-lg tabular-nums">{parsed.participants.length}</p><p className="text-text-muted text-[10px] uppercase tracking-wider">People</p></div>
              </div>
              <p className="text-text-muted text-[10px] mt-2">
                The last 90 days import free; older history is a Pro perk. Media isn't imported yet.
              </p>
            </div>

            <label className="text-text-muted text-[10px] font-bold uppercase tracking-widest mb-1.5 block">Import into</label>
            <select value={target} onChange={(e) => setTarget(e.target.value)}
              className={`${inputCls} mb-3 [&>option]:bg-surface-2 [&>option]:text-white`}>
              <option value="new">A new group</option>
              {myGroups.map((g) => <option key={g.id} value={g.id}>{g.groupName || 'Group'} (existing)</option>)}
            </select>
            {target === 'new' && (
              <input value={groupName} onChange={(e) => setGroupName(e.target.value.slice(0, 60))}
                placeholder="Group name" className={`${inputCls} mb-3`} />
            )}

            <label className="flex items-start gap-2 text-[11px] text-text-muted leading-relaxed mb-4 cursor-pointer">
              <input type="checkbox" checked={gdprAck} onChange={(e) => setGdprAck(e.target.checked)} className="mt-0.5 accent-[#7B1FFF]" />
              <span>
                I'm a member of this chat and understand imported messages keep their original author
                names and content. People who join can delete their own imported messages.
              </span>
            </label>

            <button onClick={startImport} disabled={busy || !gdprAck || (target === 'new' && !groupName.trim())}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white text-sm font-bold hover:brightness-110 disabled:opacity-50">
              {busy ? 'Starting…' : 'Import chat'}
            </button>
          </div>
        )}

        {/* Step 3: progress + done */}
        {job && (
          <div className="rounded-2xl border border-white/[0.08] bg-surface-1 p-5 text-center">
            {job.status === 'error' ? (
              <>
                <Icon name="error" size={38} className="text-brand-ember mx-auto mb-2" />
                <p className="text-white text-sm font-bold mb-1">Import failed</p>
                <p className="text-text-muted text-xs mb-4">{job.error || 'Unknown error'}</p>
                <button onClick={() => { setJob(null); unsubRef.current?.(); }} className="px-5 py-2.5 rounded-xl bg-white/[0.06] text-white text-sm font-bold">Try again</button>
              </>
            ) : job.status === 'done' ? (
              <>
                <Icon name="check_circle" size={40} className="text-brand-violet-light mx-auto mb-2" />
                <p className="text-white font-syne font-extrabold text-lg mb-1">{resultConvo?.name} is ready</p>
                <p className="text-text-secondary text-sm mb-4">
                  {job.progress?.totalImported?.toLocaleString?.() || 0} messages imported.
                  Now invite the group — everyone who joins finds the history waiting.
                </p>
                <button onClick={() => setShowInvite(true)}
                  className="w-full py-3 mb-2 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white text-sm font-bold hover:brightness-110 flex items-center justify-center gap-2">
                  <Icon name="group_add" size={18} /> Invite your members
                </button>
                <button onClick={() => navigate(`/messages/${resultConvo?.id}`)}
                  className="w-full py-3 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white text-sm font-bold hover:bg-white/[0.1]">
                  Open the group
                </button>
              </>
            ) : (
              <>
                <span className="w-8 h-8 rounded-full border-[3px] border-brand-violet-light border-t-transparent animate-spin inline-block mb-3" />
                <p className="text-white text-sm font-bold mb-1">
                  {job.status === 'queued' ? 'Queued…' : `Importing… ${job.progress?.totalImported?.toLocaleString?.() || 0} messages`}
                </p>
                <p className="text-text-muted text-xs">Runs in the background — you can leave this screen.</p>
              </>
            )}
          </div>
        )}
      </div>

      {showInvite && resultConvo && (
        <InviteMembersSheet
          groups={[{ id: resultConvo.id, name: resultConvo.name }]}
          source="whatsapp"
          onClose={() => setShowInvite(false)}
        />
      )}
    </div>
  );
}
