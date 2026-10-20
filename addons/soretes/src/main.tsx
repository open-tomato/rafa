import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import './app.css';

// `?timerloop` drives frames from a timer: a background tab never fires
// requestAnimationFrame, so a headless check of the animations needs this.
if (new URLSearchParams(location.search).has('timerloop')) {
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 16);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
