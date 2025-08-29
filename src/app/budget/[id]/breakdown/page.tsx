"use client"

import React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
    Chart as ChartJS,
    ArcElement,
    Tooltip,
    Legend,
} from 'chart.js'
import { Chart } from 'react-chartjs-2'

ChartJS.register(ArcElement, Tooltip, Legend)

export default function BreakdownPage() {
    const { id } = useParams<{ id: string }>()
    const router = useRouter()
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)
    const [data, setData] = React.useState<any[]>([])
    const [selectedType, setSelectedType] = React.useState<string | null>(null)
    const chartRef = React.useRef<ChartJS>(null)

    React.useEffect(() => {
        const load = async () => {
            if (!id) return
            setLoading(true)
            setError(null)
            const { data: forecast, error } = await supabase
                .from('cashflow_forecast')
                .select('*')
                .eq('budget_id', id)
                .order('forecast_date', { ascending: true })
            if (error) {
                setError(error.message)
            } else {
                setData(forecast || [])
            }
            setLoading(false)
        }
        load()
    }, [id])

    const totals = React.useMemo(() => {
        let income = 0
        let expense = 0
        let totalIncome = 0 // Total including capital
        let totalExpense = 0 // Total including capital

        for (const item of data || []) {
            const amt = parseFloat(item.amount || 0)
            if (!Number.isFinite(amt)) continue

            const itemName = (item.name || '').toLowerCase()
            const isCapitalTransaction = itemName.includes('owners_capital_added') ||
                itemName.includes('owners_capital_withdrawal') ||
                itemName.includes('capital added') ||
                itemName.includes('capital withdrawn')

            // Total amounts (including capital for first chart)
            if (amt >= 0) totalIncome += amt
            else totalExpense += amt

            // Operational amounts (excluding capital for profit calculation)
            if (!isCapitalTransaction) {
                if (amt >= 0) income += amt
                else expense += amt
            }
        }

        return {
            income, // Operational income only
            expenseAbs: Math.abs(expense), // Operational expenses only
            profit: income + expense, // Operational profit only
            totalIncome, // Total including capital
            totalExpenseAbs: Math.abs(totalExpense), // Total including capital
        }
    }, [data])

    const breakdownDetails = React.useMemo(() => {
        const map: Record<string, { absTotal: number, incomeTotal: number, expenseTotalAbs: number, profit: number, transactions: any[] }> = {}
        for (const item of data || []) {
            let key = item.name || 'Unknown'
            const amt = parseFloat(item.amount || 0)

            // Special handling for capital transactions
            if (key.toLowerCase().includes('capital added')) {
                key = 'Capital Added (Income)'
            } else if (key.toLowerCase().includes('withdrawn') || key.toLowerCase().includes('withdrawal')) {
                key = 'Capital Withdrawn (Expense)'
            }

            if (!Number.isFinite(amt)) continue
            if (!map[key]) map[key] = { absTotal: 0, incomeTotal: 0, expenseTotalAbs: 0, profit: 0, transactions: [] }
            map[key].absTotal += Math.abs(amt)

            // Treat capital added as income, withdrawn as expense regardless of amount sign
            if (key.includes('Capital Added')) {
                map[key].incomeTotal += Math.abs(amt)
                map[key].profit += Math.abs(amt)
            } else if (key.includes('Capital Withdrawn')) {
                map[key].expenseTotalAbs += Math.abs(amt)
                map[key].profit -= Math.abs(amt)
            } else {
                // Normal processing for other items
                if (amt >= 0) {
                    map[key].incomeTotal += amt
                    map[key].profit += amt
                } else {
                    map[key].expenseTotalAbs += Math.abs(amt)
                    map[key].profit += amt
                }
            }

            map[key].transactions.push(item)
        }
        return map
    }, [data])

    // Profit/Loss breakdown by name
    const profitLossDetails = React.useMemo(() => {
        const profitTypes: Record<string, number> = {}
        const lossTypes: Record<string, number> = {}

        for (const [name, details] of Object.entries(breakdownDetails)) {
            // Ignore owners capital transactions for profit/loss analysis
            if (name.toLowerCase().includes('owners_capital_added') ||
                name.toLowerCase().includes('owners_capital_withdrawal') ||
                name.toLowerCase().includes('capital added') ||
                name.toLowerCase().includes('capital withdrawn')) {
                continue
            }

            if (details.profit > 0) {
                profitTypes[name] = details.profit
            } else if (details.profit < 0) {
                lossTypes[name] = Math.abs(details.profit)
            }
        }

        return { profitTypes, lossTypes }
    }, [breakdownDetails])

    const doughnutData = React.useMemo(() => {
        // Create array of {label, value} and sort by value (largest first)
        const items = Object.keys(breakdownDetails).map(label => ({
            label,
            value: breakdownDetails[label].absTotal
        })).sort((a, b) => b.value - a.value)

        const labels = items.map(item => item.label)
        const values = items.map(item => item.value)
        const total = values.reduce((sum, v) => sum + v, 0)
        const palette = [
            'rgba(59, 130, 246, 0.7)',  // blue-500
            'rgba(34, 197, 94, 0.7)',   // green-500
            'rgba(239, 68, 68, 0.7)',   // red-500
            'rgba(234, 179, 8, 0.7)',   // amber-500
            'rgba(168, 85, 247, 0.7)',  // purple-500
            'rgba(20, 184, 166, 0.7)',  // teal-500
            'rgba(244, 114, 182, 0.7)', // pink-400
            'rgba(99, 102, 241, 0.7)',  // indigo-500
        ]
        const colors = labels.map((_, i) => palette[i % palette.length])
        const borderColors = colors.map(c => c.replace('0.7', '1'))
        return {
            labels: labels.map((label, i) => {
                const percent = total > 0 ? ((values[i] / total) * 100).toFixed(1) : '0.0'
                return `${label} (${percent}%)`
            }),
            datasets: [
                {
                    label: 'Amount (ABS AUD)',
                    data: values,
                    backgroundColor: colors,
                    borderColor: borderColors,
                    borderWidth: 1,
                }
            ],
            _rawLabels: labels, // Keep original labels for selection
            _total: total
        }
    }, [breakdownDetails])

    // Profit/Loss Pie Chart Data
    const profitLossPieData = React.useMemo(() => {
        const allTypes = [...Object.keys(profitLossDetails.profitTypes), ...Object.keys(profitLossDetails.lossTypes)]
        const uniqueTypes = Array.from(new Set(allTypes))

        // Create array with values and sort by absolute value (largest first)
        const items = uniqueTypes.map(type => {
            const profit = profitLossDetails.profitTypes[type] || 0
            const loss = profitLossDetails.lossTypes[type] || 0
            const netValue = profit - loss // Net profit/loss for this type
            return {
                label: type,
                value: netValue,
                absValue: Math.abs(netValue)
            }
        }).sort((a, b) => b.absValue - a.absValue)

        const labels = items.map(item => item.label)
        const values = items.map(item => item.value)
        const total = values.reduce((sum, v) => sum + Math.abs(v), 0)

        const colors = values.map(value =>
            value >= 0 ? 'rgba(34, 197, 94, 0.7)' : 'rgba(239, 68, 68, 0.7)' // green for profit, red for loss
        )
        const borderColors = colors.map(c => c.replace('0.7', '1'))

        return {
            labels: labels.map((label, i) => {
                const value = Math.abs(values[i])
                const percent = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0'
                const type = values[i] >= 0 ? 'Profit' : 'Loss'
                return `${label} ${type} (${percent}%)`
            }),
            datasets: [
                {
                    label: 'Net P&L (AUD)',
                    data: values.map(v => Math.abs(v)),
                    backgroundColor: colors,
                    borderColor: borderColors,
                    borderWidth: 1,
                }
            ],
            _rawLabels: labels,
            _total: total,
            _values: values
        }
    }, [profitLossDetails])

    const profitLossOptions = React.useMemo(() => ({
        responsive: true,
        maintainAspectRatio: false,
        animation: {
            animateRotate: true,
            animateScale: true,
            duration: 1000,
            easing: 'easeOutQuart' as const
        },
        plugins: {
            legend: {
                position: 'right' as const,
                labels: {
                    color: '#d1d5db',
                    font: { size: 12 }
                },
            },
            tooltip: {
                backgroundColor: 'rgba(17, 24, 39, 0.95)',
                titleColor: '#f3f4f6',
                bodyColor: '#d1d5db',
                borderColor: '#374151',
                borderWidth: 1,
                callbacks: {
                    label: (context: any) => {
                        const value = (profitLossPieData as any)._values[context.dataIndex]
                        const absValue = Math.abs(value)
                        const total = (profitLossPieData as any)._total || 1
                        const percent = ((absValue / total) * 100).toFixed(1)
                        const currency = new Intl.NumberFormat('en-AU', {
                            style: 'currency',
                            currency: 'AUD',
                            minimumFractionDigits: 0
                        }).format(absValue)
                        const type = value >= 0 ? 'Profit' : 'Loss'
                        return `${type}: ${currency} (${percent}%)`
                    }
                }
            }
        },
        onHover: (event: any, activeElements: any[]) => {
            if (event.native) {
                event.native.target.style.cursor = activeElements.length > 0 ? 'pointer' : 'default'
            }
        },
        onClick: (_event: any, elements: any[]) => {
            if (elements && elements.length > 0) {
                const idx = elements[0].index
                const rawLabels = (profitLossPieData as any)._rawLabels
                const label = rawLabels?.[idx]
                setSelectedType(label || null)
            }
        },
        elements: {
            arc: {
                hoverBackgroundColor: (context: any) => {
                    const color = context.element?.options?.backgroundColor || context.element?.backgroundColor
                    if (typeof color === 'string') {
                        return color.replace('0.7', '1') // Make fully opaque on hover
                    }
                    return color
                },
                borderWidth: 2,
                hoverBorderWidth: 8, // Hyper emboss effect
                hoverOffset: 25, // Large offset for hyper emboss
                borderColor: '#ffffff', // White border for emboss effect
                hoverBorderColor: '#ffffff' // White border on hover
            }
        },
        cutout: '60%' // Make it a doughnut chart
    }), [profitLossPieData])

    const doughnutOptions = React.useMemo(() => ({
        responsive: true,
        maintainAspectRatio: false,
        animation: {
            animateRotate: true,
            animateScale: true,
            duration: 1000,
            easing: 'easeOutQuart' as const
        },
        plugins: {
            legend: {
                position: 'right' as const,
                labels: {
                    color: '#d1d5db',
                    font: { size: 12 }
                },
            },
            tooltip: {
                backgroundColor: 'rgba(17, 24, 39, 0.95)', // gray-900 with opacity
                titleColor: '#f3f4f6', // gray-100
                bodyColor: '#d1d5db', // gray-300
                borderColor: '#374151', // gray-700
                borderWidth: 1,
                callbacks: {
                    label: (context: any) => {
                        const value = context.parsed
                        const total = (doughnutData as any)._total || 1
                        const percent = ((value / total) * 100).toFixed(1)
                        const currency = new Intl.NumberFormat('en-AU', {
                            style: 'currency',
                            currency: 'AUD',
                            minimumFractionDigits: 0
                        }).format(value)
                        return `${currency} (${percent}%)`
                    }
                }
            }
        },
        onHover: (event: any, activeElements: any[], chart: any) => {
            // Change cursor on hover
            if (event.native) {
                event.native.target.style.cursor = activeElements.length > 0 ? 'pointer' : 'default'
            }
        },
        onClick: (_event: any, elements: any[]) => {
            if (elements && elements.length > 0) {
                const idx = elements[0].index
                const rawLabels = (doughnutData as any)._rawLabels
                const label = rawLabels?.[idx]
                setSelectedType(label || null)
            }
        },
        elements: {
            arc: {
                hoverBackgroundColor: (context: any) => {
                    const color = context.element?.options?.backgroundColor || context.element?.backgroundColor
                    if (typeof color === 'string') {
                        // Make color fully opaque and brighter on hover
                        return color.replace('0.7', '1')
                    }
                    return color
                },
                borderWidth: 2,
                hoverBorderWidth: 8, // Hyper emboss effect
                hoverOffset: 25, // Large offset for hyper emboss
                borderColor: '#ffffff', // White border for emboss effect
                hoverBorderColor: '#ffffff' // White border on hover
            }
        },
        cutout: '60%' // Make it a doughnut chart
    }), [doughnutData])

    return (
        <div className="min-h-screen bg-gray-950 text-gray-100">
            <div className="w-screen flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-gray-900/60">
                    <h1 className="text-lg md:text-xl font-semibold text-gray-100">Item Type Breakdown</h1>
                    <div className="flex gap-2">
                        <button
                            onClick={() => router.push(`/budget/${id}`)}
                            className="bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-1 rounded text-sm"
                        >
                            ← Back to Budget
                        </button>
                    </div>
                </div>

                {loading ? (
                    <div className="flex-1 flex items-center justify-center text-gray-400">Loading…</div>
                ) : error ? (
                    <div className="flex-1 flex items-center justify-center text-red-400">{error}</div>
                ) : (
                    <div className="flex flex-col">
                        {/* KPIs - Compact horizontal */}
                        <div className="flex justify-center gap-6 p-4 bg-gray-900/30">
                            <div className="text-center">
                                <div className="text-xs text-gray-400">Operational Income</div>
                                <div className="text-green-400 font-medium text-lg">
                                    {new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0 }).format(totals.income)}
                                </div>
                            </div>
                            <div className="text-center">
                                <div className="text-xs text-gray-400">Operational Expenses</div>
                                <div className="text-red-400 font-medium text-lg">
                                    {new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0 }).format(totals.expenseAbs)}
                                </div>
                            </div>
                            <div className="text-center">
                                <div className="text-xs text-gray-400">Operational Profit</div>
                                <div className={`font-medium text-lg ${totals.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0 }).format(totals.profit)}
                                </div>
                            </div>
                        </div>

                        {/* Charts - Stacked vertically */}
                        <div className="relative w-full flex flex-col gap-6 pb-6">
                            {/* Absolute Amounts Chart */}
                            <div className="relative bg-gray-900 rounded-lg p-4 border border-gray-700" style={{ height: '720px' }}>
                                <h3 className="text-lg font-semibold text-gray-100 mb-3 text-center">
                                    Breakdown by Item Name (AUD)
                                </h3>
                                <div style={{ height: 'calc(100% - 3rem)' }}>
                                    {Object.keys(breakdownDetails).length > 0 ? (
                                        <Chart ref={chartRef} type="doughnut" data={doughnutData} options={doughnutOptions} />
                                    ) : (
                                        <div className="h-full flex items-center justify-center text-gray-400">No data</div>
                                    )}
                                </div>
                            </div>

                            {/* Profit/Loss Chart */}
                            <div className="relative bg-gray-900 rounded-lg p-4 border border-gray-700" style={{ height: '720px' }}>
                                <h3 className="text-lg font-semibold text-gray-100 mb-3 text-center">
                                    Profit & Loss by Item Name
                                </h3>
                                <div style={{ height: 'calc(100% - 3rem)' }}>
                                    {Object.keys(breakdownDetails).length > 0 ? (
                                        Object.keys(profitLossDetails.profitTypes).length > 0 || Object.keys(profitLossDetails.lossTypes).length > 0 ? (
                                            <Chart type="doughnut" data={profitLossPieData} options={profitLossOptions} />
                                        ) : (
                                            <div className="h-full flex items-center justify-center text-gray-400">No profit/loss data to display</div>
                                        )
                                    ) : (
                                        <div className="h-full flex items-center justify-center text-gray-400">No data</div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Selected type summary - Fixed bottom overlay */}
                        {selectedType && breakdownDetails[selectedType] && (
                            <div className="absolute bottom-0 left-0 right-0 bg-gray-900/90 border-t border-gray-700 p-4 backdrop-blur-sm">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <div className="text-sm text-gray-200 font-medium">{selectedType}</div>
                                        <div className="text-xs text-gray-400">{breakdownDetails[selectedType].transactions.length} transaction{breakdownDetails[selectedType].transactions.length !== 1 ? 's' : ''}</div>
                                    </div>
                                    <button className="text-xs text-gray-400 hover:text-gray-300" onClick={() => setSelectedType(null)}>Clear</button>
                                </div>
                                <div className="grid grid-cols-3 gap-6 mt-2 text-sm">
                                    <div className="text-center">
                                        <div className="text-xs text-gray-400">Income</div>
                                        <div className="text-green-400 font-medium">{new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0 }).format(breakdownDetails[selectedType].incomeTotal)}</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="text-xs text-gray-400">Expenses</div>
                                        <div className="text-red-400 font-medium">{new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0 }).format(breakdownDetails[selectedType].expenseTotalAbs)}</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="text-xs text-gray-400">Profit</div>
                                        <div className={`font-medium ${breakdownDetails[selectedType].profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0 }).format(breakdownDetails[selectedType].profit)}</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
