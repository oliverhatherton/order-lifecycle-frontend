import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell.jsx'
import { AdminRoute } from './components/RouteGuards.jsx'
import { BackendStatusPill } from './components/BackendStatusPill.jsx'
import { Home } from './routes/Home.jsx'
import { Login } from './routes/Login.jsx'
import { Register } from './routes/Register.jsx'
import { Orders } from './routes/Orders.jsx'
import { Shop } from './routes/Shop.jsx'
import { Admin } from './routes/Admin.jsx'
import { Metrics } from './routes/Metrics.jsx'

// Home is a page (read and scrolled), so it brings its own board layout;
// every other route is an app screen inside the framed sheet. The backend
// status pill floats over both.
function App() {
  return (
    <>
      <BackendStatusPill />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="*"
          element={
            <AppShell>
              <Routes>
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
            </AppShell>
          }
        />
      </Routes>
    </>
  )
}

export default App
