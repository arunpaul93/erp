'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import {
    Chart as ChartJS,
    LineElement,
    PointElement,
    LinearScale,
    Tooltip,
    Legend,
    Filler,
    CategoryScale,
} from 'chart.js'
import { Line } from 'react-chartjs-2'

ChartJS.register(LineElement, PointElement, LinearScale, Tooltip, Legend, Filler, CategoryScale)

// Plugin to force zero line always visible on y-axis even after zoom/pan
const alwaysZeroLinePlugin = {
    id: 'alwaysZeroLine',
    // Called during scale fit; adjust min/max to include 0
    afterDataLimits(scale: any) {
        if (scale.id === 'y') {
            if (scale.min > 0) scale.min = 0
            if (scale.max < 0) scale.max = 0
        }
    }
}
ChartJS.register(alwaysZeroLinePlugin as any)

// Draw a visible baseline at y=0 regardless of grid toggle
const zeroBaselinePlugin = {
    id: 'zeroBaseline',
    afterDraw: (chart: any) => {
        const yScale = chart.scales?.y
        if (!yScale) return
        const y = yScale.getPixelForValue(0)
        if (!isFinite(y)) return
        const { left, right, top, bottom } = chart.chartArea
        if (y < top - 5 || y > bottom + 5) return // outside view
        const ctx = chart.ctx
        ctx.save()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = '#475569' // slate-600 like
        ctx.setLineDash([5, 3])
        ctx.beginPath()
        ctx.moveTo(left, y)
        ctx.lineTo(right, y)
        ctx.stroke()
        ctx.restore()
    }
}
ChartJS.register(zeroBaselinePlugin as any)

interface BudgetItemPoint { id: string; date: string; amount: number; type: 'income' | 'expense'; name: string }

export default function BudgetItemsChartPage() {
    const router = useRouter()
    const params = useParams() as { id?: string }
    const budgetId = String(params?.id ?? '')
    const { user, loading: authLoading } = useAuth()
    const { selectedOrgId, loading: orgLoading } = useOrg()

    const [items, setItems] = useState<BudgetItemPoint[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const chartRef = useRef<any>(null)
    const [mode, setMode] = useState<'pan' | 'box-zoom'>('pan')
    const [gridOn, setGridOn] = useState(false)
    const [zoomReady, setZoomReady] = useState(false)
    // Lazy-load zoom plugin only in browser to avoid SSR window reference
    useEffect(() => {
        if (typeof window === 'undefined') return
        let active = true
            ; (async () => {
                try {
                    const mod = await import('chartjs-plugin-zoom')
                    if (!active) return
                    // Register only once
                    // @ts-ignore
                    if (!(ChartJS as any)._zoomRegistered) {
                        ChartJS.register(mod.default)
                            ; (ChartJS as any)._zoomRegistered = true
                    }
                    setZoomReady(true)
                } catch (e) {
                    console.error('Failed to load zoom plugin', e)
                }
            })()
        return () => { active = false }
    }, [])

    useEffect(() => { if (!authLoading && !user) router.push('/login') }, [authLoading, user, router])

    useEffect(() => {
        const load = async () => {
            if (!budgetId || !selectedOrgId) return
            setLoading(true)
            setError(null)
            // Fetch incomes + expenses -> budget_items already materialised by generate fn
            const { data, error } = await supabase
                .from('budget_items')
                .select('id, name, amount, date, budget_income_id, budget_expense_id')
                .eq('budget_id', budgetId)
                .eq('organisation_id', selectedOrgId)
                .order('date', { ascending: true })

            if (error) {
                setError(error.message)
                setItems([])
            } else {
                const mapped: BudgetItemPoint[] = (data ?? []).map((r: any) => ({
                    id: String(r.id),
                    date: r.date,
                    amount: Number(r.amount),
                    type: r.budget_income_id ? 'income' : 'expense',
                    name: r.name || (r.budget_income_id ? 'Income' : 'Expense')
                }))
                setItems(mapped)
            }
            setLoading(false)
        }
        load()
    }, [budgetId, selectedOrgId])

    const combinedData = useMemo(() => {
        if (!items.length) return null
        // Aggregate income & expense by date
        const incomeByDate: Record<string, number> = {}
        const expenseByDate: Record<string, number> = {}
        items.forEach(it => {
            if (it.type === 'income') {
                incomeByDate[it.date] = (incomeByDate[it.date] || 0) + it.amount
            } else {
                expenseByDate[it.date] = (expenseByDate[it.date] || 0) + it.amount
            }
        })
        const labels = Array.from(new Set(items.map(i => i.date))).sort()
        // Compute arrays
        const incomes = labels.map(d => incomeByDate[d] || 0)
        const expenses = labels.map(d => expenseByDate[d] || 0)
        // Cumulative net (income - expense)
        let running = 0
        const cumulative = incomes.map((inc, idx) => {
            const exp = expenses[idx]
            running += inc - exp
            return Number(running.toFixed(2))
        })
        return {
            labels,
            datasets: [
                {
                    label: 'Income',
                    data: incomes,
                    borderColor: '#34d399',
                    backgroundColor: '#34d399',
                    tension: 0.25,
                    pointRadius: 3,
                    fill: false,
                    order: 2,
                },
                {
                    label: 'Expense',
                    data: expenses,
                    borderColor: '#f87171',
                    backgroundColor: '#f87171',
                    tension: 0.25,
                    pointRadius: 3,
                    fill: false,
                    order: 2,
                },
                {
                    label: 'Cumulative Net',
                    data: cumulative,
                    borderColor: '#60a5fa',
                    backgroundColor: '#60a5fa',
                    tension: 0.25,
                    pointRadius: 2,
                    fill: false,
                    borderWidth: 2,
                    order: 1,
                }
            ]
        }
    }, [items])

    if (authLoading || orgLoading) return null
    if (!user) return null

    return (
        <div className="min-h-screen bg-gray-950 flex flex-col">
            <nav className="bg-gray-900 shadow px-4 h-14 flex items-center gap-4 flex-shrink-0">
                <button onClick={() => router.push(`/budget/${budgetId}`)} className="text-yellow-400 hover:text-yellow-300 text-sm">← Back</button>
                <h2 className="text-yellow-400 font-semibold text-sm">Budget Performance</h2>
            </nav>
            <main className="flex-1 w-full p-0 flex flex-col overflow-hidden">
                {/* Status / messages */}
                {!combinedData && (
                    <div className="p-4">
                        {error && <div className="text-sm text-red-400 mb-2">{error}</div>}
                        {loading && <div className="text-gray-300 text-sm mb-2">Loading…</div>}
                        {!loading && !error && !items.length && <div className="text-gray-400 text-sm">No budget items yet. Generate them first.</div>}
                    </div>
                )}
                {combinedData && (
                    <div className="flex-1 w-full relative">
                        <div className="absolute inset-0 p-4 flex flex-col">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-gray-100 font-semibold text-sm">Income, Expense & Cumulative Net</h3>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => {
                                            const chart = chartRef.current
                                            if (chart) {
                                                chart.resetZoom()
                                            }
                                        }}
                                        className="text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-200 px-2 py-1 border border-gray-700"
                                    >Fit to View</button>
                                    <button
                                        onClick={() => setMode(m => m === 'pan' ? 'box-zoom' : 'pan')}
                                        className={`text-xs rounded px-2 py-1 border transition-colors ${mode === 'pan' ? 'bg-blue-600/20 border-blue-500 text-blue-300 hover:bg-blue-600/30' : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'}`}
                                    >{mode === 'pan' ? 'Pan (active)' : 'Pan'}</button>
                                    <button
                                        onClick={() => setMode(m => m === 'box-zoom' ? 'pan' : 'box-zoom')}
                                        className={`text-xs rounded px-2 py-1 border transition-colors ${mode === 'box-zoom' ? 'bg-purple-600/20 border-purple-500 text-purple-300 hover:bg-purple-600/30' : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'}`}
                                    >{mode === 'box-zoom' ? 'Box Zoom (active)' : 'Box Zoom'}</button>
                                    <button
                                        onClick={() => setGridOn(g => !g)}
                                        className={`text-xs rounded px-2 py-1 border transition-colors ${gridOn ? 'bg-green-600/20 border-green-500 text-green-300 hover:bg-green-600/30' : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'}`}
                                    >{gridOn ? 'Grid (on)' : 'Grid (off)'}</button>
                                </div>
                                {(loading || error) && (
                                    <div className="text-xs text-gray-400">{loading ? 'Refreshing…' : error}</div>
                                )}
                            </div>
                            <div className="w-full flex-1">
                                <Line
                                    ref={chartRef}
                                    data={combinedData as any}
                                    options={{
                                        responsive: true,
                                        maintainAspectRatio: false,
                                        plugins: {
                                            legend: { labels: { color: '#e5e7eb', usePointStyle: true } },
                                            tooltip: {
                                                mode: 'index',
                                                intersect: false,
                                                callbacks: {
                                                    title: (items) => {
                                                        if (!items.length) return ''
                                                        const raw = items[0].label as string
                                                        const d = new Date(raw)
                                                        if (isNaN(d.getTime())) return raw
                                                        return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
                                                    }
                                                }
                                            },
                                            ...(zoomReady ? {
                                                zoom: {
                                                    limits: {
                                                        x: { minRange: 1 },
                                                        y: { minRange: 1 }
                                                    },
                                                    pan: { enabled: mode === 'pan', mode: 'xy' },
                                                    zoom: {
                                                        wheel: { enabled: true },
                                                        pinch: { enabled: true },
                                                        drag: { enabled: mode === 'box-zoom' },
                                                        mode: mode === 'box-zoom' ? 'xy' : 'xy'
                                                    }
                                                }
                                            } : {})
                                        },
                                        interaction: { mode: 'nearest', intersect: false },
                                        scales: {
                                            x: {
                                                ticks: {
                                                    color: '#9ca3af',
                                                    callback: (v, idx, ticks) => {
                                                        const value = (typeof v === 'string') ? v : (combinedData?.labels?.[Number(v)] as string)
                                                        const d = new Date(value)
                                                        if (isNaN(d.getTime())) return value
                                                        return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
                                                    }
                                                },
                                                grid: { color: '#1f2937', display: gridOn }
                                            },
                                            y: {
                                                ticks: { color: '#9ca3af' },
                                                beginAtZero: true,
                                                grid: {
                                                    color: '#1f2937',
                                                    display: gridOn,
                                                    lineWidth: (ctx: any) => (ctx.tick && ctx.tick.value === 0 ? 2 : 1),
                                                }
                                            }
                                        }
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    )
}
