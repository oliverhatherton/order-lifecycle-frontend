import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { ErrorBanner } from '../components/ErrorBanner.jsx'
import { CenterLoading } from '../components/CenterLoading.jsx'
import { EmptyState, PageHeader } from '../components/Panel.jsx'
import { StatusBadge } from '../components/StatusBadge.jsx'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toISOString().slice(0, 10)
}

const TABS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'disabled', label: 'Disabled', match: (u) => u.disabled },
  { key: 'admins', label: 'Admins', match: (u) => u.role === 'ADMIN' },
]

export function Admin() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pendingId, setPendingId] = useState(null)
  const [tab, setTab] = useState('all')

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

  const counts = Object.fromEntries(TABS.map((t) => [t.key, users.filter(t.match).length]))
  const visible = users.filter(TABS.find((t) => t.key === tab).match)
  const synthetic = users.filter((u) => u.email?.endsWith('@synthetic.example')).length

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={loading ? 'Loading…' : `${users.length} accounts · ${counts.disabled} disabled${synthetic ? ` · ${synthetic} synthetic` : ''}`}
      />

      <ErrorBanner error={error} />

      {loading ? (
        <CenterLoading />
      ) : users.length === 0 ? (
        <EmptyState>No accounts yet.</EmptyState>
      ) : (
        <>
          <Tabs value={tab} onValueChange={setTab} className="mb-4">
            <TabsList variant="line" className="w-full justify-start gap-5 border-b border-border px-0">
              {TABS.map((t) => (
                <TabsTrigger key={t.key} value={t.key} className="flex-none px-0">
                  {t.label}
                  <span className="text-xs text-muted-foreground tabular">{counts[t.key]}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {visible.length === 0 ? (
            <EmptyState>No accounts in this view.</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[44%] pl-0 text-xs font-normal text-muted-foreground">Email</TableHead>
                  <TableHead className="text-xs font-normal text-muted-foreground">Role</TableHead>
                  <TableHead className="text-xs font-normal text-muted-foreground">Access</TableHead>
                  <TableHead className="text-right text-xs font-normal text-muted-foreground max-sm:hidden">Joined</TableHead>
                  <TableHead className="pr-0">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((user) => (
                  <TableRow key={user.id} className="border-border/60">
                    <TableCell className="max-w-72 truncate py-3 pl-0">{user.email}</TableCell>
                    <TableCell>{user.role === 'ADMIN' ? 'Admin' : 'Shopper'}</TableCell>
                    <TableCell>
                      <StatusBadge tone={user.disabled ? 'negative' : 'positive'}>{user.disabled ? 'Disabled' : 'Active'}</StatusBadge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular max-sm:hidden">{formatDate(user.createdAt)}</TableCell>
                    <TableCell className="pr-0 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={user.disabled ? '' : 'text-negative hover:text-negative'}
                        disabled={pendingId === user.id}
                        onClick={() => toggle(user)}
                      >
                        {pendingId === user.id ? 'Saving…' : user.disabled ? 'Enable' : 'Disable'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  )
}
