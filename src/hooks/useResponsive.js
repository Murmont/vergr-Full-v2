import { useState, useEffect } from 'react';
import { IS_NATIVE_BUILD } from '../utils/platform';

const BREAKPOINTS = {
  mobile: 0,
  tablet: 768,
  desktop: 1024,
  wide: 1440,
};

// Native app (Option B build): the Android System WebView reports an inflated
// layout width (~980px), so a real phone is misclassified as tablet/desktop
// (isMobile false, isDesktop false) — which hides mobile headers/FABs and
// triggers desktop branches. The native shell is ALWAYS a phone, so force the
// mobile tier. This is a build-time constant (dead-code-eliminated on web), not
// a runtime width check. CSS breakpoints (Tailwind sm:/md:/lg:) are separate —
// those still need native-specific layouts where they create multi-column.
const NATIVE_RESULT = { width: 390, isMobile: true, isTablet: false, isDesktop: false, isWide: false };

export default function useResponsive() {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 0);

  useEffect(() => {
    if (IS_NATIVE_BUILD) return;
    let raf;
    const handleResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setWidth(window.innerWidth));
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(raf);
    };
  }, []);

  if (IS_NATIVE_BUILD) return NATIVE_RESULT;

  return {
    width,
    isMobile: width < BREAKPOINTS.tablet,
    isTablet: width >= BREAKPOINTS.tablet && width < BREAKPOINTS.desktop,
    isDesktop: width >= BREAKPOINTS.desktop,
    isWide: width >= BREAKPOINTS.wide,
  };
}
