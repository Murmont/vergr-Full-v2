export default function VergrLogo({ size = 48, showText = false, className = '' }) {
  // Uses the real app icon (same asset as the PWA home-screen icon) so the
  // auth screens and the installed-app icon stay visually identical.
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <img
        src="/icons/icon-512-v2.png"
        alt="VERGR"
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: size * 0.22, display: 'block' }}
      />
      {showText && (
        <h1 className="font-syne text-2xl font-extrabold text-text-primary tracking-tight">VERGR</h1>
      )}
    </div>
  );
}
