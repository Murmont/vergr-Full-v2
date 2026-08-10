// src/screens/settings/BackupSettingsScreen.jsx
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import TopBar from '../../components/TopBar';
import useResponsive from '../../hooks/useResponsive';
import { downloadFullBackup, restoreBackup, setBackupSchedule, getBackupSchedule, getLastBackupTime } from '../../utils/chatBackup';
import { getStorageUsage, clearAllMessageCache } from '../../utils/localDb';

export default function BackupSettingsScreen() {
  const navigate = useNavigate();
  const { isMobile } = useResponsive();
  const fileInputRef = useRef(null);

  const [schedule, setSchedule] = useState('off');
  const [lastBackup, setLastBackup] = useState(null);
  const [storageInfo, setStorageInfo] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const sched = await getBackupSchedule();
    setSchedule(sched);
    const last = await getLastBackupTime();
    setLastBackup(last);
    const usage = await getStorageUsage();
    setStorageInfo(usage);
  };

  const handleScheduleChange = async (freq) => {
    setSchedule(freq);
    await setBackupSchedule(freq);
    showToast(`Backup set to ${freq === 'off' ? 'manual only' : freq}`);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await downloadFullBackup();
      showToast(`Exported ${data.messages.length} messages`);
      setLastBackup(new Date().toISOString());
    } catch (err) {
      showToast('Export failed');
    }
    setExporting(false);
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true);
    try {
      const result = await restoreBackup(file);
      showToast(`Restored ${result.messages} messages`);
      loadSettings();
    } catch (err) {
      showToast(err.message || 'Import failed');
    }
    setImporting(false);
  };

  const handleClearCache = async () => {
    if (!window.confirm('Clear all locally cached messages? This cannot be undone. Your messages on Firestore are unaffected.')) return;
    setClearing(true);
    try {
      await clearAllMessageCache();
      showToast('Local cache cleared');
      loadSettings();
    } catch (err) {
      showToast('Clear failed');
    }
    setClearing(false);
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
  };

  const formatLastBackup = () => {
    if (!lastBackup) return 'Never';
    const d = new Date(lastBackup);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const SCHEDULES = [
    { value: 'off', label: 'Manual Only', desc: 'Back up when you choose' },
    { value: 'daily', label: 'Daily', desc: 'Auto-download backup every day' },
    { value: 'weekly', label: 'Weekly', desc: 'Auto-download backup every week' },
    { value: 'monthly', label: 'Monthly', desc: 'Auto-download backup every month' },
  ];

  return (
    <div className="pb-8">
      {isMobile ? <TopBar title="Data & Storage" showBack /> : (
        <div className="flex items-center gap-3 px-4 pt-4 pb-2">
          <button onClick={() => navigate(-1)} className="text-white/80 hover:text-white"><Icon name="arrow_back" size={24} /></button>
          <h1 className="text-lg font-bold text-white">Data & Storage</h1>
        </div>
      )}

      <div className="px-4 mt-4 space-y-6">
        {/* Storage Usage */}
        <div>
          <h3 className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 px-1">Local Storage</h3>
          <div className="rounded-2xl border border-white/[0.06] bg-surface-1 p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-brand-violet/10 flex items-center justify-center">
                <Icon name="storage" size={22} className="text-brand-violet-light" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-white font-semibold">{storageInfo ? formatBytes(storageInfo.usageBytes) : '...'} used</p>
                <p className="text-[10px] text-text-muted">
                  {storageInfo ? `${storageInfo.msgCount} messages · ${storageInfo.convoCount} chats` : 'Calculating...'}
                </p>
              </div>
            </div>
            {storageInfo?.quotaBytes > 0 && (
              <div className="w-full h-1.5 bg-surface-2 rounded-full overflow-hidden">
                <div className="h-full bg-brand-violet rounded-full transition-all" style={{ width: `${Math.min((storageInfo.usageBytes / storageInfo.quotaBytes) * 100, 100)}%` }} />
              </div>
            )}
            <p className="text-[10px] text-text-muted mt-2">Messages and media are stored on your device. VERGR doesn't keep your chats on our servers.</p>
          </div>
        </div>

        {/* Backup Now */}
        <div>
          <h3 className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 px-1">Backup</h3>
          <div className="rounded-2xl border border-white/[0.06] bg-surface-1 overflow-hidden">
            <button onClick={handleExport} disabled={exporting}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2 transition-colors text-left disabled:opacity-50">
              <Icon name="cloud_download" size={22} className="text-brand-violet-light" />
              <div className="flex-1">
                <span className="text-sm text-text-primary font-medium">{exporting ? 'Exporting...' : 'Export Backup Now'}</span>
                <p className="text-[10px] text-text-muted">Last backup: {formatLastBackup()}</p>
              </div>
              <Icon name="chevron_right" size={18} className="text-text-muted" />
            </button>

            <div className="border-t border-white/[0.04]" />

            <button onClick={() => fileInputRef.current?.click()} disabled={importing}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2 transition-colors text-left disabled:opacity-50">
              <Icon name="cloud_upload" size={22} className="text-text-secondary" />
              <div className="flex-1">
                <span className="text-sm text-text-primary font-medium">{importing ? 'Importing...' : 'Restore from Backup'}</span>
                <p className="text-[10px] text-text-muted">Import a .json backup file</p>
              </div>
              <Icon name="chevron_right" size={18} className="text-text-muted" />
            </button>
            <input ref={fileInputRef} type="file" accept=".json" hidden onChange={handleImport} />
          </div>
        </div>

        {/* Backup Schedule */}
        <div>
          <h3 className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 px-1">Auto Backup</h3>
          <div className="rounded-2xl border border-white/[0.06] bg-surface-1 overflow-hidden">
            {SCHEDULES.map((s, i) => (
              <button key={s.value} onClick={() => handleScheduleChange(s.value)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2 transition-colors text-left ${i > 0 ? 'border-t border-white/[0.04]' : ''}`}>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  schedule === s.value ? 'border-brand-violet bg-brand-violet' : 'border-text-muted/30'
                }`}>
                  {schedule === s.value && <div className="w-2 h-2 bg-bg-dark rounded-full" />}
                </div>
                <div className="flex-1">
                  <span className="text-sm text-text-primary font-medium">{s.label}</span>
                  <p className="text-[10px] text-text-muted">{s.desc}</p>
                </div>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-text-muted mt-2 px-1">Auto backups download a .json file to your device. For cloud backup to Google Drive or iCloud, use the mobile app.</p>
        </div>

        {/* Clear Cache */}
        <div>
          <h3 className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 px-1">Danger Zone</h3>
          <div className="rounded-2xl border border-white/[0.06] bg-surface-1 overflow-hidden">
            <button onClick={handleClearCache} disabled={clearing}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-red-500/5 transition-colors text-left disabled:opacity-50">
              <Icon name="delete_sweep" size={22} className="text-brand-ember" />
              <div className="flex-1">
                <span className="text-sm text-brand-ember font-medium">{clearing ? 'Clearing...' : 'Clear Local Cache'}</span>
                <p className="text-[10px] text-text-muted">Delete all locally stored messages. Chats will re-sync from server.</p>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-surface-2 text-white text-sm font-medium px-5 py-2.5 rounded-full border border-white/[0.06] shadow-xl z-50 animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}