'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'

export default function HomePage() {
  const { user, loading, signOut } = useAuth()
  const router = useRouter()

  const cards = [
    { title: 'Business Plan', desc: 'Strategic goals and initiatives.', path: '/business-plan' },
    { title: 'Permissions', desc: 'Manage user roles and permissions.', path: '/permissions' },
  { title: 'Employees', desc: 'Manage employees and assignments.', path: '/employee_organisation' },
    { title: 'Sales', desc: 'Track orders, invoices, and revenue.' },
    { title: 'Inventory', desc: 'Manage stock levels and products.' },
    { title: 'Purchases', desc: 'Vendors, POs, and bills.' },
    { title: 'HR', desc: 'Employees, leave, and payroll.' },
    { title: 'Analytics', desc: 'KPIs and dashboards.' },
    { title: 'Settings', desc: 'Company, roles, and permissions.' },
  ]

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login')
    }
  }, [user, loading, router])

  const handleSignOut = async () => {
    await signOut()
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="text-lg text-gray-100">Loading...</div>
      </div>
    )
  }

  if (!user) {
    return null // Will redirect to login
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <nav className="bg-gray-900 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-yellow-400">
                ⚡ Minnal
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-300">
                {user.email}
              </span>
              <div className="flex items-center gap-3">
                {/* Org selector will be inserted here */}
                <OrgSelector />
                <button
                  onClick={handleSignOut}
                  className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 px-4 py-2 rounded-md text-sm font-medium"
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 sm:px-0">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-yellow-400">Dashboard</h2>
              <p className="text-sm text-gray-400 mt-1">Welcome, {user.email}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {cards.map((c) => {
              const path = (c as any).path
              const clickable = Boolean(path)
              return (
                <div
                  key={c.title}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={() => clickable && router.push(path)}
                  onKeyDown={(e) => clickable && (e.key === 'Enter' || e.key === ' ') && router.push(path)}
                  className={`group rounded-xl border border-gray-800 bg-gray-900/80 backdrop-blur-sm p-5 hover:border-yellow-400 transition-colors ${clickable ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-yellow-400' : ''}`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <span className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-yellow-500/10 text-yellow-400">
                      ⚡
                    </span>
                    <h3 className="text-lg font-semibold text-gray-100">{c.title}</h3>
                  </div>
                  <p className="text-sm text-gray-400">{c.desc}</p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      clickable && router.push(path)
                    }}
                    aria-label={clickable ? `Open ${c.title}` : `${c.title} not available`}
                    className="mt-4 inline-flex items-center justify-center text-yellow-400 text-sm hover:text-yellow-300 disabled:opacity-50 w-8 h-8 rounded-full"
                    disabled={!clickable}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </main>
    </div>
  )
}

function OrgSelector() {
  const { orgs, selectedOrgId, setSelectedOrgId, loading } = useOrg()

  if (loading) return <div className="text-sm text-gray-400">Loading orgs...</div>
  if (!orgs || orgs.length === 0) return <div className="text-sm text-gray-400">No orgs</div>

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-400">Organization:</span>
      <select
        value={selectedOrgId ?? ''}
        onChange={(e) => setSelectedOrgId(e.target.value ?? null)}
        className="bg-gray-800 text-gray-200 border border-gray-600 hover:border-yellow-400 focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 px-3 py-1.5 rounded-md text-sm font-medium min-w-[150px]"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id} className="bg-gray-800 text-gray-200">{o.name}</option>
        ))}
      </select>
    </div>
  )
}
