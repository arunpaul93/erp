"use client"

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

export default function BudgetsForPlanPage() {
    const router = useRouter()
    const params = useParams() as { id?: string }
    const planId = params?.id
    const { user, loading: authLoading } = useAuth()
    const [budgets, setBudgets] = useState<Array<any>>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!authLoading && !user) router.push('/login')
    }, [authLoading, user, router])

    useEffect(() => {
        const fetchBudgets = async () => {
            if (!planId) return
            setLoading(true)
            const { data, error } = await supabase
                .from('budget')
                .select('id, name, period_start, period_end, created_at')
                .eq('business_plan_id', planId)
                .order('created_at', { ascending: false })

            if (error) {
                setError(error.message)
                setBudgets([])
            } else {
                setBudgets(data ?? [])
            }
            setLoading(false)
        }

        fetchBudgets()
    }, [planId])

    if (authLoading) return null

    return (
        <div className="min-h-screen bg-gray-950">
            <nav className="bg-gray-900 shadow">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16">
                        <div className="flex items-center">
                            <button onClick={() => router.push('/business-plan')} className="text-yellow-400 hover:text-yellow-300 text-sm">← Back</button>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-gray-300">Budgets</span>
                        </div>
                    </div>
                </div>
            </nav>

            <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
                <div className="px-4 sm:px-0">
                    <div className="mb-6 flex items-center justify-between">
                        <div>
                            <h2 className="text-2xl font-bold text-yellow-400">Budgets for plan</h2>
                            <p className="text-sm text-gray-400 mt-1">Business plan ID: {planId}</p>
                        </div>
                        <div>
                            <button
                                onClick={() => router.push(`/business-plan/${planId}/new-budget`)}
                                className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 px-4 py-2 rounded-md text-sm font-medium"
                            >
                                Create Budget
                            </button>
                        </div>
                    </div>

                    <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
                        {error && <div className="mb-3 text-sm text-red-400">{error}</div>}
                        {loading ? (
                            <div className="text-gray-300">Loading budgets…</div>
                        ) : budgets.length === 0 ? (
                            <div className="text-gray-400 text-sm">No budgets yet for this business plan.</div>
                        ) : (
                            <ul className="space-y-3">
                                {budgets.map(b => (
                                    <li key={b.id} className="p-4 flex items-start justify-between gap-6 rounded-lg border border-gray-800 bg-gray-900/60">
                                        <div>
                                            <div className="text-gray-100 font-medium">{b.name}</div>
                                            <div className="text-gray-400 text-sm mt-0.5">{b.period_start ? `${new Date(b.period_start).toLocaleDateString()} — ${new Date(b.period_end).toLocaleDateString()}` : ''}</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                className="text-yellow-300 hover:text-yellow-200 text-xs border border-yellow-400/40 hover:border-yellow-400 px-2 py-1 rounded"
                                                onClick={() => router.push(`/budget/${b.id}`)}
                                            >
                                                Open
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </main>
        </div>
    )
}
