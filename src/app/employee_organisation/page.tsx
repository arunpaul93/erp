"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'

interface EmployeeOverview {
    employee_organisation_id?: string | null
    employee_name?: string | null
    organisation_name?: string | null
    leave_balances?: any[] | null
    pay_templates?: any[] | null
    // allow other view fields
    [key: string]: any
}

export default function EmployeeOrganisationPage() {
    const router = useRouter()
    const { user, loading: authLoading } = useAuth()

    const [rows, setRows] = useState<EmployeeOverview[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [selected, setSelected] = useState<EmployeeOverview | null>(null)

    useEffect(() => {
        if (!authLoading && !user) router.push('/login')
    }, [authLoading, user, router])

    useEffect(() => {
        fetchRows()
    }, [])

    const fetchRows = async () => {
        setLoading(true)
        setError(null)
        try {
            // Use the read-only view `employee_overview` which contains joined/enriched data
            const { data, error } = await supabase
                .from('employee_overview')
                .select('*')

            if (error) throw error
            setRows(data || [])

            // Debug: log first row keys to console for inspection
            // no debug output
        } catch (err: any) {
            setError(err.message || 'Failed to load records')
        } finally {
            setLoading(false)
        }
    }

    if (authLoading) return null

    return (
        <div className="min-h-screen bg-gray-950">
            <nav className="bg-gray-900 shadow">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16 items-center">
                        <div className="text-yellow-400 font-semibold">Employees</div>
                        <div>
                            <button onClick={() => router.push('/home')} className="text-yellow-400 text-sm">← Back</button>
                        </div>
                    </div>
                </div>
            </nav>

            <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
                <div className="px-4 sm:px-0">
                    <div className="mb-4 flex items-center justify-between">
                        <h1 className="text-2xl font-bold text-white">Employee Organisations</h1>
                        <div className="text-sm text-gray-400">{rows.length} records</div>
                    </div>

                    {error && <div className="mb-4 text-sm text-red-400">{error}</div>}

                    {loading ? (
                        <div className="text-gray-300">Loading...</div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {rows.map((r, idx) => {
                                const keyId = r.employee_organisation_id ?? r.id ?? `${r.employee_name ?? 'emp'}-${idx}`
                                return (
                                    <div
                                        key={keyId}
                                        className="p-4 border border-gray-800 rounded-lg bg-gray-900/60 cursor-pointer hover:border-yellow-400"
                                        onClick={() => setSelected(r)}
                                    >
                                        <div className="text-sm text-gray-200 font-medium">{r.employee_name ?? 'No name'}</div>
                                        {r.employee_email && <div className="text-xs text-gray-400">{r.employee_email}</div>}
                                        <div className="text-xs text-gray-400">Org: {r.organisation_name ?? 'No organisation'}</div>
                                        {r.role && <div className="text-xs text-gray-400">Role: {r.role}</div>}
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {/* debug removed */}

                    {/* Details drawer */}
                    {selected && (
                        <div className="fixed right-6 top-16 w-96 bg-gray-900 border border-gray-800 rounded-lg p-4 z-50">
                            <div className="flex justify-between items-start">
                                <h3 className="text-lg font-medium text-white">Details</h3>
                                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-200">✕</button>
                            </div>
                            <div className="mt-3 text-sm text-gray-300">
                                <p><strong>Name:</strong> {selected.employee_name ?? '—'}</p>
                                {selected.employee_email && <p><strong>Email:</strong> {selected.employee_email}</p>}
                                <p><strong>Organisation:</strong> {selected.organisation_name ?? '—'}</p>
                                {selected.role && <p><strong>Role:</strong> {selected.role}</p>}
                                {selected.phone && <p><strong>Phone:</strong> {selected.phone}</p>}
                                {selected.start_date && <p><strong>Start:</strong> {selected.start_date}</p>}
                                {selected.end_date && <p><strong>End:</strong> {selected.end_date}</p>}
                                {/* Display arrays if present */}
                                {selected.leave_balances && (
                                    <p><strong>Leave balances:</strong> {Array.isArray(selected.leave_balances) ? selected.leave_balances.length : String(selected.leave_balances)}</p>
                                )}
                                {selected.pay_templates && (
                                    <p><strong>Pay templates:</strong> {Array.isArray(selected.pay_templates) ? selected.pay_templates.length : String(selected.pay_templates)}</p>
                                )}
                            </div>
                            <div className="mt-4 flex gap-2 justify-end">
                                <button onClick={() => setSelected(null)} className="px-3 py-1 bg-gray-700 rounded text-sm">Close</button>
                                <button onClick={() => router.push(`/employee_organisation/${selected.employee_organisation_id ?? selected.id ?? ''}`)} className="px-3 py-1 bg-yellow-500 text-black rounded text-sm">Open full</button>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    )
}
