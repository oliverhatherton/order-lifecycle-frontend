import { BackendStatusContext } from './backendStatusContextObject.js'
import { useBackendStatus } from './useBackendStatus.js'

/** Runs the one /health poller the whole UI shares (the pill, the shell). */
export function BackendStatusProvider({ children }) {
  const status = useBackendStatus()
  return <BackendStatusContext.Provider value={status}>{children}</BackendStatusContext.Provider>
}
