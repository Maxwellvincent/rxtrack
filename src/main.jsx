import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import ShellRoot from './ShellRoot.jsx'

// Which shell boots is decided in ShellRoot: query-param → remote flag →
// local flag → default. See src/shell/shellSelection.js.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ShellRoot />
  </StrictMode>
)
