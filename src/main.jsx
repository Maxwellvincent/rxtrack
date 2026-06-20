import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

/** New shell is opt-in: ?shell=new in the URL or localStorage rxt-new-shell="1". */
function shellEnabled() {
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get('shell') === 'new') { localStorage.setItem('rxt-new-shell', '1'); return true; }
    if (p.get('shell') === 'old') { localStorage.removeItem('rxt-new-shell'); return false; }
    return localStorage.getItem('rxt-new-shell') === '1';
  } catch { return false; }
}

const root = createRoot(document.getElementById('root'));

if (shellEnabled()) {
  import('./shell/Shell.jsx').then(({ default: Shell }) => {
    root.render(<StrictMode><Shell /></StrictMode>);
  });
} else {
  import('./App.jsx').then(({ default: App }) => {
    root.render(<StrictMode><App /></StrictMode>);
  });
}
