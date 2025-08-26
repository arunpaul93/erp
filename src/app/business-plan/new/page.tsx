'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import StrategyCanvas from '@/components/StrategyCanvas'
import type { CanvasData } from '@/components/StrategyCanvas'

export default function NewBusinessPlanPage() {
    const router = useRouter()
    const { user, loading: authLoading } = useAuth()
    const { selectedOrgId, orgs, loading: orgLoading } = useOrg()
    const [name, setName] = useState('')
    const [problem, setProblem] = useState('')

    const [uniqueSellingPoint, setUniqueSellingPoint] = useState('')
    const [targetMarket, setTargetMarket] = useState('')



    const [keyMetrics, setKeyMetrics] = useState('')
    const [risksAndPlanB, setRisksAndPlanB] = useState('')
    const [vision35Years, setVision35Years] = useState('')

    const [prioritiesNext90Days, setPrioritiesNext90Days] = useState('')
    const [operationalWorkflow, setOperationalWorkflow] = useState<string[]>([''])
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [canvas, setCanvas] = useState<CanvasData | null>(null)

    const orgName = useMemo(() => orgs.find(o => o.id === selectedOrgId)?.name ?? '—', [orgs, selectedOrgId])

    useEffect(() => {
        if (!authLoading && !user) router.push('/login')
    }, [authLoading, user, router])

    const onSubmit = async (e: FormEvent) => {
        e.preventDefault()
        if (!selectedOrgId) return
        setSaving(true)
        setError(null)

    const { error } = await supabase.from('business_plan').insert({
            organisation_id: selectedOrgId,
            name: name || null,
            problem: problem || null,

            unique_selling_point: uniqueSellingPoint || null,
            target_market: targetMarket || null,

            operational_workflow: operationalWorkflow.length ? operationalWorkflow : null,

            key_metrics: keyMetrics || null,
            risks_and_plan_b: risksAndPlanB || null,
            vision_3_5_years: vision35Years || null,

            priorities_next_90_days: prioritiesNext90Days || null,
            canvas: canvas ? canvas : null,
        })

        if (error) {
            setError(error.message)
            setSaving(false)
            return
        }

        router.push('/business-plan')
    }

    if (authLoading || orgLoading) return null
    if (!user) return null

    return (
        <div className="min-h-screen bg-gray-950">
            <nav className="bg-gray-900 shadow">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16">
                        <div className="flex items-center">
                            <button onClick={() => router.push('/business-plan')} className="text-yellow-400 hover:text-yellow-300 text-sm">← Back</button>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-gray-300">{user.email}</span>
                        </div>
                    </div>
                </div>
            </nav>

            <main className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
                <div className="px-4 sm:px-0">
                    <h2 className="text-2xl font-bold text-yellow-400 mb-4">New Business Plan</h2>
                    <p className="text-sm text-gray-400 mb-6">Organisation: {orgName}</p>

                    {!selectedOrgId ? (
                        <div className="text-gray-400 text-sm">Select an organisation first.</div>
                    ) : (
                        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-gray-800 bg-gray-900/80 p-4">
                            {error && <div className="text-sm text-red-400">{error}</div>}

                            <div>
                                <label className="block text-sm text-gray-300 mb-1">Name</label>
                                <input
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2"
                                    placeholder="e.g. FY26 Growth Plan"
                                />
                            </div>

                            <div>
                                <label className="block text-sm text-gray-300 mb-1">Problem</label>
                                <textarea
                                    value={problem}
                                    onChange={e => setProblem(e.target.value)}
                                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 min-h-[120px]"
                                    placeholder="What problem are we solving?"
                                />
                            </div>



                            <div>
                                <label className="block text-sm text-gray-300 mb-1">Unique Selling Point</label>
                                <textarea
                                    value={uniqueSellingPoint}
                                    onChange={e => setUniqueSellingPoint(e.target.value)}
                                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 min-h-[100px]"
                                    placeholder="What makes us different?"
                                />
                            </div>

                            <div>
                                <label className="block text-sm text-gray-300 mb-2">Strategy Canvas</label>
                                <div className="-mx-4">
                                    <StrategyCanvas value={canvas} onChange={setCanvas} fullScreen selfName={orgName} />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm text-gray-300 mb-1">Target Market</label>
                                <textarea
                                    value={targetMarket}
                                    onChange={e => setTargetMarket(e.target.value)}
                                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 min-h-[100px]"
                                    placeholder="Who are we serving?"
                                />
                            </div>





                            <div>
                                <label className="block text-sm text-gray-300 mb-1">Operational Workflow (steps)</label>
                                <div className="space-y-2">
                                    {operationalWorkflow.map((step, idx) => (
                                        <div key={idx} className="flex gap-2">
                                            <input
                                                value={step}
                                                onChange={e => {
                                                    const copy = [...operationalWorkflow]
                                                    copy[idx] = e.target.value
                                                    setOperationalWorkflow(copy)
                                                }}
                                                className="flex-1 bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2"
                                                placeholder={`Step ${idx + 1}`}
                                            />
                                            <button type="button" onClick={() => setOperationalWorkflow(prev => prev.filter((_, i) => i !== idx))} className="text-red-400">Remove</button>
                                        </div>
                                    ))}

                                    <div>
                                        <button type="button" onClick={() => setOperationalWorkflow(prev => [...prev, ''])} className="text-yellow-400">+ Add step</button>
                                    </div>
                                </div>
                            </div>





                            <div>
                                <label className="block text-sm text-gray-300 mb-1">Key Metrics</label>
                                <textarea
                                    value={keyMetrics}
                                    onChange={e => setKeyMetrics(e.target.value)}
                                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 min-h-[80px]"
                                    placeholder="What will we measure?"
                                />
                            </div>

                            <div>
                                <label className="block text-sm text-gray-300 mb-1">Risks and Plan B</label>
                                <textarea
                                    value={risksAndPlanB}
                                    onChange={e => setRisksAndPlanB(e.target.value)}
                                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 min-h-[100px]"
                                    placeholder="What could go wrong? What's the fallback?"
                                />
                            </div>

                            <div>
                                <label className="block text-sm text-gray-300 mb-1">Vision (3–5 years)</label>
                                <textarea
                                    value={vision35Years}
                                    onChange={e => setVision35Years(e.target.value)}
                                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 min-h-[100px]"
                                    placeholder="Where do we want to be in 3–5 years?"
                                />
                            </div>



                            <div>
                                <label className="block text-sm text-gray-300 mb-1">Priorities (next 90 days)</label>
                                <textarea
                                    value={prioritiesNext90Days}
                                    onChange={e => setPrioritiesNext90Days(e.target.value)}
                                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 min-h-[100px]"
                                    placeholder="Immediate priorities and actions"
                                />
                            </div>

                            <div className="flex gap-3">
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-gray-900 px-4 py-2 rounded-md text-sm font-medium"
                                >
                                    {saving ? 'Saving…' : 'Create'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => router.push('/business-plan')}
                                    className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 px-4 py-2 rounded-md text-sm"
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </main>
        </div>
    )
}
