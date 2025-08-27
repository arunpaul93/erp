'use client'

import { FormEvent, useEffect, useMemo, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import StrategyCanvas from '@/components/StrategyCanvas'
import type { CanvasData } from '@/components/StrategyCanvas'
import OperationalFlowEditor, { type WorkflowGraph } from '@/components/OperationalFlowEditor'

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
    const [operationalWorkflow, setOperationalWorkflow] = useState<WorkflowGraph | null>(null)
    const [saving, setSaving] = useState(false)
    const [autoSaving, setAutoSaving] = useState(false)
    const [savingWorkflow, setSavingWorkflow] = useState(false)
    const [currentPlanId, setCurrentPlanId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [canvas, setCanvas] = useState<CanvasData | null>(null)

    // Ref to ensure we only save once
    const hasAutoSavedRef = useRef(false)

    const orgName = useMemo(() => orgs.find(o => o.id === selectedOrgId)?.name ?? '—', [orgs, selectedOrgId])

    useEffect(() => {
        if (!authLoading && !user) router.push('/login')
    }, [authLoading, user, router])

    // Immediately save a new plan when page loads (no delay)
    useEffect(() => {
        const immediateAutoSave = async () => {
            // Only run once when org is selected and we haven't saved yet
            if (!selectedOrgId || currentPlanId || autoSaving || orgLoading || hasAutoSavedRef.current) return

            hasAutoSavedRef.current = true // Mark as saved to prevent duplicate calls
            setAutoSaving(true)

            const { data, error } = await supabase.from('business_plan').insert({
                organisation_id: selectedOrgId,
                name: name.trim() || 'Untitled Business Plan',
                problem: problem || null,
                unique_selling_point: uniqueSellingPoint || null,
                target_market: targetMarket || null,
                operational_workflow: operationalWorkflow ? operationalWorkflow : null,
                key_metrics: keyMetrics || null,
                risks_and_plan_b: risksAndPlanB || null,
                vision_3_5_years: vision35Years || null,
                priorities_next_90_days: prioritiesNext90Days || null,
                canvas: canvas ? canvas : null,
            }).select().single()

            setAutoSaving(false)

            if (error) {
                setError(error.message)
                hasAutoSavedRef.current = false // Reset on error so user can try again
                return
            }

            if (data) {
                setCurrentPlanId(data.id)
                // Redirect to the edit page for the newly created plan
                router.push(`/business-plan/${data.id}`)
            }
        }

        immediateAutoSave()
    }, [selectedOrgId, orgLoading, currentPlanId, autoSaving]) // Include all dependencies

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

            operational_workflow: operationalWorkflow ? operationalWorkflow : null,

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

    // Save only the workflow to the backend (for existing plans)
    const saveWorkflow = async (workflow: WorkflowGraph) => {
        if (!currentPlanId || !selectedOrgId) return
        setSavingWorkflow(true)

        const { error } = await supabase
            .from('business_plan')
            .update({
                operational_workflow: workflow,
                updated_at: new Date().toISOString(),
            })
            .eq('id', currentPlanId)
            .eq('organisation_id', selectedOrgId)

        setSavingWorkflow(false)

        if (error) {
            setError(error.message)
        }
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
                    {autoSaving && <div className="text-sm text-blue-400 mb-4">Auto-saving...</div>}

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
                                <label className="block text-sm text-gray-300 mb-1">Operational Workflow (visual)</label>
                                <OperationalFlowEditor
                                    value={operationalWorkflow}
                                    onChange={setOperationalWorkflow}
                                    height={480}
                                    onSave={currentPlanId ? saveWorkflow : undefined}
                                    saving={savingWorkflow}
                                    businessPlanId={currentPlanId || undefined}
                                />
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
                                {!currentPlanId ? (
                                    <button
                                        type="submit"
                                        disabled={saving || !name.trim()}
                                        className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-gray-900 px-4 py-2 rounded-md text-sm font-medium"
                                    >
                                        {saving ? 'Creating…' : 'Create'}
                                    </button>
                                ) : (
                                    <div className="text-sm text-green-400 py-2">
                                        Business plan created! Redirecting to edit view...
                                    </div>
                                )}
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
