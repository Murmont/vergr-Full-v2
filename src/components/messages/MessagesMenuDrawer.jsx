// Mobile messages side-drawer (hamburger menu). On mobile there is no left
// sidebar, so the Messages "communication hub" nav (All Chats / Calls / Status
// / Friends / Browse Groups / Squads / Requests) lives here, slid in from the
// left. Shared by the web mobile inbox and the native inbox. Items + glossy 3D
// icons come from MESSAGING_NAV so the desktop rail and this drawer never drift.
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../Icon';
import { MESSAGING_NAV } from '../../config/navConfig';
import { isQrScanSupported, scanQr, qrValueToPath } from '../../utils/qrScanner';
import { useUI } from '../../context/UIContext';
import MyQrModal from './MyQrModal';

const MSG_MENU = MESSAGING_NAV.groups[0].items;

export default function MessagesMenuDrawer({ open, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useUI();
  const [showQr, setShowQr] = useState(false);

  // Native-only: scan a Vergr QR code (add friend / join squad / join
  // tournament / event check-in) and deep-link into the app.
  const canScan = isQrScanSupported();
  const handleScan = async () => {
    onClose();
    const value = await scanQr();
    if (!value) return;
    const path = qrValueToPath(value);
    if (path) navigate(path);
  };

  // Paste a copied Vergr link (invite / profile / event) and route to it — the
  // no-camera counterpart to Scan code. Extracts the first vergr.app/vergr.me/
  // vergr:// link from whatever is on the clipboard.
  const handlePaste = async () => {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { /* denied */ }
    if (!text) { showToast?.('Nothing to paste', 'error'); return; }
    const match = text.match(/(https?:\/\/(?:www\.)?vergr\.(?:app|me)\/\S+|vergr:\/\/\S+)/i);
    const path = qrValueToPath(match ? match[1] : text.trim());
    if (path) { onClose(); navigate(path); }
    else showToast?.('No Vergr link found on your clipboard', 'error');
  };
  return (
    <div className={`fixed inset-0 z-[80] ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}
      />
      {/* Panel */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-[280px] max-w-[82%] bg-[#0F0F1A] border-r border-white/[0.06] flex flex-col transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="flex items-center gap-2.5 px-4 h-[56px] border-b border-white/[0.04]">
          <img src="/brand/logo.png" alt="" className="w-7 h-7 rounded-lg shrink-0" />
          <span className="font-syne text-base font-extrabold text-white">Messages</span>
        </div>
        <nav className="flex-1 overflow-y-auto no-scrollbar p-2 space-y-0.5">
          {MSG_MENU.map((m) => {
            const active = location.pathname === m.path;
            return (
              <button
                key={m.path}
                onClick={() => { onClose(); navigate(m.path); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                  active ? 'text-white backdrop-blur-md' : 'text-text-secondary hover:bg-white/[0.04]'
                }`}
                style={active ? { background: 'rgba(255,255,255,0.06)', boxShadow: '0 0 0 1px rgba(180,79,255,0.60), 0 0 18px 2px rgba(138,18,202,0.55), 0 0 40px rgba(123,31,255,0.30), inset 0 1px 0 rgba(255,255,255,0.12)' } : undefined}
              >
                {m.img ? (
                  <img
                    src={m.img}
                    alt=""
                    draggable={false}
                    className="w-9 h-9 shrink-0"
                    style={active ? { filter: 'drop-shadow(0 0 7px rgba(138,18,202,0.6))' } : undefined}
                  />
                ) : (
                  <Icon name={m.icon} size={22} filled={active} />
                )}
                <span className="text-[14px] font-medium">{m.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="p-2 border-t border-white/[0.04] space-y-0.5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}>
          <button
            onClick={() => setShowQr(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-text-secondary hover:bg-white/[0.04] transition-colors"
          >
            <Icon name="qr_code_2" size={22} />
            <span className="text-[14px] font-medium">My QR code</span>
          </button>
          <button
            onClick={handlePaste}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-text-secondary hover:bg-white/[0.04] transition-colors"
          >
            <Icon name="content_paste" size={22} />
            <span className="text-[14px] font-medium">Paste code</span>
          </button>
          {canScan && (
            <button
              onClick={handleScan}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-text-secondary hover:bg-white/[0.04] transition-colors"
            >
              <Icon name="qr_code_scanner" size={22} />
              <span className="text-[14px] font-medium">Scan code</span>
            </button>
          )}
        </div>
      </div>
      <MyQrModal open={showQr} onClose={() => setShowQr(false)} />
    </div>
  );
}
