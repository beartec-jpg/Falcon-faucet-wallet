import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { configureFalconWasmPath } from '@/lib/falcon-wasm'
import App from './App'
import './index.css'

// Offline PWA scope: WASM must live under /cold-signer/wasm/
configureFalconWasmPath(`${import.meta.env.BASE_URL}wasm/falcon-512.min.js`)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
