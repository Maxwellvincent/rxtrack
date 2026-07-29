import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// One shell. The boot-time selector (ShellRoot + shell/shellSelection.js) existed
// to keep App.jsx reachable behind ?shell=old during SP1 T6.1. App.jsx is gone,
// so there is nothing left to select between.
const Shell = lazy(() => import('./shell/Shell.jsx'))

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Shell />
    </Suspense>
  </StrictMode>
)
