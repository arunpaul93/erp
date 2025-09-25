"use client"

import { useEffect, useState, useMemo } from "react"
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
    income_type_id?: string | null
    recurrence_rule_id?: string | null
    recurrence_details?: any
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
interface IncomeType { id: string; name: string }
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
    const [incomeTypes, setIncomeTypes] = useState<IncomeType[]>([])
    const [expenses, setExpenses] = useState<ExpenseRow[]>([])
    // editing state for existing expenses
    const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null)
    const [editingForm, setEditingForm] = useState<any>(null) // shape similar to form + expense_type_id
    const [savingEdit, setSavingEdit] = useState(false)
    // editing state for incomes
    const [editingIncomeId, setEditingIncomeId] = useState<string | null>(null)
    const [editingIncomeForm, setEditingIncomeForm] = useState<any>(null)
    const [savingIncomeEdit, setSavingIncomeEdit] = useState(false)
    const [deletingIncomeId, setDeletingIncomeId] = useState<string | null>(null)
    const [deletingExpenseId, setDeletingExpenseId] = useState<string | null>(null)
    const [pendingDelete, setPendingDelete] = useState<{ type: 'income' | 'expense'; id: string } | null>(null)
    const [generating, setGenerating] = useState(false)

    const runGenerateBudgetItems = async () => {
        if (!budgetId) return
        setError(null)
        setGenerating(true)
        try {
            const { error: genError } = await supabase.rpc('generate_budget_items', { p_budget_id: budgetId, p_replace_existing: true }) as any
            if (genError) throw genError
            const [{ data: inc, error: ie }, { data: exp, error: ee }] = await Promise.all([
                supabase.from('budget_incomes').select('id, income_name, description, accounting_code, income_type_id, recurrence_rule_id, recurrence_details').eq('budget_id', budgetId).order('created_at', { ascending: false }),
                supabase.from('budget_expenses').select('id, expense_name, description, accounting_code, expense_type_id, recurrence_rule_id, recurrence_details').eq('budget_id', budgetId).order('created_at', { ascending: false }),
            ])
            if (ie) setError(ie.message)
            else setIncomes((inc ?? []).map((r: any) => ({ id: String(r.id), income_name: r.income_name, description: r.description ?? null, accounting_code: r.accounting_code ?? null, income_type_id: r.income_type_id ?? null, recurrence_rule_id: r.recurrence_rule_id ?? null, recurrence_details: r.recurrence_details ?? null })))
            if (ee) setError(ee.message)
            else setExpenses((exp ?? []).map((r: any) => ({ id: String(r.id), expense_name: r.expense_name, description: r.description ?? null, accounting_code: r.accounting_code ?? null, expense_type_id: r.expense_type_id ?? null, recurrence_rule_id: r.recurrence_rule_id ?? null, recurrence_details: r.recurrence_details ?? null })))
        } catch (e: any) {
            setError(e?.message || 'Failed to generate budget items')
        } finally {
            setGenerating(false)
        }
    }

    // per-income-type form state
    interface IncomeFormState { name: string; code: string; desc: string; saving: boolean; selectedRuleType: string; recurrenceRuleId: string; recurrenceDetails: Record<string, any> }
    const [incomeForms, setIncomeForms] = useState<Record<string, IncomeFormState>>({})
    const initIncomeForm = (): IncomeFormState => ({ name: '', code: '', desc: '', saving: false, selectedRuleType: 'fixed', recurrenceRuleId: '', recurrenceDetails: {} })
    const ensureIncomeFormsForTypes = (types: IncomeType[]) => {
        setIncomeForms(prev => {
            const next = { ...prev }
            types.forEach(t => { if (!next[t.id]) next[t.id] = initIncomeForm() })
            return next
        })
    }
    const updateIncomeForm = (typeId: string, patch: Partial<IncomeFormState>) => setIncomeForms(prev => ({ ...prev, [typeId]: { ...prev[typeId], ...patch } }))

    // expense types
    const [expenseTypes, setExpenseTypes] = useState<ExpenseType[]>([])
    // recurrence rules (global)
    const [recurrenceRules, setRecurrenceRules] = useState<RecurrenceRule[]>([])
    // Per-expense-type form state bucket
    interface ExpenseFormState {
        name: string
        code: string
        desc: string
        selectedRuleType: string
        recurrenceRuleId: string
        recurrenceDetails: Record<string, any>
        saving: boolean
    }
    const [expenseForms, setExpenseForms] = useState<Record<string, ExpenseFormState>>({})
    const initFormState = (): ExpenseFormState => ({ name: '', code: '', desc: '', selectedRuleType: '', recurrenceRuleId: '', recurrenceDetails: {}, saving: false })
    const ensureFormsForTypes = (types: ExpenseType[]) => {
        setExpenseForms(prev => {
            const next = { ...prev }
            types.forEach(t => { if (!next[t.id]) next[t.id] = initFormState() })
            return next
        })
    }
    const updateExpenseForm = (typeId: string, patch: Partial<ExpenseFormState>) => {
        setExpenseForms(prev => ({ ...prev, [typeId]: { ...prev[typeId], ...patch } }))
    }

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
                supabase.from("budget_incomes").select("id, income_name, description, accounting_code, income_type_id, recurrence_rule_id, recurrence_details").eq("budget_id", budgetId).order("created_at", { ascending: false }),
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
            setIncomes((inc ?? []).map((r: any) => ({ id: String(r.id), income_name: r.income_name, description: r.description ?? null, accounting_code: r.accounting_code ?? null, income_type_id: r.income_type_id ?? null, recurrence_rule_id: r.recurrence_rule_id ?? null, recurrence_details: r.recurrence_details ?? null })))

            if (ee) setError(ee.message)
            setExpenses((exp ?? []).map((r: any) => ({ id: String(r.id), expense_name: r.expense_name, description: r.description ?? null, accounting_code: r.accounting_code ?? null, expense_type_id: r.expense_type_id ?? null, recurrence_rule_id: r.recurrence_rule_id ?? null, recurrence_details: r.recurrence_details ?? null })))

            setLoading(false)
        }
        run()
    }, [budgetId])

    // Fetch expense & income types filtered by organisation industry
    useEffect(() => {
        const loadTypes = async () => {
            if (!orgIndustry) {
                setExpenseTypes([])
                setIncomeTypes([])
                return
            }
            const [expRes, incRes] = await Promise.all([
                supabase.from('expense_types').select('id, name').eq('industry', orgIndustry).order('name', { ascending: true }),
                supabase.from('income_types').select('id, name').eq('industry', orgIndustry).order('name', { ascending: true })
            ])
            if (expRes.error) { setError(expRes.error.message); setExpenseTypes([]) } else { setExpenseTypes((expRes.data ?? []).map((r: any) => ({ id: String(r.id), name: String(r.name) }))) }
            if (incRes.error) { setError(incRes.error.message); setIncomeTypes([]) } else { setIncomeTypes((incRes.data ?? []).map((r: any) => ({ id: String(r.id), name: String(r.name) }))) }
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

    const createIncomeForType = async (typeId: string) => {
        const form = incomeForms[typeId]
        if (!form || !form.name.trim()) return
        if (!selectedOrgId) { setError('No organisation selected'); return }
        // Only allow 'fixed' rule type; frequency selection will be restricted to those rules
        let recurrenceRuleId = form.recurrenceRuleId
        if (form.selectedRuleType !== 'fixed') recurrenceRuleId = ''
        // Validate recurrence details if rule selected
        if (recurrenceRuleId) {
            const rr = recurrenceRules.find(r => r.id === recurrenceRuleId)
            const requiredSpec = rr?.required_details || {}
            const missing: string[] = []
            if (requiredSpec && typeof requiredSpec === 'object') {
                Object.entries(requiredSpec).forEach(([key, meta]: any) => { if (meta?.required && (form.recurrenceDetails[key] === undefined || form.recurrenceDetails[key] === '')) missing.push(key) })
            }
            if ('dates' in requiredSpec) {
                const arr = form.recurrenceDetails.dates
                if (Array.isArray(arr)) arr.forEach((row: any, idx: number) => { if (!row?.date) missing.push(`dates[${idx}].date`); if (row?.amount === '' || row?.amount === undefined) missing.push(`dates[${idx}].amount`) })
            }
            if ('rates' in requiredSpec) {
                const arr = form.recurrenceDetails.rates
                if (Array.isArray(arr)) arr.forEach((row: any, idx: number) => { if (row?.percent === '' || row?.percent === undefined) missing.push(`rates[${idx}].percent`); if (!row?.budget_income_id) missing.push(`rates[${idx}].budget_income_id`) })
            }
            if ('budget_income_ids' in requiredSpec) {
                const ids = form.recurrenceDetails.budget_income_ids
                if (!Array.isArray(ids) || ids.length === 0) missing.push('budget_income_ids')
            }
            if (missing.length) { setError(`Missing income recurrence fields: ${missing.join(', ')}`); return }
        }
        updateIncomeForm(typeId, { saving: true })
        let normDetails = recurrenceRuleId ? JSON.parse(JSON.stringify(form.recurrenceDetails)) : null
        if (normDetails) {
            if (typeof normDetails.amount === 'string') normDetails.amount = parseFloat(normDetails.amount).toFixed(2)
            if (typeof normDetails.percent === 'string') normDetails.percent = parseFloat(normDetails.percent).toFixed(2)
            if (Array.isArray(normDetails.dates)) normDetails.dates = normDetails.dates.map((d: any) => ({ ...d, amount: d.amount !== '' ? parseFloat(d.amount).toFixed(2) : d.amount }))
            if (Array.isArray(normDetails.rates)) normDetails.rates = normDetails.rates.map((r: any) => ({ ...r, percent: r.percent !== '' ? parseFloat(r.percent).toFixed(2) : r.percent }))
        }
        const { data, error } = await supabase.from('budget_incomes').insert({
            budget_id: budgetId,
            organisation_id: selectedOrgId,
            income_name: form.name.trim(),
            accounting_code: form.code || null,
            description: form.desc || null,
            income_type_id: typeId,
            recurrence_rule_id: recurrenceRuleId || null,
            recurrence_details: normDetails,
        }).select('id, income_name, description, accounting_code, income_type_id, recurrence_rule_id, recurrence_details').maybeSingle()
        updateIncomeForm(typeId, { saving: false })
        if (error) { setError(error.message); return }
        if (data) {
            setIncomes(prev => [{ id: String(data.id), income_name: data.income_name as string, description: (data as any).description ?? null, accounting_code: (data as any).accounting_code ?? null, income_type_id: (data as any).income_type_id ?? null, recurrence_rule_id: (data as any).recurrence_rule_id ?? null, recurrence_details: (data as any).recurrence_details ?? null }, ...prev])
            updateIncomeForm(typeId, { name: '', code: '', desc: '', recurrenceRuleId: '', recurrenceDetails: {} })
        }
    }

    // Begin editing an income
    const startEditingIncome = (inc: any) => {
        const rr = inc.recurrence_rule_id ? recurrenceRules.find(r => r.id === inc.recurrence_rule_id) : null
        const cloned = inc.recurrence_details ? JSON.parse(JSON.stringify(inc.recurrence_details)) : {}
        const withDefaults = buildDefaultRecurrenceDetails(inc.recurrence_rule_id, cloned)
        setEditingIncomeId(inc.id)
        setEditingIncomeForm({
            id: inc.id,
            income_type_id: inc.income_type_id || '',
            name: inc.income_name || '',
            desc: inc.description || '',
            code: inc.accounting_code || '',
            selectedRuleType: 'fixed',
            recurrenceRuleId: inc.recurrence_rule_id || '',
            recurrenceDetails: withDefaults,
        })
    }
    const cancelEditingIncome = () => { setEditingIncomeId(null); setEditingIncomeForm(null); setSavingIncomeEdit(false) }
    const updateEditingIncomeField = (patch: any) => setEditingIncomeForm((prev: any) => ({ ...prev, ...patch }))
    const updateEditingIncomeRecurrenceDetail = (field: string, val: any) => setEditingIncomeForm((prev: any) => ({ ...prev, recurrenceDetails: { ...(prev?.recurrenceDetails || {}), [field]: val } }))

    const saveEditedIncome = async () => {
        if (!editingIncomeId || !editingIncomeForm) return
        if (!editingIncomeForm.name.trim()) { setError('Income name required'); return }
        if (editingIncomeForm.recurrenceRuleId) {
            const rr = recurrenceRules.find(r => r.id === editingIncomeForm.recurrenceRuleId)
            const requiredSpec = rr?.required_details || {}
            const details = editingIncomeForm.recurrenceDetails || {}
            const missing: string[] = []
            if (requiredSpec && typeof requiredSpec === 'object') {
                Object.entries(requiredSpec).forEach(([key, meta]: any) => { if (meta?.required && (details[key] === undefined || details[key] === '')) missing.push(key) })
            }
            if ('dates' in requiredSpec) {
                const arr = details.dates
                if (Array.isArray(arr)) arr.forEach((row: any, idx: number) => { if (!row?.date) missing.push(`dates[${idx}].date`); if (row?.amount === '' || row?.amount === undefined) missing.push(`dates[${idx}].amount`) })
            }
            if ('rates' in requiredSpec) {
                const arr = details.rates
                if (Array.isArray(arr)) arr.forEach((row: any, idx: number) => { if (row?.percent === '' || row?.percent === undefined) missing.push(`rates[${idx}].percent`); if (!row?.budget_income_id) missing.push(`rates[${idx}].budget_income_id`) })
            }
            if ('budget_income_ids' in requiredSpec) {
                const ids = details.budget_income_ids
                if (!Array.isArray(ids) || ids.length === 0) missing.push('budget_income_ids')
            }
            if (missing.length) { setError(`Missing income recurrence fields: ${missing.join(', ')}`); return }
        }
        setSavingIncomeEdit(true)
        let normDetails = editingIncomeForm.recurrenceRuleId ? JSON.parse(JSON.stringify(editingIncomeForm.recurrenceDetails)) : null
        if (normDetails) {
            if (typeof normDetails.amount === 'string') normDetails.amount = parseFloat(normDetails.amount).toFixed(2)
            if (typeof normDetails.percent === 'string') normDetails.percent = parseFloat(normDetails.percent).toFixed(2)
            if (Array.isArray(normDetails.dates)) normDetails.dates = normDetails.dates.map((d: any) => ({ ...d, amount: d.amount !== '' ? parseFloat(d.amount).toFixed(2) : d.amount }))
            if (Array.isArray(normDetails.rates)) normDetails.rates = normDetails.rates.map((r: any) => ({ ...r, percent: r.percent !== '' ? parseFloat(r.percent).toFixed(2) : r.percent }))
        }
        const updatePayload: any = {
            income_name: editingIncomeForm.name.trim(),
            description: editingIncomeForm.desc || null,
            accounting_code: editingIncomeForm.code || null,
            recurrence_rule_id: editingIncomeForm.recurrenceRuleId || null,
            recurrence_details: normDetails,
        }
        const { data, error } = await supabase.from('budget_incomes').update(updatePayload).eq('id', editingIncomeId).select('id, income_name, description, accounting_code, income_type_id, recurrence_rule_id, recurrence_details').maybeSingle()
        setSavingIncomeEdit(false)
        if (error) { setError(error.message); return }
        if (data) {
            setIncomes(prev => prev.map(i => i.id === editingIncomeId ? { id: String(data.id), income_name: data.income_name as string, description: (data as any).description ?? null, accounting_code: (data as any).accounting_code ?? null, income_type_id: (data as any).income_type_id ?? null, recurrence_rule_id: (data as any).recurrence_rule_id ?? null, recurrence_details: (data as any).recurrence_details ?? null } : i))
            cancelEditingIncome()
        }
    }

    const deleteIncome = async (id: string) => {
        if (!id) return
        setDeletingIncomeId(id)
        const { error } = await supabase.from('budget_incomes').delete().eq('id', id)
        setDeletingIncomeId(null)
        if (error) { setError(error.message); return }
        setIncomes(prev => prev.filter(i => i.id !== id))
        if (editingIncomeId === id) cancelEditingIncome()
    }

    const confirmDelete = async () => {
        if (!pendingDelete) return
        const { type, id } = pendingDelete
        if (type === 'income') await deleteIncome(id)
        else await deleteExpense(id)
        setPendingDelete(null)
    }

    const createExpenseForType = async (typeId: string) => {
        const form = expenseForms[typeId]
        if (!form || !form.name.trim()) return
        if (!selectedOrgId) { setError('No organisation selected'); return }
        // validation for recurrence
        if (form.recurrenceRuleId) {
            const rr = recurrenceRules.find(r => r.id === form.recurrenceRuleId)
            const requiredSpec = rr?.required_details || {}
            const missing: string[] = []
            if (requiredSpec && typeof requiredSpec === 'object') {
                Object.entries(requiredSpec).forEach(([key, meta]: any) => {
                    if (meta?.required && (form.recurrenceDetails[key] === undefined || form.recurrenceDetails[key] === '')) missing.push(key)
                })
            }
            if ('dates' in requiredSpec) {
                const arr = form.recurrenceDetails.dates
                if (Array.isArray(arr)) {
                    arr.forEach((row: any, idx: number) => {
                        if (!row?.date) missing.push(`dates[${idx}].date`)
                        if (row?.amount === '' || row?.amount === undefined) missing.push(`dates[${idx}].amount`)
                    })
                }
            }
            if ('rates' in requiredSpec) {
                const arr = form.recurrenceDetails.rates
                if (Array.isArray(arr)) {
                    arr.forEach((row: any, idx: number) => {
                        if (row?.percent === '' || row?.percent === undefined) missing.push(`rates[${idx}].percent`)
                        if (!row?.budget_income_id) missing.push(`rates[${idx}].budget_income_id`)
                    })
                }
            }
            if ('budget_income_ids' in requiredSpec) {
                const ids = form.recurrenceDetails.budget_income_ids
                if (!Array.isArray(ids) || ids.length === 0) missing.push('budget_income_ids')
            }
            if (missing.length) { setError(`Missing recurrence fields: ${missing.join(', ')}`); return }
        }
        updateExpenseForm(typeId, { saving: true })
        const normDetails = form.recurrenceRuleId ? JSON.parse(JSON.stringify(form.recurrenceDetails)) : null
        if (normDetails) {
            if (typeof normDetails.amount === 'string') normDetails.amount = parseFloat(normDetails.amount).toFixed(2)
            if (typeof normDetails.percent === 'string') normDetails.percent = parseFloat(normDetails.percent).toFixed(2)
            if (Array.isArray(normDetails.dates)) normDetails.dates = normDetails.dates.map((d: any) => ({ ...d, amount: d.amount !== '' ? parseFloat(d.amount).toFixed(2) : d.amount }))
            if (Array.isArray(normDetails.rates)) normDetails.rates = normDetails.rates.map((r: any) => ({ ...r, percent: r.percent !== '' ? parseFloat(r.percent).toFixed(2) : r.percent }))
        }
        const insertPayload: any = {
            budget_id: budgetId,
            organisation_id: selectedOrgId,
            expense_name: form.name.trim(),
            accounting_code: form.code || null,
            description: form.desc || null,
            expense_type_id: typeId,
            recurrence_rule_id: form.recurrenceRuleId || null,
            recurrence_details: normDetails,
        }
        const { data, error } = await supabase.from('budget_expenses').insert(insertPayload).select('id, expense_name, description, accounting_code, expense_type_id, recurrence_rule_id, recurrence_details').maybeSingle()
        updateExpenseForm(typeId, { saving: false })
        if (error) { setError(error.message); return }
        if (data) {
            setExpenses(prev => [{ id: String(data.id), expense_name: data.expense_name as string, description: (data as any).description ?? null, accounting_code: (data as any).accounting_code ?? null, expense_type_id: (data as any).expense_type_id ?? null, recurrence_rule_id: (data as any).recurrence_rule_id ?? null, recurrence_details: (data as any).recurrence_details ?? null }, ...prev])
            updateExpenseForm(typeId, { name: '', code: '', desc: '', selectedRuleType: '', recurrenceRuleId: '', recurrenceDetails: {} })
        }
    }

    // Begin editing an expense
    const startEditingExpense = (exp: any) => {
        const rr = exp.recurrence_rule_id ? recurrenceRules.find(r => r.id === exp.recurrence_rule_id) : null
        const cloned = exp.recurrence_details ? JSON.parse(JSON.stringify(exp.recurrence_details)) : {}
        const withDefaults = buildDefaultRecurrenceDetails(exp.recurrence_rule_id, cloned)
        setEditingExpenseId(exp.id)
        setEditingForm({
            id: exp.id,
            expense_type_id: exp.expense_type_id || '',
            name: exp.expense_name || '',
            desc: exp.description || '',
            code: exp.accounting_code || '',
            selectedRuleType: rr?.rule_type || '',
            recurrenceRuleId: exp.recurrence_rule_id || '',
            recurrenceDetails: withDefaults,
        })
    }
    const cancelEditing = () => { setEditingExpenseId(null); setEditingForm(null); setSavingEdit(false) }
    const updateEditingField = (patch: any) => setEditingForm((prev: any) => ({ ...prev, ...patch }))
    const updateEditingRecurrenceDetail = (field: string, val: any) => setEditingForm((prev: any) => ({ ...prev, recurrenceDetails: { ...(prev?.recurrenceDetails || {}), [field]: val } }))

    const validateRecurrenceDetails = (ruleId: string, details: any): string[] => {
        const rr = recurrenceRules.find(r => r.id === ruleId)
        const requiredSpec = rr?.required_details || {}
        const missing: string[] = []
        if (requiredSpec && typeof requiredSpec === 'object') {
            Object.entries(requiredSpec).forEach(([key, meta]: any) => { if (meta?.required && (details[key] === undefined || details[key] === '')) missing.push(key) })
        }
        if ('dates' in requiredSpec) {
            const arr = details.dates
            if (Array.isArray(arr)) arr.forEach((row: any, idx: number) => { if (!row?.date) missing.push(`dates[${idx}].date`); if (row?.amount === '' || row?.amount === undefined) missing.push(`dates[${idx}].amount`) })
        }
        if ('rates' in requiredSpec) {
            const arr = details.rates
            if (Array.isArray(arr)) arr.forEach((row: any, idx: number) => { if (row?.percent === '' || row?.percent === undefined) missing.push(`rates[${idx}].percent`); if (!row?.budget_income_id) missing.push(`rates[${idx}].budget_income_id`) })
        }
        if ('budget_income_ids' in requiredSpec) {
            const ids = details.budget_income_ids
            if (!Array.isArray(ids) || ids.length === 0) missing.push('budget_income_ids')
        }
        return missing
    }

    const saveEditedExpense = async () => {
        if (!editingExpenseId || !editingForm) return
        if (!editingForm.name.trim()) { setError('Name required'); return }
        if (!selectedOrgId) { setError('No organisation selected'); return }
        if (editingForm.recurrenceRuleId) {
            const errs = validateRecurrenceDetails(editingForm.recurrenceRuleId, editingForm.recurrenceDetails)
            if (errs.length) { setError(`Missing recurrence fields: ${errs.join(', ')}`); return }
        }
        setSavingEdit(true)
        let normDetails = editingForm.recurrenceRuleId ? JSON.parse(JSON.stringify(editingForm.recurrenceDetails)) : null
        if (normDetails) {
            if (typeof normDetails.amount === 'string') normDetails.amount = parseFloat(normDetails.amount).toFixed(2)
            if (typeof normDetails.percent === 'string') normDetails.percent = parseFloat(normDetails.percent).toFixed(2)
            if (Array.isArray(normDetails.dates)) normDetails.dates = normDetails.dates.map((d: any) => ({ ...d, amount: d.amount !== '' ? parseFloat(d.amount).toFixed(2) : d.amount }))
            if (Array.isArray(normDetails.rates)) normDetails.rates = normDetails.rates.map((r: any) => ({ ...r, percent: r.percent !== '' ? parseFloat(r.percent).toFixed(2) : r.percent }))
        }
        const updatePayload: any = {
            expense_name: editingForm.name.trim(),
            description: editingForm.desc || null,
            accounting_code: editingForm.code || null,
            recurrence_rule_id: editingForm.recurrenceRuleId || null,
            recurrence_details: normDetails,
        }
        const { data, error } = await supabase.from('budget_expenses').update(updatePayload).eq('id', editingExpenseId).select('id, expense_name, description, accounting_code, expense_type_id, recurrence_rule_id, recurrence_details').maybeSingle()
        setSavingEdit(false)
        if (error) { setError(error.message); return }
        if (data) {
            setExpenses(prev => prev.map(e => e.id === editingExpenseId ? { id: String(data.id), expense_name: data.expense_name as string, description: (data as any).description ?? null, accounting_code: (data as any).accounting_code ?? null, expense_type_id: (data as any).expense_type_id ?? null, recurrence_rule_id: (data as any).recurrence_rule_id ?? null, recurrence_details: (data as any).recurrence_details ?? null } : e))
            cancelEditing()
        }
    }

    const deleteExpense = async (id: string) => {
        if (!id) return
        setDeletingExpenseId(id)
        const { error } = await supabase.from('budget_expenses').delete().eq('id', id)
        setDeletingExpenseId(null)
        if (error) { setError(error.message); return }
        setExpenses(prev => prev.filter(e => e.id !== id))
        if (editingExpenseId === id) cancelEditing()
    }

    // derive distinct rule types (global)
    const ruleTypes = Array.from(new Set(recurrenceRules.map(r => r.rule_type)))

    // map for income id -> name (for preview display)
    const incomeNameMap = useMemo(() => Object.fromEntries(incomes.map(i => [i.id, i.income_name])), [incomes])

    // helper utilities for recurrence defaults
    const isoDate = (d?: string | null) => {
        if (!d) return ''
        try { return new Date(d).toISOString().slice(0, 10) } catch { return '' }
    }
    const buildDefaultRecurrenceDetails = (ruleId: string | null | undefined, existing: any = {}) => {
        if (!ruleId) return existing || {}
        const rr = recurrenceRules.find(r => r.id === ruleId)
        if (!rr) return existing || {}
        const spec = rr.required_details || {}
        const wantsStart = 'start_date' in spec
        const wantsEnd = 'end_date' in spec || wantsStart
        const next = { ...(existing || {}) }
        if (wantsStart && !next.start_date && budget) next.start_date = isoDate(budget.period_start)
        if (wantsEnd && !next.end_date && budget) next.end_date = isoDate(budget.period_end)
        return next
    }

    // Numeric input guards (restrict to digits + single decimal point) ---------------------------------
    const allowNumericKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const allowedControl = ["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "Home", "End"]
        if (allowedControl.includes(e.key)) return
        // Allow one minus only at start (if needed in future) - currently we disallow negatives, so block '-'
        if (e.key === '-') { e.preventDefault(); return }
        const isDigit = /[0-9]/.test(e.key)
        const isDot = e.key === '.'
        if (!isDigit && !isDot) { e.preventDefault(); return }
        if (isDot && (e.currentTarget.value.includes('.') || !e.currentTarget.value.length)) {
            // Prevent multiple dots or leading dot
            e.preventDefault(); return
        }
    }
    const sanitizeNumericPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        const text = e.clipboardData.getData('text')
        if (!text) return
        if (!/^\d+(\.\d+)?$/.test(text.trim())) {
            e.preventDefault()
        }
    }
    const onBeforeInputNumeric = (e: React.FormEvent<HTMLInputElement>) => {
        // Some browsers fire beforeinput for virtual keyboards; keep simple validation
        const input = e.nativeEvent as InputEvent
        if (!input || typeof input.data !== 'string') return
        if (!/^[0-9.]$/.test(input.data)) (e as any).preventDefault?.()
    }

    const isNumericField = (field: string, meta: any) => {
        if (meta?.type === 'number') return true
        const lname = field.toLowerCase()
        return ['amount', 'percent', 'percentage', 'rate'].includes(lname)
    }

    // Ensure form state exists for each expense & income type when they load
    useEffect(() => { ensureFormsForTypes(expenseTypes) }, [expenseTypes])
    useEffect(() => { ensureIncomeFormsForTypes(incomeTypes) }, [incomeTypes])
    // Auto-assign fixed rule type and preselect frequency if only one fixed rule present
    useEffect(() => {
        const fixedRules = recurrenceRules.filter(r => r.rule_type === 'fixed')
        setIncomeForms(prev => {
            const next = { ...prev }
            Object.keys(next).forEach(k => {
                const f = next[k]
                if (f.selectedRuleType !== 'fixed') f.selectedRuleType = 'fixed'
                if (!f.recurrenceRuleId) {
                    // if exactly one fixed rule frequency or any - choose first
                    if (fixedRules.length > 0) {
                        f.recurrenceRuleId = fixedRules[0].id
                        f.recurrenceDetails = buildDefaultRecurrenceDetails(f.recurrenceRuleId, f.recurrenceDetails || {})
                    }
                }
            })
            return next
        })
    }, [recurrenceRules])

    // Handle auto-select of frequency and reset per form when selectedRuleType changes
    useEffect(() => {
        // For each form, if selectedRuleType changed we manage inside rendering via event handlers; no global effect here.
    }, [recurrenceRules])

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
                            <button disabled={generating} onClick={runGenerateBudgetItems} className="text-sm bg-yellow-500/10 border border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/20 px-3 py-1.5 rounded disabled:opacity-50 disabled:cursor-not-allowed">{generating ? 'Generating…' : 'Generate Budget Items'}</button>
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
                                {/* Incomes grouped by type */}
                                <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
                                    <h3 className="text-lg font-semibold text-gray-100 mb-3">Incomes by Type</h3>
                                    {!orgIndustry && <div className="text-gray-400 text-sm">Select an organisation to load income types.</div>}
                                    {orgIndustry && incomeTypes.length === 0 && <div className="text-gray-400 text-sm">No income types for industry.</div>}
                                    <div className="space-y-6">
                                        {incomeTypes.map(t => {
                                            const form = incomeForms[t.id] || initIncomeForm()
                                            const incomesForType = incomes.filter(i => i.income_type_id === t.id)
                                            const fixedFrequencies = recurrenceRules.filter(r => r.rule_type === 'fixed')
                                            return (
                                                <div key={t.id} className="border border-gray-800 rounded-lg p-3 bg-gray-900/50">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <div className="text-sm font-semibold text-gray-200">{t.name}</div>
                                                    </div>
                                                    <div className="space-y-2 mb-3">
                                                        <input value={form.name} onChange={e => updateIncomeForm(t.id, { name: e.target.value })} placeholder="Income name" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 text-sm" />
                                                        <input value={form.desc} onChange={e => updateIncomeForm(t.id, { desc: e.target.value })} placeholder="Description (optional)" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 text-sm" />
                                                        <input value={form.code} onChange={e => updateIncomeForm(t.id, { code: e.target.value })} placeholder="Accounting code (optional)" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 text-sm" />
                                                        {/* Recurrence (fixed only) */}
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                            <div>
                                                                <label className="block text-xs text-gray-300 mb-1">Recurrence Type</label>
                                                                <input value="fixed" disabled className="w-full bg-gray-800 text-gray-400 border border-gray-700 rounded-md px-3 py-2 text-sm" />
                                                            </div>
                                                            <div>
                                                                <label className="block text-xs text-gray-300 mb-1">Frequency</label>
                                                                <select value={form.recurrenceRuleId} onChange={e => { const rid = e.target.value; const defaults = buildDefaultRecurrenceDetails(rid, {}); updateIncomeForm(t.id, { recurrenceRuleId: rid, recurrenceDetails: defaults }) }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 text-sm">
                                                                    <option value="">None</option>
                                                                    {fixedFrequencies.map(r => <option key={r.id} value={r.id}>{r.frequency}</option>)}
                                                                </select>
                                                            </div>
                                                        </div>
                                                        <div className="text-[11px] text-gray-400">
                                                            {form.recurrenceRuleId ? <>Selected recurrence: <span className="text-gray-300">fixed</span> — <span className="text-gray-300">{fixedFrequencies.find(f => f.id === form.recurrenceRuleId)?.frequency || '...'}</span></> : 'No recurrence selected'}
                                                        </div>
                                                        {form.recurrenceRuleId && (() => {
                                                            const rr = recurrenceRules.find(r => r.id === form.recurrenceRuleId)
                                                            const specRaw = rr?.required_details || {}
                                                            const spec: any = { ...specRaw }
                                                            if ('start_date' in spec && !('end_date' in spec)) spec.end_date = { type: 'date', label: 'End Date', required: false }
                                                            let entries = Object.entries(spec)
                                                            const priority = ['start_date', 'end_date']
                                                            const pIndex = (k: string) => { const i = priority.indexOf(k); return i === -1 ? 999 : i }
                                                            entries = entries.sort((a: any, b: any) => { const pa = pIndex(a[0]); const pb = pIndex(b[0]); if (pa !== pb) return pa - pb; return a[0].localeCompare(b[0]) })
                                                            if (!entries.length) return null
                                                            return (
                                                                <div className="mt-1 space-y-2 border border-gray-800 rounded-md p-2 bg-gray-900/40">
                                                                    <div className="text-[10px] uppercase tracking-wide text-gray-400">Recurrence Details</div>
                                                                    {entries.map(([field, meta]: any) => {
                                                                        const type = meta?.type || 'string'
                                                                        const label = meta?.label || field
                                                                        const required = !!meta?.required
                                                                        const placeholder = meta?.placeholder || ''
                                                                        const value = form.recurrenceDetails[field] ?? ''
                                                                        const setField = (val: any) => updateIncomeForm(t.id, { recurrenceDetails: { ...form.recurrenceDetails, [field]: val } })
                                                                        if (field === 'dates') {
                                                                            const arr = Array.isArray(value) ? value : []
                                                                            return (
                                                                                <div key={field} className="space-y-1">
                                                                                    <div className="flex items-center justify-between">
                                                                                        <label className="block text-xs text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label>
                                                                                        <button type="button" onClick={() => setField([...arr, { date: '', amount: '' }])} className="text-xs text-yellow-400 hover:text-yellow-300">+ Add</button>
                                                                                    </div>
                                                                                    <div className="space-y-2">
                                                                                        {arr.length === 0 && <div className="text-xs text-gray-500">No dates added.</div>}
                                                                                        {arr.map((row: any, idx: number) => (
                                                                                            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                                                                                                <div className="col-span-5"><input type="date" value={row.date || ''} onChange={e => { const next = [...arr]; next[idx] = { ...next[idx], date: e.target.value }; setField(next) }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-2 py-1 text-sm" /></div>
                                                                                                <div className="col-span-5"><input type="text" inputMode="decimal" step="0.01" value={row.amount ?? ''} placeholder="Amount" onKeyDown={allowNumericKey} onPaste={sanitizeNumericPaste} onBeforeInput={onBeforeInputNumeric} onChange={e => { const next = [...arr]; next[idx] = { ...next[idx], amount: e.target.value }; setField(next) }} onBlur={e => { if (e.target.value !== '') { const next = [...arr]; next[idx] = { ...next[idx], amount: parseFloat(e.target.value).toFixed(2) }; setField(next) } }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-2 py-1 text-sm" /></div>
                                                                                                <div className="col-span-2 flex justify-end"><button type="button" onClick={() => { const next = arr.filter((_: any, i: number) => i !== idx); setField(next) }} className="text-xs text-red-400 hover:text-red-300">Remove</button></div>
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
                                                                                        <label className="block text-xs text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label>
                                                                                        <button type="button" onClick={() => setField([...arr, { percent: '', budget_income_id: '' }])} className="text-xs text-yellow-400 hover:text-yellow-300">+ Add</button>
                                                                                    </div>
                                                                                    <div className="space-y-2">
                                                                                        {arr.length === 0 && <div className="text-xs text-gray-500">No rates added.</div>}
                                                                                        {arr.map((row: any, idx: number) => (
                                                                                            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                                                                                                <div className="col-span-4"><input type="text" inputMode="decimal" step="0.01" value={row.percent ?? ''} placeholder="Percent" onKeyDown={allowNumericKey} onPaste={sanitizeNumericPaste} onBeforeInput={onBeforeInputNumeric} onChange={e => { const next = [...arr]; next[idx] = { ...next[idx], percent: e.target.value }; setField(next) }} onBlur={e => { if (e.target.value !== '') { const next = [...arr]; next[idx] = { ...next[idx], percent: parseFloat(e.target.value).toFixed(2) }; setField(next) } }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-2 py-1 text-sm" /></div>
                                                                                                <div className="col-span-6"><select value={row.budget_income_id || ''} onChange={e => { const next = [...arr]; next[idx] = { ...next[idx], budget_income_id: e.target.value }; setField(next) }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-2 py-1 text-sm"><option value="">Select income</option>{incomes.map(i => <option key={i.id} value={i.id}>{i.income_name}</option>)}</select></div>
                                                                                                <div className="col-span-2 flex justify-end"><button type="button" onClick={() => { const next = arr.filter((_: any, i: number) => i !== idx); setField(next) }} className="text-xs text-red-400 hover:text-red-300">Remove</button></div>
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
                                                                                                    <input type="checkbox" className="accent-yellow-400" checked={checked} onChange={() => { let next = [...selected]; if (checked) next = next.filter(id => id !== i.id); else next.push(i.id); setField(next) }} />
                                                                                                    <span>{i.income_name}</span>
                                                                                                </label>
                                                                                            )
                                                                                        })}
                                                                                    </div>
                                                                                </div>
                                                                            )
                                                                        }
                                                                        const commonProps = { className: 'w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-2 py-1 text-sm', value, onChange: (e: any) => setField(e.target.value) }
                                                                        if (type === 'select' && Array.isArray(meta?.options)) {
                                                                            return (
                                                                                <div key={field} className="space-y-1"><label className="block text-xs text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label><select {...commonProps}><option value="">{placeholder || 'Select...'}</option>{meta.options.map((opt: any) => <option key={opt.value || opt} value={opt.value || opt}>{opt.label || opt}</option>)}</select></div>
                                                                            )
                                                                        }
                                                                        if (type === 'number') {
                                                                            return (
                                                                                <div key={field} className="space-y-1"><label className="block text-xs text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label><input type="text" inputMode="decimal" step="0.01" placeholder={placeholder} {...commonProps} onKeyDown={allowNumericKey} onPaste={sanitizeNumericPaste} onBeforeInput={onBeforeInputNumeric} onBlur={e => { if (e.target.value !== '') setField(parseFloat(e.target.value).toFixed(2)) }} /></div>
                                                                            )
                                                                        }
                                                                        if (type === 'date' || field === 'start_date' || field === 'end_date') {
                                                                            return (
                                                                                <div key={field} className="space-y-1"><label className="block text-xs text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label><input type="date" {...commonProps} /></div>
                                                                            )
                                                                        }
                                                                        return (
                                                                            <div key={field} className="space-y-1"><label className="block text-xs text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label><input type="text" placeholder={placeholder} {...commonProps} {...(isNumericField(field, meta) ? { onKeyDown: allowNumericKey, onPaste: sanitizeNumericPaste, onBeforeInput: onBeforeInputNumeric, inputMode: 'decimal' } : {})} onBlur={e => { if (isNumericField(field, meta) && e.target.value !== '') setField(parseFloat(e.target.value).toFixed(2)) }} /></div>
                                                                        )
                                                                    })}
                                                                </div>
                                                            )
                                                        })()}
                                                        <button onClick={() => createIncomeForType(t.id)} disabled={form.saving || !form.name.trim()} className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-gray-900 px-3 py-2 rounded-md text-xs w-fit">{form.saving ? 'Saving…' : 'Add Income'}</button>
                                                    </div>
                                                    {incomesForType.length === 0 ? (
                                                        <div className="text-gray-500 text-xs">No incomes for this type.</div>
                                                    ) : (
                                                        <ul className="space-y-2">
                                                            {incomesForType.map(i => {
                                                                const isEditing = editingIncomeId === i.id
                                                                const recurSummary = i.recurrence_rule_id ? (() => { const rr = recurrenceRules.find(r => r.id === i.recurrence_rule_id); if (!rr) return 'Recurring'; return `${rr.rule_type}:${rr.frequency}` })() : null
                                                                if (isEditing && editingIncomeForm) {
                                                                    const rr = editingIncomeForm.recurrenceRuleId ? recurrenceRules.find(r => r.id === editingIncomeForm.recurrenceRuleId) : null
                                                                    const specRaw = rr?.required_details || {}
                                                                    const spec: any = { ...specRaw }
                                                                    if ('start_date' in spec && !('end_date' in spec)) spec.end_date = { type: 'date', label: 'End Date', required: false }
                                                                    let entries = Object.entries(spec)
                                                                    const priority = ['start_date', 'end_date']
                                                                    const pIndex = (k: string) => { const idx = priority.indexOf(k); return idx === -1 ? 999 : idx }
                                                                    entries = entries.sort((a: any, b: any) => { const pa = pIndex(a[0]); const pb = pIndex(b[0]); if (pa !== pb) return pa - pb; return a[0].localeCompare(b[0]) })
                                                                    return (
                                                                        <li key={i.id} className="p-2 rounded border border-yellow-600 bg-gray-900/70 space-y-2">
                                                                            <input value={editingIncomeForm.name} onChange={e => updateEditingIncomeField({ name: e.target.value })} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 text-[10px]" />
                                                                            <input value={editingIncomeForm.desc} onChange={e => updateEditingIncomeField({ desc: e.target.value })} placeholder="Description" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 text-[10px]" />
                                                                            <div className="grid grid-cols-2 gap-2">
                                                                                <div>
                                                                                    <label className="block text-[10px] text-gray-300 mb-0.5">Recurrence Type</label>
                                                                                    <input value="fixed" disabled className="w-full bg-gray-800 text-gray-400 border border-gray-700 rounded px-2 py-1 text-[10px]" />
                                                                                </div>
                                                                                <div>
                                                                                    <label className="block text-[10px] text-gray-300 mb-0.5">Frequency</label>
                                                                                    <select value={editingIncomeForm.recurrenceRuleId} onChange={e => { const rid = e.target.value; const defaults = buildDefaultRecurrenceDetails(rid, {}); updateEditingIncomeField({ recurrenceRuleId: rid, recurrenceDetails: defaults }) }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 text-[10px]">
                                                                                        <option value="">None</option>
                                                                                        {recurrenceRules.filter(r => r.rule_type === 'fixed').map(r => <option key={r.id} value={r.id}>{r.frequency}</option>)}
                                                                                    </select>
                                                                                </div>
                                                                            </div>
                                                                            {editingIncomeForm.recurrenceRuleId && !!entries.length && (
                                                                                <div className="space-y-2 border border-gray-800 rounded p-2 bg-gray-900/40">
                                                                                    <div className="text-[10px] uppercase tracking-wide text-gray-400">Recurrence Details</div>
                                                                                    {entries.map(([field, meta]: any) => {
                                                                                        const type = meta?.type || 'string'
                                                                                        const label = meta?.label || field
                                                                                        const required = !!meta?.required
                                                                                        const placeholder = meta?.placeholder || ''
                                                                                        const value = editingIncomeForm.recurrenceDetails[field] ?? ''
                                                                                        const setField = (val: any) => updateEditingIncomeRecurrenceDetail(field, val)
                                                                                        if (field === 'dates') {
                                                                                            const arr = Array.isArray(value) ? value : []
                                                                                            return (
                                                                                                <div key={field} className="space-y-1">
                                                                                                    <div className="flex items-center justify-between">
                                                                                                        <label className="block text-[10px] text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label>
                                                                                                        <button type="button" onClick={() => setField([...arr, { date: '', amount: '' }])} className="text-[10px] text-yellow-400 hover:text-yellow-300">+ Add</button>
                                                                                                    </div>
                                                                                                    <div className="space-y-2">
                                                                                                        {arr.length === 0 && <div className="text-[10px] text-gray-500">No dates.</div>}
                                                                                                        {arr.map((row: any, idx: number) => (
                                                                                                            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                                                                                                                <div className="col-span-5"><input type="date" value={row.date || ''} onChange={e => { const next = [...arr]; next[idx] = { ...next[idx], date: e.target.value }; setField(next) }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 text-[10px]" /></div>
                                                                                                                <div className="col-span-5"><input type="text" inputMode="decimal" step="0.01" value={row.amount ?? ''} placeholder="Amount" onKeyDown={allowNumericKey} onPaste={sanitizeNumericPaste} onBeforeInput={onBeforeInputNumeric} onChange={e => { const next = [...arr]; next[idx] = { ...next[idx], amount: e.target.value }; setField(next) }} onBlur={e => { if (e.target.value !== '') { const next = [...arr]; next[idx] = { ...next[idx], amount: parseFloat(e.target.value).toFixed(2) }; setField(next) } }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 text-[10px]" /></div>
                                                                                                                <div className="col-span-2 flex justify-end"><button type="button" onClick={() => { const next = arr.filter((_: any, i: number) => i !== idx); setField(next) }} className="text-[10px] text-red-400 hover:text-red-300">Remove</button></div>
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
                                                                                                        <label className="block text-[10px] text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label>
                                                                                                        <button type="button" onClick={() => setField([...arr, { percent: '', budget_income_id: '' }])} className="text-[10px] text-yellow-400 hover:text-yellow-300">+ Add</button>
                                                                                                    </div>
                                                                                                    <div className="space-y-2">
                                                                                                        {arr.length === 0 && <div className="text-[10px] text-gray-500">No rates.</div>}
                                                                                                        {arr.map((row: any, idx: number) => (
                                                                                                            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                                                                                                                <div className="col-span-4"><input type="text" inputMode="decimal" step="0.01" value={row.percent ?? ''} placeholder="Percent" onKeyDown={allowNumericKey} onPaste={sanitizeNumericPaste} onBeforeInput={onBeforeInputNumeric} onChange={e => { const next = [...arr]; next[idx] = { ...next[idx], percent: e.target.value }; setField(next) }} onBlur={e => { if (e.target.value !== '') { const next = [...arr]; next[idx] = { ...next[idx], percent: parseFloat(e.target.value).toFixed(2) }; setField(next) } }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 text-[10px]" /></div>
                                                                                                                <div className="col-span-6"><select value={row.budget_income_id || ''} onChange={e => { const next = [...arr]; next[idx] = { ...next[idx], budget_income_id: e.target.value }; setField(next) }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 text-[10px]"><option value="">Select income</option>{incomes.map(ii => <option key={ii.id} value={ii.id}>{ii.income_name}</option>)}</select></div>
                                                                                                                <div className="col-span-2 flex justify-end"><button type="button" onClick={() => { const next = arr.filter((_: any, i: number) => i !== idx); setField(next) }} className="text-[10px] text-red-400 hover:text-red-300">Remove</button></div>
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
                                                                                                    <label className="block text-[10px] text-gray-300">{label || 'Linked Incomes'}{required && <span className="text-red-400">*</span>}</label>
                                                                                                    <div className="space-y-1 max-h-32 overflow-auto pr-1 border border-gray-800 rounded p-2 bg-gray-900/30">
                                                                                                        {incomes.length === 0 && <div className="text-[10px] text-gray-500">No incomes.</div>}
                                                                                                        {incomes.map(ii => {
                                                                                                            const checked = selected.includes(ii.id)
                                                                                                            return (
                                                                                                                <label key={ii.id} className="flex items-center gap-1 text-[10px] text-gray-300 cursor-pointer">
                                                                                                                    <input type="checkbox" className="accent-yellow-400" checked={checked} onChange={() => { let next = [...selected]; if (checked) next = next.filter(id => id !== ii.id); else next.push(ii.id); setField(next) }} />
                                                                                                                    <span>{ii.income_name}</span>
                                                                                                                </label>
                                                                                                            )
                                                                                                        })}
                                                                                                    </div>
                                                                                                </div>
                                                                                            )
                                                                                        }
                                                                                        const commonProps = { className: 'w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 text-[10px]', value, onChange: (e: any) => setField(e.target.value) }
                                                                                        if (type === 'select' && Array.isArray(meta?.options)) return <div key={field} className="space-y-0.5"><label className="block text-[10px] text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label><select {...commonProps}><option value="">{placeholder || 'Select...'}</option>{meta.options.map((opt: any) => <option key={opt.value || opt} value={opt.value || opt}>{opt.label || opt}</option>)}</select></div>
                                                                                        if (type === 'number') return <div key={field} className="space-y-0.5"><label className="block text-[10px] text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label><input type="text" inputMode="decimal" step="0.01" placeholder={placeholder} {...commonProps} onKeyDown={allowNumericKey} onPaste={sanitizeNumericPaste} onBeforeInput={onBeforeInputNumeric} onBlur={e => { if (e.target.value !== '') setField(parseFloat(e.target.value).toFixed(2)) }} /></div>
                                                                                        if (type === 'date' || field === 'start_date' || field === 'end_date') return <div key={field} className="space-y-0.5"><label className="block text-[10px] text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label><input type="date" {...commonProps} /></div>
                                                                                        return <div key={field} className="space-y-0.5"><label className="block text-[10px] text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label><input type="text" placeholder={placeholder} {...commonProps} {...(isNumericField(field, meta) ? { onKeyDown: allowNumericKey, onPaste: sanitizeNumericPaste, onBeforeInput: onBeforeInputNumeric, inputMode: 'decimal' } : {})} onBlur={e => { if (isNumericField(field, meta) && e.target.value !== '') setField(parseFloat(e.target.value).toFixed(2)) }} /></div>
                                                                                    })}
                                                                                </div>
                                                                            )}
                                                                            <input value={editingIncomeForm.code} onChange={e => updateEditingIncomeField({ code: e.target.value })} placeholder="Accounting code" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 text-[10px]" />
                                                                            <div className="flex gap-2 justify-end pt-1">
                                                                                <button onClick={cancelEditingIncome} className="text-[10px] text-gray-400 hover:text-gray-300">Cancel</button>
                                                                                <button onClick={saveEditedIncome} disabled={savingIncomeEdit} className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-gray-900 px-2 py-1 rounded text-[10px]">{savingIncomeEdit ? 'Saving…' : 'Save'}</button>
                                                                            </div>
                                                                        </li>
                                                                    )
                                                                }
                                                                return (
                                                                    <li key={i.id} className="p-2 rounded border border-gray-800 bg-gray-900/60">
                                                                        <div className="flex justify-between items-start gap-2">
                                                                            <div>
                                                                                <div className="text-gray-100 text-sm">{i.income_name}</div>
                                                                                {(i.accounting_code || i.description || recurSummary) && <div className="text-gray-400 text-[10px] mt-1">{[i.accounting_code, i.description, recurSummary].filter(Boolean).join(' · ')}</div>}
                                                                            </div>
                                                                            <div className="flex items-center gap-2">
                                                                                <button onClick={() => startEditingIncome(i)} className="text-[10px] text-yellow-400 hover:text-yellow-300">Edit</button>
                                                                                <button onClick={() => setPendingDelete({ type: 'income', id: i.id })} disabled={deletingIncomeId === i.id} className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-50">{deletingIncomeId === i.id ? 'Deleting…' : 'Delete'}</button>
                                                                            </div>
                                                                        </div>
                                                                        {i.recurrence_rule_id && i.recurrence_details && (() => {
                                                                            try {
                                                                                const d = i.recurrence_details
                                                                                if (!d || typeof d !== 'object') return null
                                                                                const entries = Object.entries(d)
                                                                                if (!entries.length) return null
                                                                                return (
                                                                                    <div className="mt-1 text-[10px] text-gray-500 space-y-0.5">
                                                                                        {entries.map(([k, v]: any) => <div key={k}><span className="text-gray-600">{k}:</span> {Array.isArray(v) ? JSON.stringify(v) : String(v)}</div>)}
                                                                                    </div>
                                                                                )
                                                                            } catch { return null }
                                                                        })()}
                                                                    </li>
                                                                )
                                                            })}
                                                        </ul>
                                                    )}
                                                </div>
                                            )
                                        })}
                                        {incomes.filter(i => !i.income_type_id).length > 0 && (
                                            <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/50">
                                                <div className="text-sm font-semibold text-gray-200 mb-2">Uncategorized</div>
                                                <ul className="space-y-2">
                                                    {incomes.filter(i => !i.income_type_id).map(i => (
                                                        <li key={i.id} className="p-2 rounded border border-gray-800 bg-gray-900/60">
                                                            <div className="flex justify-between items-start gap-2">
                                                                <div>
                                                                    <div className="text-gray-100 text-sm">{i.income_name}</div>
                                                                    {(i.accounting_code || i.description) && <div className="text-gray-400 text-[10px] mt-1">{[i.accounting_code, i.description].filter(Boolean).join(' · ')}</div>}
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <button onClick={() => startEditingIncome(i)} className="text-[10px] text-yellow-400 hover:text-yellow-300">Edit</button>
                                                                    <button onClick={() => setPendingDelete({ type: 'income', id: i.id })} disabled={deletingIncomeId === i.id} className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-50">{deletingIncomeId === i.id ? 'Deleting…' : 'Delete'}</button>
                                                                </div>
                                                            </div>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Expenses Grouped By Type */}
                                <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
                                    <h3 className="text-lg font-semibold text-gray-100 mb-3">Expenses by Type</h3>
                                    {!orgIndustry && <div className="text-gray-400 text-sm">Select an organisation to load expense types.</div>}
                                    {orgIndustry && expenseTypes.length === 0 && <div className="text-gray-400 text-sm">No expense types for industry.</div>}
                                    <div className="space-y-6">
                                        {expenseTypes.map(t => {
                                            const form = expenseForms[t.id] || initFormState()
                                            const frequenciesForType = recurrenceRules.filter(r => r.rule_type === form.selectedRuleType)
                                            const expensesForType = expenses.filter(e => e.expense_type_id === t.id)
                                            return (
                                                <div key={t.id} className="border border-gray-800 rounded-lg p-3 bg-gray-900/50">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <div className="text-sm font-semibold text-gray-200">{t.name}</div>
                                                    </div>
                                                    {/* Form */}
                                                    <div className="space-y-2 mb-3">
                                                        <input value={form.name} onChange={e => updateExpenseForm(t.id, { name: e.target.value })} placeholder="Expense name" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 text-sm" />
                                                        <input value={form.desc} onChange={e => updateExpenseForm(t.id, { desc: e.target.value })} placeholder="Description (optional)" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 text-sm" />
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                            <div>
                                                                <label className="block text-xs text-gray-300 mb-1">Recurrence Type</label>
                                                                <select value={form.selectedRuleType} onChange={e => {
                                                                    const sel = e.target.value
                                                                    let autoRule = ''
                                                                    if (sel) {
                                                                        const list = recurrenceRules.filter(r => r.rule_type === sel)
                                                                        if (list.length === 1) autoRule = list[0].id
                                                                    }
                                                                    const defaults = buildDefaultRecurrenceDetails(autoRule, {})
                                                                    updateExpenseForm(t.id, { selectedRuleType: sel, recurrenceRuleId: autoRule, recurrenceDetails: defaults })
                                                                }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 text-sm">
                                                                    <option value="">None</option>
                                                                    {ruleTypes.map(rt => <option key={rt} value={rt}>{rt}</option>)}
                                                                </select>
                                                            </div>
                                                            <div>
                                                                <label className="block text-xs text-gray-300 mb-1">Frequency</label>
                                                                <select value={form.recurrenceRuleId} onChange={e => { const rid = e.target.value; const defaults = buildDefaultRecurrenceDetails(rid, {}); updateExpenseForm(t.id, { recurrenceRuleId: rid, recurrenceDetails: defaults }) }} disabled={!form.selectedRuleType} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 text-sm disabled:opacity-50">
                                                                    <option value="">{form.selectedRuleType ? 'Select frequency' : 'Choose type first'}</option>
                                                                    {frequenciesForType.map(r => <option key={r.id} value={r.id}>{r.frequency}</option>)}
                                                                </select>
                                                            </div>
                                                        </div>
                                                        <div className="text-[11px] text-gray-400">
                                                            {form.selectedRuleType ? (
                                                                form.recurrenceRuleId ? (
                                                                    <>Selected recurrence: <span className="text-gray-300">{form.selectedRuleType}</span> — <span className="text-gray-300">{frequenciesForType.find(f => f.id === form.recurrenceRuleId)?.frequency || '...'}</span></>
                                                                ) : <>Selected type: <span className="text-gray-300">{form.selectedRuleType}</span> (choose a frequency)</>
                                                            ) : 'No recurrence selected'}
                                                        </div>
                                                        {form.recurrenceRuleId && (() => {
                                                            const rr = recurrenceRules.find(r => r.id === form.recurrenceRuleId)
                                                            const specRaw = rr?.required_details || {}
                                                            const spec: any = { ...specRaw }
                                                            if ('start_date' in spec && !('end_date' in spec)) spec.end_date = { type: 'date', label: 'End Date', required: false }
                                                            let entries = Object.entries(spec)
                                                            const priority = ['start_date', 'end_date']
                                                            const pIndex = (k: string) => { const i = priority.indexOf(k); return i === -1 ? 999 : i }
                                                            entries = entries.sort((a: any, b: any) => { const pa = pIndex(a[0]); const pb = pIndex(b[0]); if (pa !== pb) return pa - pb; return a[0].localeCompare(b[0]) })
                                                            if (!entries.length) return null
                                                            return (
                                                                <div className="mt-1 space-y-2 border border-gray-800 rounded-md p-2 bg-gray-900/40">
                                                                    <div className="text-[10px] uppercase tracking-wide text-gray-400">Recurrence Details</div>
                                                                    {entries.map(([field, meta]: any) => {
                                                                        const type = meta?.type || 'string'
                                                                        const label = meta?.label || field
                                                                        const required = !!meta?.required
                                                                        const placeholder = meta?.placeholder || ''
                                                                        const value = form.recurrenceDetails[field] ?? ''
                                                                        const setField = (val: any) => updateExpenseForm(t.id, { recurrenceDetails: { ...form.recurrenceDetails, [field]: val } })
                                                                        if (field === 'dates') {
                                                                            const arr = Array.isArray(value) ? value : []
                                                                            return (
                                                                                <div key={field} className="space-y-1">
                                                                                    <div className="flex items-center justify-between">
                                                                                        <label className="block text-xs text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label>
                                                                                        <button type="button" onClick={() => setField([...arr, { date: '', amount: '' }])} className="text-xs text-yellow-400 hover:text-yellow-300">+ Add</button>
                                                                                    </div>
                                                                                    <div className="space-y-2">
                                                                                        {arr.length === 0 && <div className="text-xs text-gray-500">No dates added.</div>}
                                                                                        {arr.map((row: any, idx: number) => (
                                                                                            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                                                                                                <div className="col-span-5"><input type="date" value={row.date || ''} onChange={e => { const next = [...arr]; next[idx] = { ...next[idx], date: e.target.value }; setField(next) }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-2 py-1 text-sm" /></div>
                                                                                                <div className="col-span-5"><input type="text" inputMode="decimal" step="0.01" value={row.amount ?? ''} placeholder="Amount" onKeyDown={allowNumericKey} onPaste={sanitizeNumericPaste} onBeforeInput={onBeforeInputNumeric} onChange={e => { const next = [...arr]; next[idx] = { ...next[idx], amount: e.target.value }; setField(next) }} onBlur={e => { if (e.target.value !== '') { const next = [...arr]; next[idx] = { ...next[idx], amount: parseFloat(e.target.value).toFixed(2) }; setField(next) } }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-2 py-1 text-sm" /></div>
                                                                                                <div className="col-span-2 flex justify-end"><button type="button" onClick={() => { const next = arr.filter((_: any, i: number) => i !== idx); setField(next) }} className="text-xs text-red-400 hover:text-red-300">Remove</button></div>
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
                                                                                        <label className="block text-xs text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label>
                                                                                        <button type="button" onClick={() => setField([...arr, { percent: '', budget_income_id: '' }])} className="text-xs text-yellow-400 hover:text-yellow-300">+ Add</button>
                                                                                    </div>
                                                                                    <div className="space-y-2">
                                                                                        {arr.length === 0 && <div className="text-xs text-gray-500">No rates added.</div>}
                                                                                        {arr.map((row: any, idx: number) => (
                                                                                            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                                                                                                <div className="col-span-4"><input type="text" inputMode="decimal" step="0.01" value={row.percent ?? ''} placeholder="Percent" onKeyDown={allowNumericKey} onPaste={sanitizeNumericPaste} onBeforeInput={onBeforeInputNumeric} onChange={e => { const next = [...arr]; next[idx] = { ...next[idx], percent: e.target.value }; setField(next) }} onBlur={e => { if (e.target.value !== '') { const next = [...arr]; next[idx] = { ...next[idx], percent: parseFloat(e.target.value).toFixed(2) }; setField(next) } }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-2 py-1 text-sm" /></div>
                                                                                                <div className="col-span-6"><select value={row.budget_income_id || ''} onChange={e => { const next = [...arr]; next[idx] = { ...next[idx], budget_income_id: e.target.value }; setField(next) }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-2 py-1 text-sm"><option value="">Select income</option>{incomes.map(i => <option key={i.id} value={i.id}>{i.income_name}</option>)}</select></div>
                                                                                                <div className="col-span-2 flex justify-end"><button type="button" onClick={() => { const next = arr.filter((_: any, i: number) => i !== idx); setField(next) }} className="text-xs text-red-400 hover:text-red-300">Remove</button></div>
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
                                                                                                        let next = [...selected]; if (checked) next = next.filter(id => id !== i.id); else next.push(i.id); setField(next)
                                                                                                    }} />
                                                                                                    <span>{i.income_name}</span>
                                                                                                </label>
                                                                                            )
                                                                                        })}
                                                                                    </div>
                                                                                </div>
                                                                            )
                                                                        }
                                                                        const commonProps = { className: 'w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-2 py-1 text-sm', value, onChange: (e: any) => setField(e.target.value) }
                                                                        if (type === 'select' && Array.isArray(meta?.options)) {
                                                                            return (
                                                                                <div key={field} className="space-y-1"><label className="block text-xs text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label><select {...commonProps}><option value="">{placeholder || 'Select...'}</option>{meta.options.map((opt: any) => <option key={opt.value || opt} value={opt.value || opt}>{opt.label || opt}</option>)}</select></div>
                                                                            )
                                                                        }
                                                                        if (type === 'number') {
                                                                            return (
                                                                                <div key={field} className="space-y-1"><label className="block text-xs text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label><input type="text" inputMode="decimal" step="0.01" placeholder={placeholder} {...commonProps} onKeyDown={allowNumericKey} onPaste={sanitizeNumericPaste} onBeforeInput={onBeforeInputNumeric} onBlur={e => { if (e.target.value !== '') setField(parseFloat(e.target.value).toFixed(2)) }} /></div>
                                                                            )
                                                                        }
                                                                        if (type === 'date' || field === 'start_date' || field === 'end_date') {
                                                                            return (
                                                                                <div key={field} className="space-y-1"><label className="block text-xs text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label><input type="date" {...commonProps} /></div>
                                                                            )
                                                                        }
                                                                        return (
                                                                            <div key={field} className="space-y-1">
                                                                                <label className="block text-xs text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label>
                                                                                <input
                                                                                    type="text"
                                                                                    placeholder={placeholder}
                                                                                    {...commonProps}
                                                                                    {...(isNumericField(field, meta) ? { onKeyDown: allowNumericKey, onPaste: sanitizeNumericPaste, onBeforeInput: onBeforeInputNumeric, inputMode: 'decimal' } : {})}
                                                                                    onBlur={e => { if (isNumericField(field, meta) && e.target.value !== '') setField(parseFloat(e.target.value).toFixed(2)) }}
                                                                                />
                                                                            </div>
                                                                        )
                                                                    })}
                                                                </div>
                                                            )
                                                        })()}
                                                        <input value={form.code} onChange={e => updateExpenseForm(t.id, { code: e.target.value })} placeholder="Accounting code (optional)" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 text-sm" />
                                                        <button onClick={() => createExpenseForType(t.id)} disabled={form.saving || !form.name.trim()} className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-gray-900 px-3 py-2 rounded-md text-xs w-fit">{form.saving ? 'Saving…' : 'Add Expense'}</button>
                                                    </div>
                                                    {/* Existing expenses for this type */}
                                                    {expensesForType.length === 0 ? (
                                                        <div className="text-gray-500 text-xs">No expenses for this type.</div>
                                                    ) : (
                                                        <ul className="space-y-2">
                                                            {expensesForType.map(x => {
                                                                const isEditing = editingExpenseId === x.id
                                                                if (isEditing && editingForm) {
                                                                    const rr = editingForm.recurrenceRuleId ? recurrenceRules.find(r => r.id === editingForm.recurrenceRuleId) : null
                                                                    const specRaw = rr?.required_details || {}
                                                                    const spec: any = { ...specRaw }
                                                                    if ('start_date' in spec && !('end_date' in spec)) spec.end_date = { type: 'date', label: 'End Date', required: false }
                                                                    let entries = Object.entries(spec)
                                                                    const priority = ['start_date', 'end_date']
                                                                    const pIndex = (k: string) => { const i = priority.indexOf(k); return i === -1 ? 999 : i }
                                                                    entries = entries.sort((a: any, b: any) => { const pa = pIndex(a[0]); const pb = pIndex(b[0]); if (pa !== pb) return pa - pb; return a[0].localeCompare(b[0]) })
                                                                    return (
                                                                        <li key={x.id} className="p-2 rounded border border-yellow-600 bg-gray-900/70 space-y-2">
                                                                            <input value={editingForm.name} onChange={e => updateEditingField({ name: e.target.value })} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 text-xs" />
                                                                            <input value={editingForm.desc} onChange={e => updateEditingField({ desc: e.target.value })} placeholder="Description" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 text-xs" />
                                                                            <div className="grid grid-cols-2 gap-2">
                                                                                <div>
                                                                                    <label className="block text-[10px] text-gray-300 mb-0.5">Recurrence Type</label>
                                                                                    <select value={editingForm.selectedRuleType} onChange={e => {
                                                                                        const sel = e.target.value
                                                                                        let autoRule = ''
                                                                                        if (sel) { const list = recurrenceRules.filter(r => r.rule_type === sel); if (list.length === 1) autoRule = list[0].id }
                                                                                        const defaults = buildDefaultRecurrenceDetails(autoRule, {})
                                                                                        updateEditingField({ selectedRuleType: sel, recurrenceRuleId: autoRule, recurrenceDetails: defaults })
                                                                                    }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 text-xs">
                                                                                        <option value="">None</option>
                                                                                        {ruleTypes.map(rt => <option key={rt} value={rt}>{rt}</option>)}
                                                                                    </select>
                                                                                </div>
                                                                                <div>
                                                                                    <label className="block text-[10px] text-gray-300 mb-0.5">Frequency</label>
                                                                                    <select value={editingForm.recurrenceRuleId} onChange={e => { const rid = e.target.value; const defaults = buildDefaultRecurrenceDetails(rid, {}); updateEditingField({ recurrenceRuleId: rid, recurrenceDetails: defaults }) }} disabled={!editingForm.selectedRuleType} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 text-xs disabled:opacity-50">
                                                                                        <option value="">{editingForm.selectedRuleType ? 'Select frequency' : 'Choose type first'}</option>
                                                                                        {recurrenceRules.filter(r => r.rule_type === editingForm.selectedRuleType).map(r => <option key={r.id} value={r.id}>{r.frequency}</option>)}
                                                                                    </select>
                                                                                </div>
                                                                            </div>
                                                                            {editingForm.selectedRuleType && <div className="text-[10px] text-gray-400">{editingForm.recurrenceRuleId ? <>Selected: {editingForm.selectedRuleType}:{recurrenceRules.find(r => r.id === editingForm.recurrenceRuleId)?.frequency}</> : <>Type: {editingForm.selectedRuleType} (choose frequency)</>}</div>}
                                                                            {editingForm.recurrenceRuleId && !!entries.length && (
                                                                                <div className="space-y-2 border border-gray-800 rounded p-2 bg-gray-900/40">
                                                                                    <div className="text-[10px] uppercase tracking-wide text-gray-400">Recurrence Details</div>
                                                                                    {entries.map(([field, meta]: any) => {
                                                                                        const type = meta?.type || 'string'
                                                                                        const label = meta?.label || field
                                                                                        const required = !!meta?.required
                                                                                        const placeholder = meta?.placeholder || ''
                                                                                        const value = editingForm.recurrenceDetails[field] ?? ''
                                                                                        const setField = (val: any) => updateEditingRecurrenceDetail(field, val)
                                                                                        if (field === 'dates') {
                                                                                            const arr = Array.isArray(value) ? value : []
                                                                                            return (
                                                                                                <div key={field} className="space-y-1">
                                                                                                    <div className="flex items-center justify-between">
                                                                                                        <label className="block text-[10px] text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label>
                                                                                                        <button type="button" onClick={() => setField([...arr, { date: '', amount: '' }])} className="text-[10px] text-yellow-400 hover:text-yellow-300">+ Add</button>
                                                                                                    </div>
                                                                                                    <div className="space-y-2">
                                                                                                        {arr.length === 0 && <div className="text-[10px] text-gray-500">No dates.</div>}
                                                                                                        {arr.map((row: any, idx: number) => (
                                                                                                            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                                                                                                                <div className="col-span-5"><input type="date" value={row.date || ''} onChange={e => { const next = [...arr]; next[idx] = { ...next[idx], date: e.target.value }; setField(next) }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 text-[10px]" /></div>
                                                                                                                <div className="col-span-5"><input type="text" inputMode="decimal" step="0.01" value={row.amount ?? ''} placeholder="Amount" onKeyDown={allowNumericKey} onPaste={sanitizeNumericPaste} onBeforeInput={onBeforeInputNumeric} onChange={e => { const next = [...arr]; next[idx] = { ...next[idx], amount: e.target.value }; setField(next) }} onBlur={e => { if (e.target.value !== '') { const next = [...arr]; next[idx] = { ...next[idx], amount: parseFloat(e.target.value).toFixed(2) }; setField(next) } }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 text-[10px]" /></div>
                                                                                                                <div className="col-span-2 flex justify-end"><button type="button" onClick={() => { const next = arr.filter((_: any, i: number) => i !== idx); setField(next) }} className="text-[10px] text-red-400 hover:text-red-300">Remove</button></div>
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
                                                                                                        <label className="block text-[10px] text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label>
                                                                                                        <button type="button" onClick={() => setField([...arr, { percent: '', budget_income_id: '' }])} className="text-[10px] text-yellow-400 hover:text-yellow-300">+ Add</button>
                                                                                                    </div>
                                                                                                    <div className="space-y-2">
                                                                                                        {arr.length === 0 && <div className="text-[10px] text-gray-500">No rates.</div>}
                                                                                                        {arr.map((row: any, idx: number) => (
                                                                                                            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                                                                                                                <div className="col-span-4"><input type="text" inputMode="decimal" step="0.01" value={row.percent ?? ''} placeholder="Percent" onKeyDown={allowNumericKey} onPaste={sanitizeNumericPaste} onBeforeInput={onBeforeInputNumeric} onChange={e => { const next = [...arr]; next[idx] = { ...next[idx], percent: e.target.value }; setField(next) }} onBlur={e => { if (e.target.value !== '') { const next = [...arr]; next[idx] = { ...next[idx], percent: parseFloat(e.target.value).toFixed(2) }; setField(next) } }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 text-[10px]" /></div>
                                                                                                                <div className="col-span-6"><select value={row.budget_income_id || ''} onChange={e => { const next = [...arr]; next[idx] = { ...next[idx], budget_income_id: e.target.value }; setField(next) }} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 text-[10px]"><option value="">Select income</option>{incomes.map(i => <option key={i.id} value={i.id}>{i.income_name}</option>)}</select></div>
                                                                                                                <div className="col-span-2 flex justify-end"><button type="button" onClick={() => { const next = arr.filter((_: any, i: number) => i !== idx); setField(next) }} className="text-[10px] text-red-400 hover:text-red-300">Remove</button></div>
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
                                                                                                    <label className="block text-[10px] text-gray-300">{label || 'Linked Incomes'}{required && <span className="text-red-400">*</span>}</label>
                                                                                                    <div className="space-y-1 max-h-32 overflow-auto pr-1 border border-gray-800 rounded p-2 bg-gray-900/30">
                                                                                                        {incomes.length === 0 && <div className="text-[10px] text-gray-500">No incomes.</div>}
                                                                                                        {incomes.map(i => {
                                                                                                            const checked = selected.includes(i.id)
                                                                                                            return (
                                                                                                                <label key={i.id} className="flex items-center gap-1 text-[10px] text-gray-300 cursor-pointer">
                                                                                                                    <input type="checkbox" className="accent-yellow-400" checked={checked} onChange={() => { let next = [...selected]; if (checked) next = next.filter(id => id !== i.id); else next.push(i.id); setField(next) }} />
                                                                                                                    <span>{i.income_name}</span>
                                                                                                                </label>
                                                                                                            )
                                                                                                        })}
                                                                                                    </div>
                                                                                                </div>
                                                                                            )
                                                                                        }
                                                                                        const commonProps = { className: 'w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 text-[10px]', value, onChange: (e: any) => setField(e.target.value) }
                                                                                        if (type === 'select' && Array.isArray(meta?.options)) return <div key={field} className="space-y-0.5"><label className="block text-[10px] text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label><select {...commonProps}><option value="">{placeholder || 'Select...'}</option>{meta.options.map((opt: any) => <option key={opt.value || opt} value={opt.value || opt}>{opt.label || opt}</option>)}</select></div>
                                                                                        if (type === 'number') return <div key={field} className="space-y-0.5"><label className="block text-[10px] text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label><input type="text" inputMode="decimal" step="0.01" placeholder={placeholder} {...commonProps} onKeyDown={allowNumericKey} onPaste={sanitizeNumericPaste} onBeforeInput={onBeforeInputNumeric} onBlur={e => { if (e.target.value !== '') setField(parseFloat(e.target.value).toFixed(2)) }} /></div>
                                                                                        if (type === 'date' || field === 'start_date' || field === 'end_date') return <div key={field} className="space-y-0.5"><label className="block text-[10px] text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label><input type="date" {...commonProps} /></div>
                                                                                        return <div key={field} className="space-y-0.5"><label className="block text-[10px] text-gray-300">{label}{required && <span className="text-red-400">*</span>}</label><input type="text" placeholder={placeholder} {...commonProps} {...(isNumericField(field, meta) ? { onKeyDown: allowNumericKey, onPaste: sanitizeNumericPaste, onBeforeInput: onBeforeInputNumeric, inputMode: 'decimal' } : {})} onBlur={e => { if (isNumericField(field, meta) && e.target.value !== '') setField(parseFloat(e.target.value).toFixed(2)) }} /></div>
                                                                                    })}
                                                                                </div>
                                                                            )}
                                                                            <input value={editingForm.code} onChange={e => updateEditingField({ code: e.target.value })} placeholder="Accounting code" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 text-[10px]" />
                                                                            <div className="flex gap-2 justify-end pt-1">
                                                                                <button onClick={cancelEditing} className="text-[10px] text-gray-400 hover:text-gray-300">Cancel</button>
                                                                                <button onClick={saveEditedExpense} disabled={savingEdit} className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-gray-900 px-2 py-1 rounded text-[10px]">{savingEdit ? 'Saving…' : 'Save'}</button>
                                                                            </div>
                                                                        </li>
                                                                    )
                                                                }
                                                                // Non-editing preview item
                                                                return (
                                                                    <li key={x.id} className="p-2 rounded border border-gray-800 bg-gray-900/60">
                                                                        <div className="flex justify-between items-start gap-2">
                                                                            <div>
                                                                                <div className="text-gray-100 text-sm">{x.expense_name}</div>
                                                                                {(x.accounting_code || x.description || x.recurrence_rule_id) && (
                                                                                    <div className="text-gray-400 text-[10px] mt-1">{[
                                                                                        x.accounting_code,
                                                                                        x.description,
                                                                                        x.recurrence_rule_id ? (() => { const rr = recurrenceRules.find(r => r.id === x.recurrence_rule_id); return rr ? `${rr.rule_type}:${rr.frequency}` : 'Recurring'; })() : null,
                                                                                    ].filter(Boolean).join(' · ')}</div>
                                                                                )}
                                                                            </div>
                                                                            <div className="flex items-center gap-2">
                                                                                <button onClick={() => startEditingExpense(x)} className="text-[10px] text-yellow-400 hover:text-yellow-300">Edit</button>
                                                                                <button onClick={() => setPendingDelete({ type: 'expense', id: x.id })} disabled={deletingExpenseId === x.id} className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-50">{deletingExpenseId === x.id ? 'Deleting…' : 'Delete'}</button>
                                                                            </div>
                                                                        </div>
                                                                        {x.recurrence_rule_id && (x as any).recurrence_details && (() => {
                                                                            try {
                                                                                const d = (x as any).recurrence_details
                                                                                if (!d || typeof d !== 'object') return null
                                                                                const entries = Object.entries(d)
                                                                                if (!entries.length) return null
                                                                                const renderVal = (k: string, v: any) => {
                                                                                    if (k === 'budget_income_ids' && Array.isArray(v)) return v.map((id: string) => incomeNameMap[id] || id).join(', ')
                                                                                    if (k === 'rates' && Array.isArray(v)) {
                                                                                        return v.map((row: any) => {
                                                                                            const nm = row.budget_income_id ? (incomeNameMap[row.budget_income_id] || row.budget_income_id) : ''
                                                                                            const pct = row.percent !== undefined && row.percent !== '' ? `${row.percent}%` : ''
                                                                                            return [pct, nm && `of ${nm}`].filter(Boolean).join(' ')
                                                                                        }).join('; ')
                                                                                    }
                                                                                    if (k === 'dates' && Array.isArray(v)) {
                                                                                        return v.map((row: any) => `${row.date || '?'}=${row.amount ?? ''}`).join('; ')
                                                                                    }
                                                                                    if (Array.isArray(v)) return JSON.stringify(v)
                                                                                    return String(v)
                                                                                }
                                                                                return (
                                                                                    <div className="mt-1 text-[10px] text-gray-400 space-y-0.5">
                                                                                        {entries.map(([k, v]: any) => (
                                                                                            <div key={k}><span className="text-gray-500">{k}:</span> {renderVal(k, v)}</div>
                                                                                        ))}
                                                                                    </div>
                                                                                )
                                                                            } catch { return null }
                                                                        })()}
                                                                    </li>
                                                                )
                                                            })}
                                                        </ul>
                                                    )}
                                                </div>
                                            )
                                        })}
                                        {/* Uncategorized expenses (edge case) */}
                                        {expenses.filter(e => !e.expense_type_id).length > 0 && (
                                            <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/50">
                                                <div className="text-sm font-semibold text-gray-200 mb-2">Uncategorized</div>
                                                <ul className="space-y-2">
                                                    {expenses.filter(e => !e.expense_type_id).map(x => (
                                                        <li key={x.id} className="p-2 rounded border border-gray-800 bg-gray-900/60">
                                                            <div className="flex justify-between items-start gap-2">
                                                                <div>
                                                                    <div className="text-gray-100 text-sm">{x.expense_name}</div>
                                                                    {(x.accounting_code || x.description || x.recurrence_rule_id) && (
                                                                        <div className="text-gray-400 text-[10px] mt-1">{[
                                                                            x.accounting_code,
                                                                            x.description,
                                                                            x.recurrence_rule_id ? (() => { const rr = recurrenceRules.find(r => r.id === x.recurrence_rule_id); return rr ? `${rr.rule_type}:${rr.frequency}` : 'Recurring'; })() : null,
                                                                            x.recurrence_rule_id && (x as any).recurrence_details ? (() => { try { const d = (x as any).recurrence_details; if (!d || typeof d !== 'object') return null; const priority = ['start_date', 'end_date']; const keys = Object.keys(d); const ordered = [...keys].sort((a, b) => { const pa = priority.indexOf(a); const pb = priority.indexOf(b); const ia = pa === -1 ? 999 : pa; const ib = pb === -1 ? 999 : pb; if (ia !== ib) return ia - ib; return a.localeCompare(b) }); return ordered.slice(0, 3).map(k => `${k}=${d[k]}`).join(', ') || null } catch { return null } })() : null
                                                                        ].filter(Boolean).join(' · ')}</div>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <button onClick={() => startEditingExpense(x)} className="text-[10px] text-yellow-400 hover:text-yellow-300">Edit</button>
                                                                    <button onClick={() => setPendingDelete({ type: 'expense', id: x.id })} disabled={deletingExpenseId === x.id} className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-50">{deletingExpenseId === x.id ? 'Deleting…' : 'Delete'}</button>
                                                                </div>
                                                            </div>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {pendingDelete && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
                    <div className="w-full max-w-sm rounded-lg border border-gray-800 bg-gray-900 p-4 shadow-xl">
                        <div className="text-gray-100 font-semibold mb-1">Confirm deletion</div>
                        <div className="text-gray-400 text-sm mb-3">Are you sure you want to delete this {pendingDelete.type}? This action cannot be undone.</div>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setPendingDelete(null)} className="text-sm text-gray-300 hover:text-gray-200">Cancel</button>
                            <button onClick={confirmDelete} className="bg-red-500 hover:bg-red-600 text-white text-sm px-3 py-1.5 rounded">Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
