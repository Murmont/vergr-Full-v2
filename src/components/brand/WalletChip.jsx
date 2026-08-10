// Wallet chip — VC coins or VP gems. Uses the brand PNG icons.
// Size: "sm" (compact header chip) or "md" (stat tile).
export default function WalletChip({ type = 'vc', amount = 0, size = 'sm', onClick }) {
  const src = type === 'vp' ? '/brand/vp-gem.webp' : '/brand/vc-coin.webp';
  const label = type === 'vp' ? 'VP' : 'VC';
  const color = type === 'vp' ? 'text-brand-violet' : 'text-brand-gold';
  const ring = type === 'vp' ? 'ring-brand-violet/30' : 'ring-brand-gold/30';
  const formatted = Number(amount).toLocaleString();

  if (size === 'md') {
    return (
      <button
        onClick={onClick}
        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12] transition-colors"
      >
        <img src={src} alt={label} className="w-7 h-7 object-contain" />
        <div className="text-left">
          <div className={`font-dmmono text-sm font-bold tabular-nums ${color}`}>{formatted}</div>
          <div className="text-[9px] font-dmmono uppercase tracking-[0.12em] text-text-muted">{label}</div>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 pl-1.5 pr-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] transition-colors ring-1 ${ring}`}
      title={`${label} balance`}
    >
      <img src={src} alt={label} className="w-5 h-5 object-contain" />
      <span className={`font-dmmono text-xs font-bold tabular-nums ${color}`}>{formatted}</span>
    </button>
  );
}
