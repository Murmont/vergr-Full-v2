import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Detect Tauri dev mode
const isTauriDev = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  plugins: [react()],
  // For Tauri builds, use './' for file system access
  // For web builds, use '/' so assets are requested from the root path
  base: isTauriDev ? './' : '/',
  server: {
    port: 5173,
    host: true,
    strictPort: isTauriDev,
  },
  clearScreen: false,
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      // Tauri APIs are only present when the app runs inside the Tauri
      // shell. In the regular web build we don't ship them — the runtime
      // import in src/utils/gsiInstaller.js is wrapped in a try/catch.
      external: [/^@tauri-apps\//],
    },
  },
  resolve: { alias: { '@': '/src' } },
  envPrefix: ['VITE_', 'TAURI_'],
});
