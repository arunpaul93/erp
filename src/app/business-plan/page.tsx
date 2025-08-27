'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'

interface BusinessPlan {
    id: string
    name: string | null
    problem?: string | null
    organisation_id: string
    created_at?: string
    deleted_on?: string | null
}

export default function BusinessPlanPage() {
    const router = useRouter()
    const { user, loading: authLoading } = useAuth()
    const { selectedOrgId, orgs, loading: orgLoading } = useOrg()
    const [items, setItems] = useState<BusinessPlan[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [pendingDelete, setPendingDelete] = useState<BusinessPlan | null>(null)
    const [deleting, setDeleting] = useState(false)
    const [deleteError, setDeleteError] = useState<string | null>(null)

    const orgName = useMemo(() => orgs.find(o => o.id === selectedOrgId)?.name ?? '—', [orgs, selectedOrgId])

    useEffect(() => {
        if (!authLoading && !user) router.push('/login')
    }, [authLoading, user, router])

    useEffect(() => {
        const fetchData = async () => {
            if (!selectedOrgId) return
            setLoading(true)
            setError(null)

            const { data, error } = await supabase
                .from('business_plan')
                .select('id, name, problem, organisation_id, created_at, deleted_on')
                .eq('organisation_id', selectedOrgId)
                .is('deleted_on', null)
                .order('created_at', { ascending: false })

            if (error) {
                setError(error.message)
                setItems([])
            } else {
                setItems((data ?? []).map(r => ({
                    id: String((r as any).id),
                    name: (r as any).name ?? null,
                    problem: (r as any).problem ?? null,
                    organisation_id: String((r as any).organisation_id),
                    created_at: (r as any).created_at ?? undefined,
                    deleted_on: (r as any).deleted_on ?? null,
                })))
            }

            setLoading(false)
        }

        fetchData()
    }, [selectedOrgId])

    if (authLoading || orgLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-950">
                <div className="text-lg text-gray-100">Loading...</div>
            </div>
        )
    }

    if (!user) return null

    return (
        <div className="min-h-screen bg-gray-950">
            <nav className="bg-gray-900 shadow">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16">
                        <div className="flex items-center">
                            <button onClick={() => router.push('/home')} className="text-yellow-400 hover:text-yellow-300 text-sm">← Back</button>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-gray-300">{user.email}</span>
                        </div>
                    </div>
                </div>
            </nav>

            <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
                <div className="px-4 sm:px-0">
                    <div className="mb-6 flex items-center justify-between">
                        <div>
                            <h2 className="text-2xl font-bold text-yellow-400">Business Plan</h2>
                            <p className="text-sm text-gray-400 mt-1">Organisation: {orgName}</p>
                        </div>
                        <div>
                            <button
                                onClick={() => router.push('/business-plan/new')}
                                disabled={!selectedOrgId}
                                className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-gray-900 px-4 py-2 rounded-md text-sm font-medium"
                            >
                                Add Business Plan
                            </button>
                        </div>
                    </div>

                    <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
                        {!selectedOrgId ? (
                            <div className="text-gray-400 text-sm">Select an organisation to view business plans.</div>
                        ) : (
                            <>
                                {error && (
                                    <div className="mb-3 text-sm text-red-400">{error}</div>
                                )}

                                {loading ? (
                                    <div className="text-gray-300">Loading business plans…</div>
                                ) : items.length === 0 ? (
                                    <div className="text-gray-400 text-sm">No business plans yet.</div>
                                ) : (
                                    <ul className="space-y-3">
                                        {items.map(item => (
                                            <li
                                                key={item.id}
                                                className="p-4 flex items-start justify-between gap-6 hover:bg-gray-800/50 transition-colors cursor-pointer rounded-lg border border-gray-800 bg-gray-900/60"
                                                onClick={() => router.push(`/business-plan/${item.id}`)}
                                            >
                                                <div className="flex-1">
                                                    <div className="text-gray-100 font-medium">{item.name || 'Untitled'}</div>
                                                    {item.problem && (
                                                        <div className="text-gray-400 text-sm mt-0.5 line-clamp-2">{item.problem}</div>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        className="text-yellow-300 hover:text-yellow-200 text-xs border border-yellow-400/40 hover:border-yellow-400 px-2 py-1 rounded"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            router.push(`/business-plan/${item.id}/budgets`)
                                                        }}
                                                    >
                                                        Manage budgets
                                                    </button>
                                                    {item.created_at && (
                                                        <span className="text-[10px] px-2 py-1 rounded bg-gray-800 text-gray-400 border border-gray-700">
                                                            Created on {new Date(item.created_at).toLocaleDateString()}
                                                        </span>
                                                    )}
                                                    <button
                                                        className="text-red-300 hover:text-red-200 text-xs border border-red-400/40 hover:border-red-400 px-2 py-1 rounded"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            setPendingDelete(item)
                                                            setDeleteError(null)
                                                            setShowDeleteModal(true)
                                                        }}
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </main>
            {/* Delete Confirmation Modal */}
            {showDeleteModal && pendingDelete && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/60" onClick={() => !deleting && setShowDeleteModal(false)} />
                    <div className="relative z-10 w-full max-w-sm rounded-lg border border-gray-800 bg-gray-900 p-5 shadow-xl">
                        <h3 className="text-lg font-semibold text-gray-100">Delete business plan?</h3>
                        <p className="mt-2 text-sm text-gray-400">
                            This will mark "{pendingDelete.name || 'Untitled'}" as deleted.
                        </p>
                        {deleteError && (
                            <div className="mt-3 text-sm text-red-400">{deleteError}</div>
                        )}
                        <div className="mt-5 flex justify-end gap-3">
                            <button
                                className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 px-4 py-2 rounded-md text-sm"
                                onClick={() => setShowDeleteModal(false)}
                                disabled={deleting}
                            >
                                Cancel
                            </button>
                            <button
                                className="bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white px-4 py-2 rounded-md text-sm"
                                onClick={async () => {
                                    if (!selectedOrgId || !pendingDelete) return
                                    setDeleting(true)
                                    setDeleteError(null)
                                    const { error } = await supabase
                                        .from('business_plan')
                                        .update({ deleted_on: new Date().toISOString() })
                                        .eq('id', pendingDelete.id)
                                        .eq('organisation_id', selectedOrgId)
                                    if (error) {
                                        setDeleteError(error.message)
                                        setDeleting(false)
                                        return
                                    }
                                    // Optimistic remove from list
                                    setItems((prev) => prev.filter(i => i.id !== pendingDelete.id))
                                    setDeleting(false)
                                    setShowDeleteModal(false)
                                    setPendingDelete(null)
                                }}
                                disabled={deleting}
                            >
                                {deleting ? 'Deleting…' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
