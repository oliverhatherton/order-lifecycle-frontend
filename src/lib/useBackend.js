import { useContext } from 'react'
import { BackendStatusContext } from './backendStatusContextObject.js'

/** The shared backend status: { status: 'checking' | 'waking' | 'up' | 'down', since, upAt }. */
export function useBackend() {
  const ctx = useContext(BackendStatusContext)
  if (!ctx) throw new Error('useBackend must be used within BackendStatusProvider')
  return ctx
}
