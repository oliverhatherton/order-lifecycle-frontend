import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { BarChart3, BookOpen, House, Menu, Package, ShoppingCart, Users } from 'lucide-react'
import { useAuth } from '../lib/useAuth.js'
import { API_BASE } from '../lib/api.js'
import { Mark } from './Mark.jsx'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

const PAGE_NAMES = {
  '/shop': 'Shop',
  '/orders': 'Orders',
  '/metrics': 'Metrics',
  '/admin': 'Users',
  '/login': 'Log in',
  '/register': 'Create account',
}

function NavItem({ to, icon: Icon, children, end, external }) {
  const base =
    'flex h-8 items-center gap-2.5 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground max-md:h-11 max-md:text-base'
  if (external) {
    return (
      <a href={to} target="_blank" rel="noreferrer" className={base}>
        <Icon className="size-4" strokeWidth={1.5} />
        {children}
      </a>
    )
  }
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cn(base, isActive && 'bg-sidebar-accent font-medium text-foreground')}>
      <Icon className="size-4" strokeWidth={1.5} />
      {children}
    </NavLink>
  )
}

function SidebarBody() {
  const { isAuthenticated, isAdmin, user, logout } = useAuth()
  return (
    <div className="flex h-full flex-col gap-1 p-3">
      <Link to="/" className="mb-5 flex h-9 items-center gap-2.5 px-2 text-[15px] font-semibold text-foreground">
        <Mark size={20} />
        Order Lifecycle
      </Link>
      <nav className="flex flex-col gap-0.5" aria-label="Main">
        <NavItem to="/" end icon={House}>
          Home
        </NavItem>
        <NavItem to="/shop" icon={ShoppingCart}>
          Shop
        </NavItem>
        <NavItem to="/orders" icon={Package}>
          Orders
        </NavItem>
        <NavItem to="/metrics" icon={BarChart3}>
          Metrics
        </NavItem>
        {isAdmin && (
          <NavItem to="/admin" icon={Users}>
            Users
          </NavItem>
        )}
      </nav>
      <nav className="mt-6 flex flex-col gap-0.5" aria-label="Developer">
        <NavItem to={`${API_BASE}/docs`} icon={BookOpen} external>
          API docs
        </NavItem>
      </nav>
      <div className="mt-auto flex flex-col gap-2">
        {isAuthenticated ? (
          <>
            <div className="flex items-center gap-2.5 px-2 py-2">
              <span className="grid size-7 flex-none place-items-center rounded-full bg-info-bg text-xs font-semibold text-info" aria-hidden="true">
                {(user?.userId ?? '?').slice(0, 1).toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-col leading-4">
                <strong className="truncate font-mono text-[13px] font-medium" title={user?.userId}>
                  {user?.userId?.slice(0, 8)}
                </strong>
                <span className="text-xs text-muted-foreground">{user?.role === 'ADMIN' ? 'Admin' : 'Shopper'}</span>
              </span>
            </div>
            <Button variant="outline" onClick={logout}>
              Log out
            </Button>
          </>
        ) : (
          <>
            <Button asChild>
              <Link to="/register">Create account</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/login">Log in</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The frame: a labelled sidebar and a 48px top bar on one ground with no
 * rule between them, and the page on a sheet one lightness step up, inset 8px
 * from the right and bottom. On a phone the frame folds into the top bar and
 * the sidebar opens as a sheet.
 *
 * At 1440: sheet = 1440 − 228 − 8 = 1204; content = 1204 − 2×24 = 1156 =
 * 2/3 (762.7) + 24 + 1/3 (369.3).
 */
export function AppShell({ children }) {
  const { isAuthenticated, sessionCheckError, retrySessionCheck } = useAuth()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const pageName = PAGE_NAMES[location.pathname] ?? 'Order Lifecycle'

  return (
    <div className="grid min-h-svh grid-cols-1 grid-rows-[48px_1fr] md:grid-cols-[228px_minmax(0,1fr)]">
      <aside className="sticky top-0 row-span-2 hidden h-svh md:block" aria-label="Sidebar">
        <SidebarBody />
      </aside>

      <header className="flex min-w-0 items-center gap-3 pr-4 pl-2 md:pr-6 md:pl-6">
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-full bg-sidebar p-0 sm:max-w-full"
            onClick={(e) => e.target.closest('a') && setMenuOpen(false)}
          >
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SidebarBody />
          </SheetContent>
        </Sheet>
        <div className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
          <span className="max-sm:hidden">Order Lifecycle</span>
          <span aria-hidden="true" className="max-sm:hidden">
            /
          </span>
          <strong className="font-medium text-foreground">{pageName}</strong>
        </div>
        <div className="flex-1" />
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground max-sm:hidden">
          <span className={cn('size-1.5 rounded-full', sessionCheckError ? 'bg-faint' : 'bg-positive')} />
          {sessionCheckError ? 'API unreachable' : 'Live API'}
        </span>
        {!isAuthenticated && (
          <Button asChild size="sm" variant="outline">
            <Link to="/login">Log in</Link>
          </Button>
        )}
      </header>

      <div className="min-w-0 border-t border-border bg-sheet md:mr-2 md:mb-2 md:rounded-2xl md:border">
        {sessionCheckError && (
          <div className="m-4 mb-0 flex items-center gap-3 rounded-lg bg-negative-bg px-3.5 py-2.5 text-[13px] text-negative">
            Couldn't verify your session. Looks like a network or CORS problem.
            <Button size="sm" variant="outline" className="ml-auto" onClick={retrySessionCheck}>
              Retry
            </Button>
          </div>
        )}
        <main className="mx-auto max-w-[1440px] px-4 pt-5 pb-12 md:px-6 md:pt-6">{children}</main>
      </div>
    </div>
  )
}
