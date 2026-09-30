// Entry point for the Vergr Admin build ONLY (`npm run build:admin`).
//
// Deliberately minimal next to src/main.jsx: no service worker, no OTA updater,
// no native share, no media cache, no telemetry, no splash. Those exist for the
// consumer app and every one of them is a thing an admin console should not be
// doing.

import React from 'react';
import ReactDOM from 'react-dom/client';
import AdminApp from './AdminApp';
import '../index.css';

ReactDOM.createRoot(document.getElementById('admin-root')).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>,
);
