import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { NavBar } from './components/NavBar.jsx'
import { AdminRoute } from './components/RouteGuards.jsx'
import { Home } from './routes/Home.jsx'
import { Login } from './routes/Login.jsx'
import { Register } from './routes/Register.jsx'
import { Orders } from './routes/Orders.jsx'
import { Shop } from './routes/Shop.jsx'
import { Admin } from './routes/Admin.jsx'
import { Metrics } from './routes/Metrics.jsx'

function App() {
  const location = useLocation()
  const isWide = location.pathname === '/metrics'

  return (
    <div className="app-shell">
      <NavBar />
      <main className={`main-content${isWide ? ' wide' : ''}`}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/orders" element={<Orders />} />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <Admin />
              </AdminRoute>
            }
          />
          <Route path="/metrics" element={<Metrics />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="footer-note">
        Order Lifecycle demo ·{' '}
        <a href="https://api.oliverhatherton.com/order-lifecycle/docs" target="_blank" rel="noreferrer">
          API docs
        </a>
      </footer>
    </div>
  )
}

export default App
