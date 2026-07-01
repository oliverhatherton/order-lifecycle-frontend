import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { ErrorBanner } from '../components/ErrorBanner.jsx'
import { CenterLoading } from '../components/CenterLoading.jsx'

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

export function Admin() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pendingId, setPendingId] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.listUsers()
        if (!cancelled) setUsers(data ?? [])
      } catch (err) {
        if (!cancelled) setError(err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function toggle(user) {
    setPendingId(user.id)
    setError(null)
    try {
      const { data } = user.disabled ? await api.enableUser(user.id) : await api.disableUser(user.id)
      setUsers((prev) => prev.map((u) => (u.id === data.id ? data : u)))
    } catch (err) {
      setError(err)
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Admin — Users</h1>
          <p className="subtitle">Disable or re-enable accounts. A disabled user cannot log in or refresh their session.</p>
        </div>
      </div>

      <ErrorBanner error={error} />

      {loading ? (
        <CenterLoading />
      ) : users.length === 0 ? (
        <div className="empty-state">No users found.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.email}</td>
                  <td>
                    <span className={`badge ${user.role === 'ADMIN' ? 'admin' : 'user'}`}>{user.role}</span>
                  </td>
                  <td>
                    <span className={`badge ${user.disabled ? 'disabled' : 'enabled'}`}>
                      {user.disabled ? 'Disabled' : 'Enabled'}
                    </span>
                  </td>
                  <td>{formatDate(user.createdAt)}</td>
                  <td>
                    <button
                      type="button"
                      className={`btn small ${user.disabled ? '' : 'danger'}`}
                      disabled={pendingId === user.id}
                      onClick={() => toggle(user)}
                    >
                      {pendingId === user.id ? '…' : user.disabled ? 'Enable' : 'Disable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
