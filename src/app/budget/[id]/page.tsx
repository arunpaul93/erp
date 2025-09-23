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
}

interface ExpenseType { id: string; name: string }

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
  const [savingExpense, setSavingExpense] = useState(false)

  // expense types
  const [expenseTypes, setExpenseTypes] = useState<ExpenseType[]>([])

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
        supabase.from("budget_expenses").select("id, expense_name, description, accounting_code, expense_type_id").eq("budget_id", budgetId).order("created_at", { ascending: false }),
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
      setExpenses((exp ?? []).map((r: any) => ({ id: String(r.id), expense_name: r.expense_name, description: r.description ?? null, accounting_code: r.accounting_code ?? null, expense_type_id: r.expense_type_id ?? null })))

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
    setSavingExpense(true)
    const insertPayload: any = {
      budget_id: budgetId,
      expense_name: expenseName.trim(),
      accounting_code: expenseCode || null,
      description: expenseDesc || null,
    }
    if (expenseTypeId) insertPayload.expense_type_id = expenseTypeId

    const { data, error } = await supabase.from("budget_expenses").insert(insertPayload).select("id, expense_name, description, accounting_code, expense_type_id").maybeSingle()
    setSavingExpense(false)
    if (error) return setError(error.message)
    if (data) {
      setExpenses(prev => [{ id: String(data.id), expense_name: data.expense_name as string, description: (data as any).description ?? null, accounting_code: (data as any).accounting_code ?? null, expense_type_id: (data as any).expense_type_id ?? null }, ...prev])
      setExpenseName(""); setExpenseCode(""); setExpenseDesc(""); setExpenseTypeId("")
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
                    <input value={expenseName} onChange={e => setExpenseName(e.target.value)} placeholder="Expense name" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input value={expenseCode} onChange={e => setExpenseCode(e.target.value)} placeholder="Accounting code (optional)" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                      <input value={expenseDesc} onChange={e => setExpenseDesc(e.target.value)} placeholder="Description (optional)" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-300 mb-1">Expense Type</label>
                      <select value={expenseTypeId} onChange={e => setExpenseTypeId(e.target.value)} className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                        <option value="">Select type (optional)</option>
                        {expenseTypes.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                    <button onClick={createExpense} disabled={savingExpense} className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-gray-900 px-3 py-2 rounded-md text-sm w-fit">{savingExpense ? "Saving…" : "Add Expense"}</button>
                  </div>
                  {expenses.length === 0 ? (
                    <div className="text-gray-400 text-sm">No expenses yet.</div>
                  ) : (
                    <ul className="space-y-2">
                      {expenses.map((x) => (
                        <li key={x.id} className="p-3 rounded border border-gray-800 bg-gray-900/60">
                          <div className="text-gray-100">{x.expense_name}</div>
                          {(x.accounting_code || x.description) && (
                            <div className="text-gray-400 text-xs mt-1">{[x.accounting_code, x.description].filter(Boolean).join(" · ")}</div>
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
