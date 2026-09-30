// Entry point for the Vergr Vanguard build ONLY (`npm run build:vanguard`).
//
// Deliberately minimal, like src/admin/main.jsx: no service worker, no OTA
// updater, no native share, no media cache, no telemetry, no splash. Those
// exist for the consumer app and none of them belong in a moderation tool.

import React from 'react';
import ReactDOM from 'react-dom/client';
import VanguardApp from './VanguardApp';
import '../index.css';

ReactDOM.createRoot(document.getElementById('vanguard-root')).render(
  <React.StrictMode>
    <VanguardApp />
  </React.StrictMode>,
);
