import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, subscribeToken, getAccessToken } from './api.js'
import { AuthContext } from './authContextObject.js'

// 'loading' while we attempt a silent refresh on first load (the refresh
// cookie may still be valid from a previous visit), then 'authenticated' or
// 'anonymous'.
export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading')
  const [user, setUser] = useState(null)

  const loadMe = useCallback(async () => {
    const { data } = await api.me()
    setUser(data)
    setStatus('authenticated')
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await api.refresh()
        if (cancelled) return
        await loadMe()
      } catch {
        if (cancelled) return
        setStatus('anonymous')
        setUser(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadMe])

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
      login,
      register,
      logout,
    }),
    [status, user, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
