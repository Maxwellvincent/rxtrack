import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { installChunkLoadRecovery } from './shell/chunkLoadRecovery.js'

// An already-open tab can outlive a deployment and request a lazy chunk that
// is no longer on the active alias. Reload once to pick up the current index;
// a session-storage guard prevents a reload loop if the asset is still absent.
installChunkLoadRecovery()

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
