import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError, subscribeToken, getAccessToken } from './api.js'
import { AuthContext } from './authContextObject.js'

// 'loading' while we attempt a silent refresh on first load (the refresh
// cookie may still be valid from a previous visit), then 'authenticated' or
// 'anonymous'.
export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading')
  const [user, setUser] = useState(null)
  // True when the silent refresh-on-load failed at the network/CORS level
  // rather than with a real 401 — looks identical to "logged out" to the
  // user, but the fix is connectivity/CORS, not logging back in, so it's
  // worth telling apart.
  const [sessionCheckError, setSessionCheckError] = useState(false)

  const loadMe = useCallback(async () => {
    const { data } = await api.me()
    setUser(data)
    setStatus('authenticated')
  }, [])

  const checkSession = useCallback(async () => {
    setSessionCheckError(false)
    try {
      await api.refresh()
      await loadMe()
    } catch (err) {
      setStatus('anonymous')
      setUser(null)
      if (!(err instanceof ApiError)) setSessionCheckError(true)
    }
  }, [loadMe])

  useEffect(() => {
    // checkSession's state updates happen after its internal awaits, not
    // synchronously here — same fetch-in-effect shape as useMetricsPoller's
    // fetchOnce() and useMetricHistory's load().
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkSession()
  }, [checkSession])

  // If something elsewhere clears the token (e.g. a failed background
  // refresh), drop the local session so guards react immediately.
  useEffect(() => {
    return subscribeToken((token) => {
      if (!token && getAccessToken() === null) {
        setUser((prev) => (prev ? null : prev))
        setStatus((prev) => (prev === 'authenticated' ? 'anonymous' : prev))
      }
    })
  }, [])

  const login = useCallback(async (email, password) => {
    await api.login(email, password)
    await loadMe()
  }, [loadMe])

  const register = useCallback(async (email, password) => {
    const { data } = await api.register(email, password)
    return data
  }, [])

  const logout = useCallback(() => {
    api.logout()
    setUser(null)
    setStatus('anonymous')
  }, [])

  const value = useMemo(
    () => ({
      status,
      user,
      isAuthenticated: status === 'authenticated',
      isAdmin: user?.role === 'ADMIN',
      sessionCheckError,
      retrySessionCheck: checkSession,
      login,
      register,
      logout,
    }),
    [status, user, sessionCheckError, checkSession, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
