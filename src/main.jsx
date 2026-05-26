import React from 'react';
import ReactDOM from 'react-dom/client';
import AppRouter from './router/AppRouter';
import { runDesktopAutoUpdate } from './utils/tauriUpdater';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppRouter />
  </React.StrictMode>
);

// Desktop only: silently pull + apply the latest signed build on launch.
// No-op in the browser / PWA.
runDesktopAutoUpdate();