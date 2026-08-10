/** @type {import('tailwindcss').Config} */
//
// VERGR design tokens — single source of truth.
// Touching these here cascades to every Tailwind class across the app.
//
// Token map (after the global redesign):
//   bg-dark        →  page background
//   surface-1      →  primary card / panel surface
//   surface-2      →  elevated surface (card-hover, sub-panels)
//   surface-3      →  highest elevation, also used as divider on dark bg
//   border-accent  →  subtle divider line
//   text-primary   →  pure white headings + numbers
//   text-secondary →  dim grey body text
//   text-muted     →  muted grey labels / captions
//
// Brand palette (matches Claude Design wallet/profile mocks):
//   brand-violet         #7B1FFF   →  primary brand, active states
//   brand-violet-light   #B44FFF   →  light violet for accents/hover/badges
//   brand-cyan           DEPRECATED — aliased to brand-violet-light. Teal is not a
//                        brand colour. Kept only so any missed usage renders violet
//                        instead of teal. Do not use in new code.
//   brand-pink           #C87FFF   →  highlight / mixed gradients
//   brand-gold           #F0A500   →  coins / earnings
//   brand-gold-light     #F5C842   →  bright coin accents (numbers, glow)
//   brand-ember          #F04060   →  destructive / live red
//   gem-blue             #3D7FFF   →  gems (NEW — never the same as brand-cyan)
//   success-green        #22D17E   →  online dot, success state, gain
//
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  safelist: [
    'w-[340px]',
  ],
  theme: {
    extend: {
      colors: {
        // ── Brand ──
        'brand-cyan':         '#B44FFF', // deprecated alias, see note above
        'brand-violet':       '#7B1FFF',
        'brand-violet-light': '#B44FFF',
        'brand-pink':         '#C87FFF',
        'brand-gold':         '#F0A500',
        'brand-gold-light':   '#F5C842',
        'brand-ember':        '#F04060',
        'gem-blue':           '#3D7FFF',
        'success-green':      '#22D17E',

        // ── Surfaces ──
        'bg-dark':       '#0B0B14',
        'surface-1':     '#14141F',
        'surface-2':     '#1A1A2A',
        'surface-3':     '#1E1E2E',
        'border-accent': '#2A2A3E',

        // ── Legacy auth/onboarding design-kit aliases ──
        // These screens were authored against `bg-surface`, `border-surface-border`
        // and `primary`, which never existed in this config — inputs rendered
        // white (white-on-white text) and accents lost their colour. Define them
        // so the whole kit themes correctly instead of patching each file.
        'surface':        '#1A1A2A',
        'surface-border': '#2A2A3E',
        'primary':        '#7B1FFF',

        // ── Text ──
        // Secondary/muted brightened 2026-07-07 (founder: dim grey body text was
        // hard to read on every screen). Kept below white so hierarchy holds.
        'text-primary':   '#FFFFFF',
        'text-secondary': '#C9CFDA',
        'text-muted':     '#9AA2B1',

        // ── Social ──
        'discord': '#5865F2',
        'twitch':  '#9146FF',
        'youtube': '#FF0000',
        'steam':   '#1B2838',
      },
      fontFamily: {
        syne:   ['Syne', 'sans-serif'],
        dmsans: ['DM Sans', 'sans-serif'],
        dmmono: ['DM Mono', 'monospace'],
      },
      backgroundImage: {
        // Gradients used throughout the app — adjusted to match the new violet-forward palette.
        'brand-gradient':   'linear-gradient(135deg, #B44FFF 0%, #7B1FFF 50%, #C87FFF 100%)',
        'cta-gradient':     'linear-gradient(135deg, #6D28D9 0%, #7C3AED 100%)',  // primary buttons (Go Live etc.)
        'gold-gradient':    'linear-gradient(135deg, #F5C842 0%, #F0A500 100%)',
        'ember-gradient':   'linear-gradient(135deg, #F04060 0%, #FF2D55 100%)',
        'gem-gradient':     'linear-gradient(135deg, #3D7FFF 0%, #1E40AF 100%)',
        'dark-gradient':    'linear-gradient(180deg, #0B0B14 0%, #14141F 100%)',
        'card-gradient':    'linear-gradient(135deg, rgba(123,31,255,0.08) 0%, rgba(180,79,255,0.06) 100%)',
        'banner-gradient':  'linear-gradient(135deg, #0d0820 0%, #1a0a3a 30%, #2d0a5a 60%, #1a0a30 100%)',
        'holographic':      'linear-gradient(135deg, #B44FFF 0%, #7B1FFF 25%, #C87FFF 50%, #F5C842 75%, #B44FFF 100%)',
      },
      borderRadius: { custom: '14px' },
      animation: {
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'slide-up':   'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'fade-in':    'fadeIn 0.3s ease-out',
        'spin-slow':  'spin 3s linear infinite',
        'shimmer':    'shimmer 2s linear infinite',
        'float':      'float 3s ease-in-out infinite',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(123,31,255,0.18)' },
          '50%':      { boxShadow: '0 0 40px rgba(180,79,255,0.32)' },
        },
        slideUp:   { '0%': { transform: 'translateY(20px)',  opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        slideDown: { '0%': { transform: 'translateY(-20px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        fadeIn:    { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        shimmer:   { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        float:     { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
      },
    },
  },
  plugins: [],
};
