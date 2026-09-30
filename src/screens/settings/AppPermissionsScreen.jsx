// App Permissions — reflects the REAL browser/device permission state and lets
// the user trigger the genuine system prompt. There is no programmatic way to
// revoke a granted permission from a web context, so once granted/blocked we
// surface honest status + point to device settings rather than faking a toggle.
import { useState, useEffect, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { setupPushNotifications } from '../../utils/pushNotifications';

// status: 'granted' | 'denied' | 'prompt' | 'unsupported'
const STATUS_META = {
  granted: { label: 'Allowed', color: '#22c55e' },
  denied: { label: 'Blocked', color: '#ef4444' },
  prompt: { label: 'Not set', color: '#f59e0b' },
  unsupported: { label: 'N/A', color: '#6b7280' },
};

async function queryPermission(name) {
  try {
    if (!navigator.permissions?.query) return 'unsupported';
    const res = await navigator.permissions.query({ name });
    return res.state; // 'granted' | 'denied' | 'prompt'
  } catch {
    return 'unsupported';
  }
}

export default function AppPermissionsScreen() {
  const { isDesktop } = useResponsive();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  const [state, setState] = useState({
    camera: 'unsupported', microphone: 'unsupported',
    notifications: 'unsupported', location: 'unsupported', storage: 'granted',
  });
  const [busy, setBusy] = useState(null);

  const refresh = useCallback(async () => {
    const [camera, microphone, location] = await Promise.all([
      queryPermission('camera'),
      queryPermission('microphone'),
      queryPermission('geolocation'),
    ]);
    let notifications = 'unsupported';
    if (typeof Notification !== 'undefined') {
      notifications = Notification.permission === 'default' ? 'prompt' : Notification.permission;
    }
    // File access on the web has no persistent permission — granted at pick time.
    setState({ camera, microphone, location, notifications, storage: 'granted' });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Trigger the genuine system prompt for a given permission.
  const request = async (key) => {
    setBusy(key);
    try {
      if (key === 'camera' || key === 'microphone') {
        const stream = await navigator.mediaDevices.getUserMedia(
          key === 'camera' ? { video: true } : { audio: true }
        );
        stream.getTracks().forEach(t => t.stop()); // release immediately
        showToast(`${key === 'camera' ? 'Camera' : 'Microphone'} access granted`, 'success');
      } else if (key === 'notifications') {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          if (currentUser?.uid) await setupPushNotifications(currentUser.uid);
          showToast('Notifications enabled', 'success');
        } else {
          showToast('Notifications blocked', 'error');
        }
      } else if (key === 'location') {
        await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
        );
        showToast('Location access granted', 'success');
      }
    } catch (err) {
      // User dismissed or device denied — re-query reflects the real state.
      showToast('Permission was not granted', 'error');
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const items = [
    { key: 'camera', label: 'Camera', desc: 'For profile photos, posts, and streaming', icon: 'photo_camera' },
    { key: 'microphone', label: 'Microphone', desc: 'For voice notes and streaming', icon: 'mic' },
    { key: 'notifications', label: 'Notifications', desc: 'Push notifications for activity', icon: 'notifications' },
    { key: 'location', label: 'Location', desc: 'For finding people and events near you', icon: 'location_on' },
    { key: 'storage', label: 'Photo Library', desc: 'Granted when you choose a file to upload', icon: 'photo_library' },
  ];

  return (
    <div className={isDesktop ? "min-h-screen pb-8" : "screen-container min-h-screen pb-8"}>
      <TopBar title="App Permissions" showBack />
      <div className="px-4 py-4 space-y-2">
        {items.map(item => {
          const st = state[item.key];
          const meta = STATUS_META[st] || STATUS_META.unsupported;
          const canRequest = (st === 'prompt') && item.key !== 'storage';
          return (
            <div key={item.key} className="flex items-center justify-between p-4 rounded-2xl bg-surface-1 border border-white/[0.06]">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Icon name={item.icon} size={20} className="text-text-secondary shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{item.label}</p>
                  <p className="text-xs text-text-muted truncate">{item.desc}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full"
                  style={{ color: meta.color, background: `${meta.color}1a` }}>
                  {meta.label}
                </span>
                {canRequest && (
                  <button onClick={() => request(item.key)} disabled={busy === item.key}
                    className="text-[12px] font-semibold px-3 py-1.5 rounded-full bg-brand-violet text-white disabled:opacity-60">
                    {busy === item.key ? '…' : 'Allow'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <p className="text-text-muted text-xs px-1 pt-2">
          Permissions are controlled by your device. "Allow" opens the system prompt.
          To change a permission that is already Allowed or Blocked, use your browser
          or device settings for this site/app.
        </p>
      </div>
    </div>
  );
}
