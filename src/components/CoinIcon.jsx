// Shared currency graphic components. Use these everywhere instead of
// <Icon name="paid"/>, <Icon name="diamond"/>, or inline SVGs. Source PNGs
// live in /public/brand/ — object-contain keeps them from squashing when
// the parent flex container shrinks them.

function makeIcon(src, alt) {
  return function CurrencyIcon({ size = 16, className = '', style }) {
    return (
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        className={`inline-block shrink-0 object-contain ${className}`}
        style={{ width: size, height: size, minWidth: size, minHeight: size, ...style }}
        draggable={false}
      />
    );
  };
}

export const CoinIcon = makeIcon('/brand/vc-coin.webp', 'VC coin');
export const VPIcon   = makeIcon('/brand/vp-gem.webp',  'VP');
export const GemIcon  = makeIcon('/brand/gems.webp',    'Gems');
