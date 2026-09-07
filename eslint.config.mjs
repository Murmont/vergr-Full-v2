// Deliberately MINIMAL. This config exists for ONE reason: a green `vite build`
// proves the syntax parsed, never that the identifiers resolve. Four separate
// runtime crashes shipped in one session (2026-08-27) from a missing import
// that the bundler happily compiled:
//
//   canUseAnimatedAvatar / compressVideo / useRef / rankStreams  -> no-undef
//   an unimported <Component />                                  -> react/jsx-no-undef
//
// A fifth class is in CLAUDE.md: useEffectEnabled placed BELOW an early return
// changed the hook count between renders, React threw #310 and the profile went
// to ErrorBoundary. That is react-hooks/rules-of-hooks.
//
// So exactly three rules are on, and every one of them catches a CRASH. Do NOT
// turn this into a style linter: every rule added here is a rule someone has to
// satisfy on every future edit, and the project has no appetite for that.
// exhaustive-deps is deliberately OFF for that reason (it is a judgement call,
// not a defect). Add a rule only when a BUG got through, the way these did.
import { readFileSync } from 'node:fs';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

// Read the compile-time flags out of vite.config.js rather than restating them,
// so adding a define there can never leave this config stale. Same reason the
// VP guards read the real tables instead of holding a copy.
const viteDefines = Object.fromEntries(
  [...readFileSync('vite.config.js', 'utf8').matchAll(/^\s*(__VERGR_[A-Z0-9_]+__)\s*:/gm)]
    .map((m) => [m[1], 'readonly']),
);
if (Object.keys(viteDefines).length === 0) {
  throw new Error('eslint.config.mjs: found no __VERGR_*__ defines in vite.config.js. The extractor drifted, fix it rather than dropping the globals.');
}

const crashRules = {
  'no-undef': 'error',
  'react/jsx-no-undef': 'error',
  'react-hooks/rules-of-hooks': 'error',
};

export default [
  {
    ignores: [
      'dist/**', 'node_modules/**', 'src-tauri/**', 'infra/**', 'vlink/**',
      'android/**', 'functions/node_modules/**', 'chat-pattern-tiles/**',
      'public/**', 'docs/**', '**/*.min.js',
      // Gitignored scratch: the measuring harnesses that render a component in
      // isolation and screenshot it. A half-written probe in there stopped a
      // production build once, which is the wrong thing to be able to happen.
      '.preview/**',
    ],
  },
  // Pre-existing `eslint-disable` comments all over the repo were written for a
  // linter that was never installed. They are noise, not findings.
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  // Browser app code.
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021, ...viteDefines },
    },
    rules: { ...crashRules, 'react-hooks/exhaustive-deps': 'off' },
  },
  // Cloud Functions: CommonJS, node globals.
  {
    files: ['functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.es2021 },
    },
    rules: { 'no-undef': 'error' },
  },
  // Build + guard scripts: ESM. These run in node BUT hold browser code inside
  // page.evaluate() callbacks that puppeteer serialises into Chrome, so both
  // global sets are legitimately in scope in one file.
  {
    files: ['scripts/**/*.mjs', '*.config.js', '*.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, ...globals.es2021 },
    },
    rules: { 'no-undef': 'error' },
  },
  // One-off CommonJS scripts sitting at the repo root.
  {
    files: ['seed-firestore.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.es2021 },
    },
    rules: { 'no-undef': 'error' },
  },
];
