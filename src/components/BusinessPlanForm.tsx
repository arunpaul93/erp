'use client'

import { FormEvent } from 'react'
import StrategyCanvas from '@/components/StrategyCanvas'
import type { CanvasData } from '@/components/StrategyCanvas'

interface BusinessPlanFormProps {
    // Form data
    name: string
    setName: (value: string) => void
    problem: string
    setProblem: (value: string) => void
    uniqueSellingPoint: string
    setUniqueSellingPoint: (value: string) => void
    targetMarket: string
    setTargetMarket: (value: string) => void
    keyMetrics: string
    setKeyMetrics: (value: string) => void
    identifiedOperationalChallenges: string
    setIdentifiedOperationalChallenges: (value: string) => void
    risksAndPlanB: string
    setRisksAndPlanB: (value: string) => void
    vision35Years: string
    setVision35Years: (value: string) => void
    prioritiesNext90Days: string
    setPrioritiesNext90Days: (value: string) => void
    canvas: CanvasData | null
    setCanvas: (value: CanvasData | null) => void

    // Form actions
    onSubmit: (e: FormEvent) => void
    onCancel: () => void

    // State
    saving: boolean
    error: string | null
    success?: string | null

    // Config
    isEditing?: boolean
    orgName: string
    businessPlanId?: string
    submitButtonText?: string
}

export default function BusinessPlanForm({
    name, setName,
    problem, setProblem,
    uniqueSellingPoint, setUniqueSellingPoint,
    targetMarket, setTargetMarket,
    keyMetrics, setKeyMetrics,
    identifiedOperationalChallenges, setIdentifiedOperationalChallenges,
    risksAndPlanB, setRisksAndPlanB,
    vision35Years, setVision35Years,
    prioritiesNext90Days, setPrioritiesNext90Days,
    canvas, setCanvas,
    onSubmit,
    onCancel,
    saving,
    error,
    success,
    isEditing = false,
    orgName,
    businessPlanId,
    submitButtonText
}: BusinessPlanFormProps) {
    return (
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-gray-800 bg-gray-900/80 p-4">
            {error && <div className="text-sm text-red-400">{error}</div>}
            {success && <div className="text-sm text-green-400">{success}</div>}

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
                <label className="block text-sm text-gray-300 mb-1">Key Metrics</label>
                <textarea
                    value={keyMetrics}
                    onChange={e => setKeyMetrics(e.target.value)}
                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 min-h-[80px]"
                    placeholder="What will we measure?"
                />
            </div>

            <div>
                <label className="block text-sm text-gray-300 mb-1">Identified Operational Challenges</label>
                <textarea
                    value={identifiedOperationalChallenges}
                    onChange={e => setIdentifiedOperationalChallenges(e.target.value)}
                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 min-h-[120px]"
                    placeholder="What operational challenges have we identified?"
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
                    disabled={saving || (!isEditing && !name.trim())}
                    className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-gray-900 px-4 py-2 rounded-md text-sm font-medium"
                >
                    {saving ? (isEditing ? 'Saving…' : 'Creating…') : (submitButtonText || (isEditing ? 'Save' : 'Create'))}
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 px-4 py-2 rounded-md text-sm"
                >
                    Cancel
                </button>
            </div>
        </form>
    )
}
