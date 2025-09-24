"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/contexts/AuthContext"
import { useOrg } from "@/contexts/OrgContext"

interface Budget {
    id: string
    name: string
    period_start: string
    period_end: string
}

interface IncomeRow {
    id: string
    income_name: string
    description: string | null
    accounting_code: string | null
}

interface ExpenseRow {
    id: string
    expense_name: string
    description: string | null
    accounting_code: string | null
    expense_type_id?: string | null
    recurrence_rule_id?: string | null
}

interface ExpenseType { id: string; name: string }
interface RecurrenceRule { id: string; name: string; rule_type: string; frequency: string; required_details?: any }

export default function BudgetDetailPage() {
    const router = useRouter()
    const params = useParams() as { id?: string }
    const budgetId = String(params?.id ?? "")
    const { user, loading: authLoading } = useAuth()
    const { selectedOrgId, loading: orgLoading } = useOrg()

    const [orgIndustry, setOrgIndustry] = useState<string | null>(null)

    const [budget, setBudget] = useState<Budget | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [incomes, setIncomes] = useState<IncomeRow[]>([])
    const [expenses, setExpenses] = useState<ExpenseRow[]>([])

    // new income state
    const [incomeName, setIncomeName] = useState("")
    const [incomeCode, setIncomeCode] = useState("")
    const [incomeDesc, setIncomeDesc] = useState("")
    const [savingIncome, setSavingIncome] = useState(false)

    // new expense state
    const [expenseName, setExpenseName] = useState("")
    const [expenseCode, setExpenseCode] = useState("")
    const [expenseDesc, setExpenseDesc] = useState("")
    const [expenseTypeId, setExpenseTypeId] = useState<string>("")
    const [recurrenceRuleId, setRecurrenceRuleId] = useState<string>("")
    const [savingExpense, setSavingExpense] = useState(false)

    // expense types
    const [expenseTypes, setExpenseTypes] = useState<ExpenseType[]>([])
    // recurrence rules
    const [recurrenceRules, setRecurrenceRules] = useState<RecurrenceRule[]>([])
    const [selectedRuleType, setSelectedRuleType] = useState<string>("")
    const [recurrenceDetails, setRecurrenceDetails] = useState<Record<string, any>>({})
    // cache incomes for dropdown usage in recurrence details (already fetched into incomes state)

    useEffect(() => {
        if (!authLoading && !user) router.push("/login")
    }, [authLoading, user, router])

    // Fetch organisation industry when org selection changes
    useEffect(() => {
        const fetchIndustry = async () => {
            if (!selectedOrgId) {
                setOrgIndustry(null)
                return
            }
            const { data, error } = await supabase
                .from('organisation')
                .select('industry')
                .eq('id', selectedOrgId)
                .maybeSingle()
            if (error) {
                setError(error.message)
                setOrgIndustry(null)
            } else {
                setOrgIndustry((data as any)?.industry ?? null)
            }
        }
        fetchIndustry()
    }, [selectedOrgId])

    // Fetch budget core details + related lists
    useEffect(() => {
        const run = async () => {
            if (!budgetId) return
            setLoading(true)
            setError(null)

            const [{ data: b, error: be }, { data: inc, error: ie }, { data: exp, error: ee }] = await Promise.all([
                supabase.from("budget").select("id, name, period_start, period_end").eq("id", budgetId).maybeSingle(),
                supabase.from("budget_incomes").select("id, income_name, description, accounting_code").eq("budget_id", budgetId).order("created_at", { ascending: false }),
                supabase.from("budget_expenses").select("id, expense_name, description, accounting_code, expense_type_id, recurrence_rule_id, recurrence_details").eq("budget_id", budgetId).order("created_at", { ascending: false }),
            ])

            if (be) setError(be.message)
            setBudget(b ? ({
                id: String(b.id),
                name: b.name as string,
                period_start: String(b.period_start),
                period_end: String(b.period_end),
            }) : null)

            if (ie) setError(ie.message)
            setIncomes((inc ?? []).map((r: any) => ({ id: String(r.id), income_name: r.income_name, description: r.description ?? null, accounting_code: r.accounting_code ?? null })))

            if (ee) setError(ee.message)
            setExpenses((exp ?? []).map((r: any) => ({ id: String(r.id), expense_name: r.expense_name, description: r.description ?? null, accounting_code: r.accounting_code ?? null, expense_type_id: r.expense_type_id ?? null, recurrence_rule_id: r.recurrence_rule_id ?? null, recurrence_details: r.recurrence_details ?? null })))

            setLoading(false)
        }
        run()
    }, [budgetId])

    // Fetch expense types filtered by organisation industry
    useEffect(() => {
        const loadTypes = async () => {
            if (!orgIndustry) {
                setExpenseTypes([])
                return
            }
            const { data, error } = await supabase
                .from('expense_types')
                .select('id, name')
                .eq('industry', orgIndustry)
                .order('name', { ascending: true })
            if (error) {
                setError(error.message)
                setExpenseTypes([])
            } else {
                setExpenseTypes((data ?? []).map((r: any) => ({ id: String(r.id), name: String(r.name) })))
            }
        }
        loadTypes()
    }, [orgIndustry])

    // Fetch recurrence rules (global list – assuming not industry specific)
    useEffect(() => {
        const loadRecurrence = async () => {
            const { data, error } = await supabase
                .from('recurrence_rules')
                .select('id, name, rule_type, frequency, required_details')
                .order('rule_type', { ascending: true })
                .order('frequency', { ascending: true })
            if (error) {
                setError(error.message)
                setRecurrenceRules([])
            } else {
                setRecurrenceRules((data ?? []).map((r: any) => ({ id: String(r.id), name: String(r.name), rule_type: String(r.rule_type), frequency: String(r.frequency), required_details: r.required_details })))
            }
        }
        loadRecurrence()
    }, [])

    const createIncome = async () => {
        if (!incomeName.trim()) return
        setSavingIncome(true)
        const { data, error } = await supabase.from("budget_incomes").insert({
            budget_id: budgetId,
            income_name: incomeName.trim(),
            accounting_code: incomeCode || null,
            description: incomeDesc || null,
        }).select("id, income_name, description, accounting_code").maybeSingle()
        setSavingIncome(false)
        if (error) return setError(error.message)
        if (data) {
            setIncomes(prev => [{ id: String(data.id), income_name: data.income_name as string, description: (data as any).description ?? null, accounting_code: (data as any).accounting_code ?? null }, ...prev])
            setIncomeName(""); setIncomeCode(""); setIncomeDesc("")
        }
    }

    const createExpense = async () => {
        if (!expenseName.trim()) return
        if (!expenseTypeId) { setError('Select an expense type'); return }
        // validate recurrence required details if a recurrence rule is selected
        if (recurrenceRuleId) {
            const rr = recurrenceRules.find(r => r.id === recurrenceRuleId)
            const requiredSpec = rr?.required_details || {}
            const missing: string[] = []
            if (requiredSpec && typeof requiredSpec === 'object') {
                Object.entries(requiredSpec).forEach(([key, meta]: any) => {
                    if (meta?.required && (recurrenceDetails[key] === undefined || recurrenceDetails[key] === '')) missing.push(key)
                })
            }
            // specialized validation
            if ('dates' in requiredSpec) {
                const arr = recurrenceDetails.dates
                if (Array.isArray(arr)) {
                    arr.forEach((row: any, idx: number) => {
                        if (!row?.date) missing.push(`dates[${idx}].date`)
                        if (row?.amount === '' || row?.amount === undefined) missing.push(`dates[${idx}].amount`)
                    })
                }
            }
            if ('rates' in requiredSpec) {
                const arr = recurrenceDetails.rates
                if (Array.isArray(arr)) {
                    arr.forEach((row: any, idx: number) => {
                        if (row?.percent === '' || row?.percent === undefined) missing.push(`rates[${idx}].percent`)
                        if (!row?.budget_income_id) missing.push(`rates[${idx}].budget_income_id`)
                    })
                }
            }
            if ('budget_income_ids' in requiredSpec) {
                const ids = recurrenceDetails.budget_income_ids
                if (!Array.isArray(ids) || ids.length === 0) missing.push('budget_income_ids')
            }
            if (missing.length) {
                setError(`Missing recurrence fields: ${missing.join(', ')}`)
                return
            }
        }
        setSavingExpense(true)
        // normalize numeric fields
        const normDetails = recurrenceRuleId ? JSON.parse(JSON.stringify(recurrenceDetails)) : null
        if (normDetails) {
            if (typeof normDetails.amount === 'string') normDetails.amount = parseFloat(normDetails.amount).toFixed(2)
            if (typeof normDetails.percent === 'string') normDetails.percent = parseFloat(normDetails.percent).toFixed(2)
            if (Array.isArray(normDetails.dates)) normDetails.dates = normDetails.dates.map((d: any) => ({ ...d, amount: d.amount !== '' ? parseFloat(d.amount).toFixed(2) : d.amount }))
            if (Array.isArray(normDetails.rates)) normDetails.rates = normDetails.rates.map((r: any) => ({ ...r, percent: r.percent !== '' ? parseFloat(r.percent).toFixed(2) : r.percent }))
        }
        const insertPayload: any = {
            budget_id: budgetId,
            expense_name: expenseName.trim(),
            accounting_code: expenseCode || null,
            description: expenseDesc || null,
            expense_type_id: expenseTypeId,
            recurrence_rule_id: recurrenceRuleId || null,
            recurrence_details: normDetails,
        }

        const { data, error } = await supabase.from("budget_expenses").insert(insertPayload).select("id, expense_name, description, accounting_code, expense_type_id, recurrence_rule_id, recurrence_details").maybeSingle()
        setSavingExpense(false)
        if (error) return setError(error.message)
        if (data) {
            setExpenses(prev => [{ id: String(data.id), expense_name: data.expense_name as string, description: (data as any).description ?? null, accounting_code: (data as any).accounting_code ?? null, expense_type_id: (data as any).expense_type_id ?? null, recurrence_rule_id: (data as any).recurrence_rule_id ?? null, recurrence_details: (data as any).recurrence_details ?? null }, ...prev])
            setExpenseName(""); setExpenseCode(""); setExpenseDesc(""); setExpenseTypeId(""); setRecurrenceRuleId("")
        }
    }

    // derive distinct rule types
    const ruleTypes = Array.from(new Set(recurrenceRules.map(r => r.rule_type)))
    const frequenciesForType = recurrenceRules.filter(r => r.rule_type === selectedRuleType)

    useEffect(() => {
        // reset recurrence selection when rule type changes
        setRecurrenceRuleId("")
        setRecurrenceDetails({})
        if (selectedRuleType) {
            const list = recurrenceRules.filter(r => r.rule_type === selectedRuleType)
            if (list.length === 1) setRecurrenceRuleId(list[0].id)
        }
    }, [selectedRuleType, recurrenceRules])

    useEffect(() => {
        // reset details when the chosen rule changes
        setRecurrenceDetails({})
    }, [recurrenceRuleId])

    if (authLoading || orgLoading) return null
    if (!user) return null

    return (
        <div className="min-h-screen bg-gray-950">
            <nav className="bg-gray-900 shadow">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16">
                        <div className="flex items-center">
                            <button onClick={() => router.back()} className="text-yellow-400 hover:text-yellow-300 text-sm">← Back</button>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-gray-300">{budget?.name}</span>
                        </div>
                    </div>
                </div>
            </nav>

            <main className="max-w-5xl mx-auto py-6 sm:px-6 lg:px-8">
                <div className="px-4 sm:px-0">
                    {error && <div className="mb-3 text-sm text-red-400">{error}</div>}
                    {loading ? (
                        <div className="text-gray-300">Loading…</div>
                    ) : !budget ? (
                        <div className="text-gray-400 text-sm">Budget not found.</div>
                    ) : (
                        <div className="space-y-8">
                            <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
                                <div className="text-gray-100 font-semibold">{budget.name}</div>
                                <div className="text-gray-400 text-sm mt-1">{new Date(budget.period_start).toLocaleDateString()} — {new Date(budget.period_end).toLocaleDateString()}</div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Incomes */}
                                <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <h3 className="text-lg font-semibold text-gray-100">Incomes</h3>
                                    </div>
                                    <div className="space-y-2 mb-4">
                                        <input value={incomeName} onChange={e => setIncomeName(e.target.value)} placeholder="Income name" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            <input value={incomeCode} onChange={e => setIncomeCode(e.target.value)} placeholder="Accounting code (optional)" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                            <input value={incomeDesc} onChange={e => setIncomeDesc(e.target.value)} placeholder="Description (optional)" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                        </div>
                                        <button onClick={createIncome} disabled={savingIncome} className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-gray-900 px-3 py-2 rounded-md text-sm w-fit">{savingIncome ? "Saving…" : "Add Income"}</button>
                                    </div>
                                    {incomes.length === 0 ? (
                                        <div className="text-gray-400 text-sm">No incomes yet.</div>
                                    ) : (
                                        <ul className="space-y-2">
                                            {incomes.map((i) => (
                                                <li key={i.id} className="p-3 rounded border border-gray-800 bg-gray-900/60">
                                                    <div className="text-gray-100">{i.income_name}</div>
                                                    {(i.accounting_code || i.description) && (
                                                        <div className="text-gray-400 text-xs mt-1">{[i.accounting_code, i.description].filter(Boolean).join(" · ")}</div>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>

                                {/* Expenses */}
                                <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <h3 className="text-lg font-semibold text-gray-100">Expenses</h3>
                                    </div>
                                    <div className="space-y-2 mb-4">
                                        <div>
                                            <label className="block text-sm text-gray-300 mb-1">Expense Type <span className="text-red-400">*</span></label>
                                            <select required value={expenseTypeId} onChange={e => setExpenseTypeId(e.target.value)} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                                                {!orgIndustry ? (
                                                    <option value="">Select organisation first</option>
                                                ) : expenseTypes.length === 0 ? (
                                                    <option value="">{orgIndustry ? 'No types for industry' : 'Loading types...'}</option>
                                                ) : (
                                                    <>
                                                        <option value="">Select type...</option>
                                                        {expenseTypes.map(t => (
                                                            <option key={t.id} value={t.id}>{t.name}</option>
                                                        ))}
                                                    </>
                                                )}
                                            </select>
                                        </div>
                                        <input value={expenseName} onChange={e => setExpenseName(e.target.value)} placeholder="Expense name" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                        {/* Description now directly after name */}
                                        <input value={expenseDesc} onChange={e => setExpenseDesc(e.target.value)} placeholder="Description (optional)" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                        {/* Recurrence rule selection: rule_type then frequency */}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            <div>
                                                <label className="block text-sm text-gray-300 mb-1">Recurrence Type</label>
                                                <select value={selectedRuleType} onChange={e => setSelectedRuleType(e.target.value)} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                                                    <option value="">None</option>
                                                    {ruleTypes.map(rt => (
                                                        <option key={rt} value={rt}>{rt}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-sm text-gray-300 mb-1">Frequency</label>
                                                <select value={recurrenceRuleId} onChange={e => setRecurrenceRuleId(e.target.value)} disabled={!selectedRuleType} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 disabled:opacity-50">
                                                    <option value="">{selectedRuleType ? 'Select frequency' : 'Choose type first'}</option>
                                                    {frequenciesForType.map(r => (
                                                        <option key={r.id} value={r.id}>{r.frequency}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                        <div className="text-xs text-gray-400">
                                            {selectedRuleType ? (
                                                recurrenceRuleId ? (
                                                    <>Selected recurrence: <span className="text-gray-300">{selectedRuleType}</span> — <span className="text-gray-300">{frequenciesForType.find(f => f.id === recurrenceRuleId)?.frequency || '...'}</span></>
                                                ) : (
                                                    <>Selected type: <span className="text-gray-300">{selectedRuleType}</span> (choose a frequency)</>
                                                )
                                            ) : 'No recurrence selected'}
                                        </div>
                                        {recurrenceRuleId && (() => {
                                            const rr = recurrenceRules.find(r => r.id === recurrenceRuleId)
                                            const specRaw = rr?.required_details || {}
                                            // inject optional end_date if start_date present
                                            const spec: any = { ...specRaw }
                                            if ('start_date' in spec && !('end_date' in spec)) {
                                                spec.end_date = { type: 'date', label: 'End Date', required: false }
                                            }
                                            let entries = Object.entries(spec)
                                            // reorder so start_date then end_date appear first
                                            const priority = ['start_date', 'end_date']
                                            const pIndex = (k: string) => { const i = priority.indexOf(k); return i === -1 ? 999 : i }
                                            entries = entries.sort((a: any, b: any) => {
                                                const pa = pIndex(a[0]); const pb = pIndex(b[0]);
                                                if (pa !== pb) return pa - pb
                                                return a[0].localeCompare(b[0])
                                            })
                                            if (!entries.length) return null
                                            return (
                                                <div className="mt-2 space-y-2 border border-gray-800 rounded-md p-3 bg-gray-900/40">
                                                    <div className="text-xs uppercase tracking-wide text-gray-400">Recurrence Details</div>
                                                    {entries.map(([field, meta]: any) => {
                                                        const type = meta?.type || 'string'
                                                        const label = meta?.label || field
                                                        const required = !!meta?.required
                                                        const placeholder = meta?.placeholder || ''
                                                        const value = recurrenceDetails[field] ?? ''
                                                        // helper setters
                                                        const setField = (val: any) => setRecurrenceDetails(prev => ({ ...prev, [field]: val }))
                                                        // specialized handlers
                                                        if (field === 'dates') {
                                                            const arr = Array.isArray(value) ? value : []
                                                            return (
                                                                <div key={field} className="space-y-1">
                                                                    <div className="flex items-center justify-between">
                                                                        <label className="block text-xs text-gray-300">{label || 'Dates'}{required && <span className="text-red-400">*</span>}</label>
                                                                        <button type="button" onClick={() => setField([...arr, { date: '', amount: '' }])} className="text-xs text-yellow-400 hover:text-yellow-300">+ Add</button>
                                                                    </div>
                                                                    <div className="space-y-2">
                                                                        {arr.length === 0 && <div className="text-xs text-gray-500">No dates added.</div>}
                                                                        {arr.map((row: any, idx: number) => (
                                                                            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                                                                                <div className="col-span-5">
                                                                                    <input type="date" value={row.date || ''} onChange={e => {
                                                                                        const next = [...arr]; next[idx] = { ...next[idx], date: e.target.value }
                                                                                        setField(next)
                                                                                    }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-2 py-1 text-sm" />
                                                                                </div>
                                                                                <div className="col-span-5">
                                                                                    <input type="number" step="0.01" value={row.amount ?? ''} placeholder="Amount" onChange={e => {
                                                                                        const next = [...arr]; next[idx] = { ...next[idx], amount: e.target.value }
                                                                                        setField(next)
                                                                                    }} onBlur={e => {
                                                                                        if (e.target.value !== '') {
                                                                                            const next = [...arr]; next[idx] = { ...next[idx], amount: parseFloat(e.target.value).toFixed(2) }
                                                                                            setField(next)
                                                                                        }
                                                                                    }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-2 py-1 text-sm" />
                                                                                </div>
                                                                                <div className="col-span-2 flex justify-end">
                                                                                    <button type="button" onClick={() => {
                                                                                        const next = arr.filter((_: any, i: number) => i !== idx)
                                                                                        setField(next)
                                                                                    }} className="text-xs text-red-400 hover:text-red-300">Remove</button>
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )
                                                        }
                                                        if (field === 'rates') {
                                                            const arr = Array.isArray(value) ? value : []
                                                            return (
                                                                <div key={field} className="space-y-1">
                                                                    <div className="flex items-center justify-between">
                                                                        <label className="block text-xs text-gray-300">{label || 'Rates'}{required && <span className="text-red-400">*</span>}</label>
                                                                        <button type="button" onClick={() => setField([...arr, { percent: '', budget_income_id: '' }])} className="text-xs text-yellow-400 hover:text-yellow-300">+ Add</button>
                                                                    </div>
                                                                    <div className="space-y-2">
                                                                        {arr.length === 0 && <div className="text-xs text-gray-500">No rates added.</div>}
                                                                        {arr.map((row: any, idx: number) => (
                                                                            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                                                                                <div className="col-span-4">
                                                                                    <input type="number" step="0.01" value={row.percent ?? ''} placeholder="Percent" onChange={e => { const next = [...arr]; next[idx] = { ...next[idx], percent: e.target.value }; setField(next) }} onBlur={e => { if (e.target.value !== '') { const next = [...arr]; next[idx] = { ...next[idx], percent: parseFloat(e.target.value).toFixed(2) }; setField(next) } }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-2 py-1 text-sm" />
                                                                                </div>
                                                                                <div className="col-span-6">
                                                                                    <select value={row.budget_income_id || ''} onChange={e => { const next = [...arr]; next[idx] = { ...next[idx], budget_income_id: e.target.value }; setField(next) }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-2 py-1 text-sm">
                                                                                        <option value="">Select income</option>
                                                                                        {incomes.map(i => <option key={i.id} value={i.id}>{i.income_name}</option>)}
                                                                                    </select>
                                                                                </div>
                                                                                <div className="col-span-2 flex justify-end">
                                                                                    <button type="button" onClick={() => { const next = arr.filter((_: any, i: number) => i !== idx); setField(next) }} className="text-xs text-red-400 hover:text-red-300">Remove</button>
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )
                                                        }
                                                        if (field === 'budget_income_ids') {
                                                            const selected: string[] = Array.isArray(value) ? value : []
                                                            return (
                                                                <div key={field} className="space-y-1">
                                                                    <label className="block text-xs text-gray-300">{label || 'Linked Incomes'}{required && <span className="text-red-400">*</span>}</label>
                                                                    <div className="space-y-1 max-h-40 overflow-auto pr-1 border border-gray-800 rounded-md p-2 bg-gray-900/30">
                                                                        {incomes.length === 0 && <div className="text-xs text-gray-500">No incomes available.</div>}
                                                                        {incomes.map(i => {
                                                                            const checked = selected.includes(i.id)
                                                                            return (
                                                                                <label key={i.id} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                                                                                    <input type="checkbox" className="accent-yellow-400" checked={checked} onChange={() => {
                                                                                        let next = [...selected]
                                                                                        if (checked) next = next.filter(id => id !== i.id); else next.push(i.id)
                                                                                        setRecurrenceDetails(prev => ({ ...prev, [field]: next }))
                                                                                    }} />
                                                                                    <span>{i.income_name}</span>
                                                                                </label>
                                                                            )
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            )
                                                        }
                                                        const commonProps = {
                                                            className: 'w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-2 py-1 text-sm',
                                                            value,
                                                            onChange: (e: any) => setRecurrenceDetails(prev => ({ ...prev, [field]: e.target.value }))
                                                        }
                                                        if (type === 'select' && Array.isArray(meta?.options)) {
                                                            return (
                                                                <div key={field} className="space-y-1">
                                                                    <label className="block text-xs text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label>
                                                                    <select {...commonProps}>
                                                                        <option value="">{placeholder || 'Select...'}</option>
                                                                        {meta.options.map((opt: any) => <option key={opt.value || opt} value={opt.value || opt}>{opt.label || opt}</option>)}
                                                                    </select>
                                                                </div>
                                                            )
                                                        }
                                                        if (type === 'number') {
                                                            return (
                                                                <div key={field} className="space-y-1">
                                                                    <label className="block text-xs text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label>
                                                                    <input type="number" step="0.01" placeholder={placeholder} {...commonProps} onBlur={e => { if (e.target.value !== '') setRecurrenceDetails(prev => ({ ...prev, [field]: parseFloat(e.target.value).toFixed(2) })) }} />
                                                                </div>
                                                            )
                                                        }
                                                        // force date picker for start_date / end_date
                                                        if (type === 'date' || field === 'start_date' || field === 'end_date') {
                                                            return (
                                                                <div key={field} className="space-y-1">
                                                                    <label className="block text-xs text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label>
                                                                    <input type="date" {...commonProps} />
                                                                </div>
                                                            )
                                                        }
                                                        return (
                                                            <div key={field} className="space-y-1">
                                                                <label className="block text-xs text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label>
                                                                <input type="text" placeholder={placeholder} {...commonProps} />
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            )
                                        })()}
                                        <input value={expenseCode} onChange={e => setExpenseCode(e.target.value)} placeholder="Accounting code (optional)" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                        <button onClick={createExpense} disabled={savingExpense || !expenseTypeId} className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-gray-900 px-3 py-2 rounded-md text-sm w-fit">{savingExpense ? "Saving…" : "Add Expense"}</button>
                                    </div>
                                    {expenses.length === 0 ? (
                                        <div className="text-gray-400 text-sm">No expenses yet.</div>
                                    ) : (
                                        <ul className="space-y-2">
                                            {expenses.map((x) => (
                                                <li key={x.id} className="p-3 rounded border border-gray-800 bg-gray-900/60">
                                                    <div className="text-gray-100">{x.expense_name}</div>
                                                    {(x.accounting_code || x.description || x.recurrence_rule_id) && (
                                                        <div className="text-gray-400 text-xs mt-1">
                                                            {[
                                                                x.accounting_code,
                                                                x.description,
                                                                x.recurrence_rule_id ? (() => { const rr = recurrenceRules.find(r => r.id === x.recurrence_rule_id); return rr ? `${rr.rule_type}:${rr.frequency}` : 'Recurring'; })() : null,
                                                                x.recurrence_rule_id && (x as any).recurrence_details ? (() => { try { const d = (x as any).recurrence_details; if (!d || typeof d !== 'object') return null; const priority = ['start_date', 'end_date']; const keys = Object.keys(d); const ordered = [...keys].sort((a, b) => { const pa = priority.indexOf(a); const pb = priority.indexOf(b); const ia = pa === -1 ? 999 : pa; const ib = pb === -1 ? 999 : pb; if (ia !== ib) return ia - ib; return a.localeCompare(b) }); return ordered.slice(0, 3).map(k => `${k}=${d[k]}`).join(', ') || null } catch { return null } })() : null
                                                            ].filter(Boolean).join(" · ")}
                                                        </div>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    )
}
