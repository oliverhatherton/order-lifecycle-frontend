import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './lib/AuthContext.jsx'
import { TooltipProvider } from '@/components/ui/tooltip'
import { BackendStatusProvider } from './lib/BackendStatusProvider.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <BackendStatusProvider>
        <AuthProvider>
          <TooltipProvider delayDuration={150}>
            <App />
          </TooltipProvider>
        </AuthProvider>
      </BackendStatusProvider>
    </HashRouter>
  </StrictMode>,
)
