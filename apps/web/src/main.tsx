import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Initialize configuration and debug utilities
import { validateConfig } from './lib/config'
import { logEnvironmentInfo, checkEnvironmentVariables } from './lib/debug'

// Validate configuration on startup
try {
  validateConfig()
  logEnvironmentInfo()
  checkEnvironmentVariables()
} catch (error) {
  // Only log detailed errors in development
  if (import.meta.env.DEV) {
    console.error('Configuration validation failed:', error)
  }
  
  // In production, show a user-friendly error page
  if (import.meta.env.PROD) {
    document.body.innerHTML = `
      <div style="display: flex; justify-content: center; align-items: center; height: 100vh; font-family: system-ui;">
        <div style="text-align: center; padding: 2rem;">
          <h1 style="color: #dc2626; margin-bottom: 1rem;">Configuration Error</h1>
          <p style="color: #6b7280;">The application is not properly configured. Please contact your administrator.</p>
        </div>
      </div>
    `
    throw error
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)