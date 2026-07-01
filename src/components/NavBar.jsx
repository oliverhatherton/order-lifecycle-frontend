import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/useAuth.js'

export function NavBar() {
  const { isAuthenticated, isAdmin, user, logout } = useAuth()

  return (
    <header className="top-nav">
      <NavLink to="/" className="brand" end>
        <span className="dot" />
        Order Lifecycle
      </NavLink>
      <nav>
        <NavLink to="/orders" className={({ isActive }) => (isActive ? 'active' : '')}>
          Orders
        </NavLink>
        {isAdmin && (
          <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}>
            Admin
          </NavLink>
        )}
        <NavLink to="/metrics" className={({ isActive }) => (isActive ? 'active' : '')}>
          Metrics
        </NavLink>
      </nav>
      <div className="spacer" />
      {isAuthenticated ? (
        <div className="user-chip">
          <span className="mono" title={user?.userId}>
            {user?.userId?.slice(0, 8)}
          </span>
          <span className={`badge ${isAdmin ? 'admin' : 'user'}`}>{user?.role}</span>
          <button type="button" className="btn small" onClick={logout}>
            Log out
          </button>
        </div>
      ) : (
        <div className="user-chip">
          <NavLink to="/login" className="nav-link">
            Log in
          </NavLink>
          <NavLink to="/register" className="btn small primary" style={{ textDecoration: 'none' }}>
            Sign up
          </NavLink>
        </div>
      )}
    </header>
  )
}
