import VergrMeView from '../VergrMeView';

// Polished device-framed live preview (notch + status bar + floating label),
// wrapping the shared WYSIWYG renderer so it's pixel-identical to the public page.
export default function PhonePreview({ data, avatarUrl, width = 312, height = 640, floating = true }) {
  return (
    <div className="relative">
      <div className="relative bg-gray-900 rounded-[2.6rem] shadow-2xl p-2.5 border-[7px] border-gray-800" style={{ width, height }}>
        {/* Notch */}
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-28 h-5 bg-gray-900 rounded-b-2xl z-20" />
        {/* Screen */}
        <div className="relative w-full h-full rounded-[2rem] overflow-hidden bg-bg-dark">
          {/* Status bar */}
          <div className="absolute top-0 left-0 right-0 h-9 flex items-center justify-between px-6 text-[10px] text-white/80 z-10 pointer-events-none">
            <span className="font-dmmono">9:41</span>
            <div className="flex items-center gap-1">
              <div className="w-3.5 h-2.5 border border-white/70 rounded-[2px]" />
              <div className="w-0.5 h-2.5 bg-white/70 rounded-sm" />
            </div>
          </div>
          <div className="h-full overflow-y-auto scrollbar-none">
            <VergrMeView data={data} avatarUrl={avatarUrl} interactive={false} />
          </div>
        </div>
      </div>
      {floating && (
        <div className="absolute -left-3 top-16 px-2.5 py-1 bg-surface-1/90 backdrop-blur-sm rounded-lg shadow-lg text-[10px] text-text-secondary border border-white/10">
          Live Preview
        </div>
      )}
    </div>
  );
}
