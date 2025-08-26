"use client"

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

export default function BudgetDetailPage() {
  const router = useRouter()
  const params = useParams() as { id?: string }
  const id = params?.id
  const { user, loading: authLoading } = useAuth()
  const [budget, setBudget] = useState<any | null>(null)
  const [items, setItems] = useState<Array<any>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [workflowSteps, setWorkflowSteps] = useState<string[]>([])
  // Global add-item form (no relation to steps)
  const [addOpen, setAddOpen] = useState(false)
  const [addType, setAddType] = useState<string>('')
  const [addName, setAddName] = useState<string>('')
  const [addAttrs, setAddAttrs] = useState<any>({})
  const [duplicating, setDuplicating] = useState(false)
  const [dupError, setDupError] = useState<string | null>(null)
  const [newBudgetId, setNewBudgetId] = useState<string | null>(null)
  // Budget config state
  const [cfg, setCfg] = useState<any | null>(null)
  const [cfgDraft, setCfgDraft] = useState<any | null>(null)
  const [cfgLoading, setCfgLoading] = useState(false)
  const [cfgError, setCfgError] = useState<string | null>(null)
  // Edit item state
  const [editOpenId, setEditOpenId] = useState<string | null>(null)
  const [editType, setEditType] = useState<string>('')
  const [editName, setEditName] = useState<string>('')
  const [editAttrs, setEditAttrs] = useState<any>({})
  const [editSaving, setEditSaving] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [authLoading, user, router])

  useEffect(() => {
    const fetch = async () => {
      if (!id) return
      setLoading(true)
      const { data: b, error: be } = await supabase.from('budget').select('*').eq('id', id).maybeSingle()
      if (be) { setError(be.message); setLoading(false); return }
      setBudget(b)
      // fetch business plan to read operational_workflow
      if (b?.business_plan_id) {
        const { data: bp } = await supabase.from('business_plan').select('operational_workflow').eq('id', b.business_plan_id).maybeSingle()
        if (bp) {
          if (Array.isArray(bp.operational_workflow)) setWorkflowSteps(bp.operational_workflow as string[])
          else if (typeof bp.operational_workflow === 'string') {
            try {
              const parsed = JSON.parse(bp.operational_workflow)
              if (Array.isArray(parsed)) setWorkflowSteps(parsed)
              else setWorkflowSteps((bp.operational_workflow as string).split('>').map((s: string) => s.trim()).filter(Boolean))
            } catch {
              setWorkflowSteps((bp.operational_workflow as string).split('>').map((s: string) => s.trim()).filter(Boolean))
            }
          }
        }
      }

      const { data, error } = await supabase.from('budget_details').select('*').eq('budget_id', id).order('created_at', { ascending: false })
      if (error) setError(error.message)
      else setItems(data ?? [])
      setLoading(false)
    }
    fetch()
  }, [id])

  useEffect(() => {
    const fetchConfig = async () => {
      if (!id) return
      setCfgLoading(true)
      setCfgError(null)
      try {
        const { data, error } = await supabase.from('budget_config' as any).select('*').eq('budget_id', id).maybeSingle()
        if (error) {
          setCfgError(error.message)
          setCfg(null)
          setCfgDraft(null)
        } else {
          setCfg(data || null)
          setCfgDraft(data ? { ...data } : null)
        }
      } catch (e: any) {
        setCfgError(String(e?.message || e))
        setCfg(null)
        setCfgDraft(null)
      } finally {
        setCfgLoading(false)
      }
    }
    fetchConfig()
  }, [id])

  const onSaveBudget = async () => {
    if (!id || !budget) return
    if (!newName.trim()) return
    const { error } = await supabase.from('budget').update({ name: newName.trim() }).eq('id', id)
    if (error) return setError(error.message)
    setBudget((prev: any) => ({ ...prev, name: newName.trim() }))
    setNewName('')
  }

  const deleteItem = async (itemId: string) => {
    const { error } = await supabase.from('budget_details').delete().eq('id', itemId)
    if (error) return setError(error.message)
    setItems(prev => prev.filter(i => String(i.id) !== String(itemId)))
  }

  const duplicateBudget = async () => {
    if (!id) return
    setDuplicating(true)
    setDupError(null)
    // 1) fetch original budget
    const { data: orig, error: origErr } = await supabase.from('budget').select('*').eq('id', id).maybeSingle()
    if (origErr || !orig) {
      setDupError(origErr?.message || 'Original budget not found')
      setDuplicating(false)
      return
    }
    // 2) create new budget with minimal safe fields
    const insertPayload: any = {
      name: `${orig.name || 'Budget'} (Copy)`,
      business_plan_id: orig.business_plan_id ?? null,
      period_start: orig.period_start,
      period_end: orig.period_end,
      totals: orig.totals ?? {},
      notes: orig.notes ?? null,
    }
    const { data: newBudget, error: insErr } = await supabase.from('budget').insert(insertPayload).select('*').maybeSingle()
    if (insErr || !newBudget) {
      setDupError(insErr?.message || 'Failed to create duplicated budget')
      setDuplicating(false)
      return
    }

    const newId = newBudget.id
    // 3) duplicate budget_details
    const { data: details, error: detErr } = await supabase.from('budget_details').select('*').eq('budget_id', id)
    if (detErr) {
      setDupError(`Failed to read original details: ${detErr.message}`)
    } else if (details && details.length > 0) {
      const payload = details.map((d: any) => {
        const copy: any = { ...d }
        delete copy.id
        delete copy.created_at
        delete copy.updated_at
        copy.budget_id = newId
        return copy
      })
      const { error: insDetErr } = await supabase.from('budget_details').insert(payload)
      if (insDetErr) {
        setDupError(prev => prev ? prev : `Budget duplicated but copying details failed: ${insDetErr.message}`)
      }
    }

    // 4) duplicate budget_config if table exists
    // try select; if table missing, skip
    try {
      const tryConfig = await supabase.from('budget_config' as any).select('*').eq('budget_id', id)
      if (!tryConfig.error) {
        const configRows: any[] = tryConfig.data || []
        if (configRows.length > 0) {
          const cfgPayload = configRows.map((r: any) => {
            const copy: any = { ...r }
            delete copy.id
            delete copy.created_at
            delete copy.updated_at
            copy.budget_id = newId
            return copy
          })
          const { error: insCfgErr } = await supabase.from('budget_config' as any).insert(cfgPayload)
          if (insCfgErr) setDupError(prev => prev ? prev : `Config copy failed: ${insCfgErr.message}`)
        }
      }
    } catch (_) {
      // table may not exist; ignore
    }

    setDuplicating(false)
    setNewBudgetId(newId)
    // Navigate to new budget page
    router.push(`/budget/${newId}`)
  }

  if (authLoading) return null

  return (
    <div className="min-h-screen bg-gray-950">
      <nav className="bg-gray-900 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <button onClick={() => router.back()} className="text-yellow-400 hover:text-yellow-300 text-sm">← Back</button>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-300">Budget</span>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 sm:px-0">
          <h2 className="text-2xl font-bold text-yellow-400">Budget</h2>
          {error && <div className="text-sm text-red-400">{error}</div>}
          {loading ? (
            <div className="text-gray-300">Loading…</div>
          ) : (
            <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-4 mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-gray-100 font-medium">{budget?.name}</div>
                  <div className="text-gray-400 text-sm">{budget?.period_start} — {budget?.period_end}</div>
                </div>
                <div className="flex items-center gap-2">
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Rename" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                  <button onClick={onSaveBudget} className="bg-yellow-400 text-gray-900 px-3 py-2 rounded-md">Save</button>
                  <button disabled={duplicating} onClick={duplicateBudget} className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 border border-gray-700 px-3 py-2 rounded-md">{duplicating ? 'Duplicating…' : 'Duplicate budget'}</button>
                </div>
              </div>
              {dupError && <div className="mt-2 text-xs text-red-400">{dupError}</div>}
              {newBudgetId && <div className="mt-2 text-xs text-green-400">Duplicated to <button className="underline" onClick={() => router.push(`/budget/${newBudgetId}`)}>open new budget</button>.</div>}

              <div className="mt-4">
                <h3 className="text-sm text-gray-300 mb-2">Operational workflow steps</h3>
                {workflowSteps.length === 0 ? (
                  <div className="text-gray-400 text-sm">No workflow steps found on the linked business plan.</div>
                ) : (
                  <ul className="space-y-2">
                    {workflowSteps.map((step, idx) => (
                      <li key={idx} className="p-3 bg-gray-900/60 border border-gray-800 rounded text-gray-100">Step {idx + 1}: {step}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm text-gray-300">Budget items</h3>
                  <button className="text-yellow-300 text-xs" onClick={() => setAddOpen(v => !v)}>{addOpen ? 'Cancel' : 'Add item'}</button>
                </div>

                {addOpen && (
                  <div className="mb-4 p-3 bg-gray-900/60 border border-gray-800 rounded space-y-3">
                    <div className="flex gap-2">
                      <select value={addType} onChange={(e) => { const v = e.target.value; setAddType(v); setAddAttrs({}); if (!addName) setAddName(v) }} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                        <option value="">Select type</option>
                        <option value="owners_capital_added">owners_capital_added</option>
                        <option value="owners_capital_withdrawal">owners_capital_withdrawal</option>
                        <option value="fixed_expense_recurring">fixed_expense_recurring</option>
                        <option value="expense_on_dates">expense_on_dates</option>
                        <option value="staff_payroll_service">staff_payroll_service</option>
                        <option value="staff_payroll_product">staff_payroll_product</option>
                        <option value="project_income_on_dates">project_income_on_dates</option>
                        <option value="project_income_recurring">project_income_recurring</option>
                      </select>
                      <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Item name" className="flex-1 bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                    </div>

                    {addType === 'owners_capital_added' || addType === 'owners_capital_withdrawal' ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Amount</label>
                          <input value={addAttrs.amount ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, amount: e.target.value }))} placeholder="Amount" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Date</label>
                          <input type="date" value={addAttrs.date ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, date: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                        </div>
                      </div>
                    ) : addType === 'fixed_expense_recurring' || addType === 'project_income_recurring' ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Total amount</label>
                          <input value={addAttrs.total_amount ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, total_amount: e.target.value }))} placeholder="Total amount" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Tax code</label>
                          <select value={addAttrs.taxcode ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, taxcode: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                            <option value="">Tax code</option>
                            <option value="gst">gst</option>
                            <option value="gstfree">gstfree</option>
                          </select>
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Frequency</label>
                          <select value={addAttrs.frequency ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, frequency: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                            <option value="">Frequency</option>
                            <option value="monthly">monthly</option>
                            <option value="weekly">weekly</option>
                            <option value="yearly">yearly</option>
                          </select>
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Interval</label>
                          <input type="number" value={addAttrs.interval ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, interval: Number(e.target.value) }))} placeholder="Interval" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Start date</label>
                          <input type="date" value={addAttrs.start_date ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, start_date: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">End date</label>
                          <input type="date" value={addAttrs.end_date ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, end_date: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                        </div>
                      </div>
                    ) : addType === 'expense_on_dates' || addType === 'project_income_on_dates' ? (
                      <div className="space-y-3">
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Dates (comma separated yyyy-mm-dd)</label>
                          <textarea value={addAttrs.dates ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, dates: e.target.value }))} placeholder="2025-08-01, 2025-08-15" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Amounts (comma separated)</label>
                          <textarea value={addAttrs.amount_array ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, amount_array: e.target.value }))} placeholder="1000, 2000" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Tax code</label>
                          <select value={addAttrs.taxcode ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, taxcode: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                            <option value="">Tax code</option>
                            <option value="gst">gst</option>
                            <option value="gstfree">gstfree</option>
                          </select>
                        </div>
                      </div>
                    ) : addType === 'staff_payroll_service' ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Frequency</label>
                          <select value={addAttrs.frequency ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, frequency: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                            <option value="">Frequency</option>
                            <option value="monthly">monthly</option>
                            <option value="weekly">weekly</option>
                            <option value="yearly">yearly</option>
                          </select>
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Start date</label>
                          <input type="date" value={addAttrs.start_date ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, start_date: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">End date</label>
                          <input type="date" value={addAttrs.end_date ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, end_date: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Hourly rate</label>
                          <input value={addAttrs.hourly_rate ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, hourly_rate: e.target.value }))} placeholder="Hourly rate" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Hours per pay period</label>
                          <input value={addAttrs.hours_per_pay_period ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, hours_per_pay_period: e.target.value }))} placeholder="Hours per pay period" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Expected profitability (optional)</label>
                          <input value={addAttrs.expected_profitability ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, expected_profitability: e.target.value }))} placeholder="Expected profitability (optional)" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Earnings due days (optional)</label>
                          <input value={addAttrs.earnings_duedays ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, earnings_duedays: e.target.value }))} placeholder="Earnings due days (optional)" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Leave entitlement</label>
                          <select value={addAttrs.leave_entitlement ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, leave_entitlement: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                            <option value="">Leave entitlement</option>
                            <option value="yes">yes</option>
                            <option value="no">no</option>
                          </select>
                        </div>
                      </div>
                    ) : addType === 'staff_payroll_product' ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Frequency</label>
                          <select value={addAttrs.frequency ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, frequency: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                            <option value="">Frequency</option>
                            <option value="monthly">monthly</option>
                            <option value="weekly">weekly</option>
                            <option value="yearly">yearly</option>
                          </select>
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Start date</label>
                          <input type="date" value={addAttrs.start_date ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, start_date: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">End date</label>
                          <input type="date" value={addAttrs.end_date ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, end_date: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Hourly rate</label>
                          <input value={addAttrs.hourly_rate ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, hourly_rate: e.target.value }))} placeholder="Hourly rate" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Hours per pay period</label>
                          <input value={addAttrs.hours_per_pay_period ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, hours_per_pay_period: e.target.value }))} placeholder="Hours per pay period" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Leave entitlement</label>
                          <select value={addAttrs.leave_entitlement ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, leave_entitlement: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                            <option value="">Leave entitlement</option>
                            <option value="yes">yes</option>
                            <option value="no">no</option>
                          </select>
                        </div>
                      </div>
                    ) : null}

                    <div>
                      <button className="bg-yellow-400 text-gray-900 px-3 py-2 rounded-md" onClick={async () => {
                        const type = addType
                        const name = (addName || addType || '').trim()
                        if (!type) return setError('Select an item type')
                        if (!name) return setError('Enter item name')
                        let attributes: any = {}
                        const a = addAttrs || {}
                        try {
                          switch (type) {
                            case 'owners_capital_added':
                            case 'owners_capital_withdrawal':
                              attributes = { amount: a.amount ? Number(a.amount) : null, date: a.date || null }
                              break
                            case 'fixed_expense_recurring':
                            case 'project_income_recurring':
                              attributes = {
                                total_amount: a.total_amount ? Number(a.total_amount) : null,
                                taxcode: a.taxcode || null,
                                frequency: a.frequency || null,
                                interval: a.interval ?? null,
                                start_date: a.start_date || null,
                                end_date: a.end_date || null,
                              }
                              break
                            case 'expense_on_dates':
                            case 'project_income_on_dates':
                              const dates = (a.dates || '').split(',').map((s: string) => s.trim()).filter(Boolean)
                              const amounts = (a.amount_array || '').split(',').map((s: string) => Number(s.trim()))
                              attributes = { dates, amount_array: amounts, taxcode: a.taxcode || null }
                              break
                            case 'staff_payroll_service':
                              attributes = {
                                frequency: a.frequency || null,
                                start_date: a.start_date || null,
                                end_date: a.end_date || null,
                                hourly_rate: a.hourly_rate ? Number(a.hourly_rate) : null,
                                hours_per_pay_period: a.hours_per_pay_period ? Number(a.hours_per_pay_period) : null,
                                expected_profitability: a.expected_profitability || null,
                                earnings_duedays: a.earnings_duedays || null,
                                leave_entitlement: a.leave_entitlement || null,
                              }
                              break
                            case 'staff_payroll_product':
                              attributes = {
                                frequency: a.frequency || null,
                                start_date: a.start_date || null,
                                end_date: a.end_date || null,
                                hourly_rate: a.hourly_rate ? Number(a.hourly_rate) : null,
                                hours_per_pay_period: a.hours_per_pay_period ? Number(a.hours_per_pay_period) : null,
                                leave_entitlement: a.leave_entitlement || null,
                              }
                              break
                            default:
                              attributes = { raw: a }
                          }
                        } catch (err: any) {
                          return setError(String(err?.message || err))
                        }

                        const { data, error: insertErr } = await supabase.from('budget_details').insert({
                          budget_id: id,
                          name,
                          item_type: type,
                          attributes,
                        }).select('*').maybeSingle()
                        if (insertErr) return setError(insertErr.message)
                        if (data) setItems(prev => [data, ...prev])
                        setAddOpen(false)
                        setAddName('')
                        setAddType('')
                        setAddAttrs({})
                      }}>Add</button>
                    </div>
                  </div>
                )}

                {items.length === 0 ? (
                  <div className="text-gray-400 text-sm">No items yet.</div>
                ) : (
                  <ul className="space-y-2">
                    {items.map(it => (
                      <li key={it.id} className="p-3 bg-gray-900/60 border border-gray-800 rounded">
                        {editOpenId === String(it.id) ? (
                          <div className="space-y-3">
                            <div className="flex gap-2">
                              <select value={editType} onChange={(e) => { const v = e.target.value; setEditType(v); setEditAttrs({}) }} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                                <option value="">Select type</option>
                                <option value="owners_capital_added">owners_capital_added</option>
                                <option value="owners_capital_withdrawal">owners_capital_withdrawal</option>
                                <option value="fixed_expense_recurring">fixed_expense_recurring</option>
                                <option value="expense_on_dates">expense_on_dates</option>
                                <option value="staff_payroll_service">staff_payroll_service</option>
                                <option value="staff_payroll_product">staff_payroll_product</option>
                                <option value="project_income_on_dates">project_income_on_dates</option>
                                <option value="project_income_recurring">project_income_recurring</option>
                              </select>
                              <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Item name" className="flex-1 bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                            </div>

                            {editType === 'owners_capital_added' || editType === 'owners_capital_withdrawal' ? (
                              <div className="grid grid-cols-2 gap-3">
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Amount</label>
                                  <input value={editAttrs.amount ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, amount: e.target.value }))} placeholder="Amount" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Date</label>
                                  <input type="date" value={editAttrs.date ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, date: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                </div>
                              </div>
                            ) : editType === 'fixed_expense_recurring' || editType === 'project_income_recurring' ? (
                              <div className="grid grid-cols-2 gap-3">
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Total amount</label>
                                  <input value={editAttrs.total_amount ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, total_amount: e.target.value }))} placeholder="Total amount" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Tax code</label>
                                  <select value={editAttrs.taxcode ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, taxcode: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                                    <option value="">Tax code</option>
                                    <option value="gst">gst</option>
                                    <option value="gstfree">gstfree</option>
                                  </select>
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Frequency</label>
                                  <select value={editAttrs.frequency ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, frequency: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                                    <option value="">Frequency</option>
                                    <option value="monthly">monthly</option>
                                    <option value="weekly">weekly</option>
                                    <option value="yearly">yearly</option>
                                  </select>
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Interval</label>
                                  <input type="number" value={editAttrs.interval ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, interval: Number(e.target.value) }))} placeholder="Interval" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Start date</label>
                                  <input type="date" value={editAttrs.start_date ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, start_date: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">End date</label>
                                  <input type="date" value={editAttrs.end_date ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, end_date: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                </div>
                              </div>
                            ) : editType === 'expense_on_dates' || editType === 'project_income_on_dates' ? (
                              <div className="space-y-3">
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Dates (comma separated yyyy-mm-dd)</label>
                                  <textarea value={editAttrs.dates ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, dates: e.target.value }))} placeholder="2025-08-01, 2025-08-15" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Amounts (comma separated)</label>
                                  <textarea value={editAttrs.amount_array ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, amount_array: e.target.value }))} placeholder="1000, 2000" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Tax code</label>
                                  <select value={editAttrs.taxcode ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, taxcode: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                                    <option value="">Tax code</option>
                                    <option value="gst">gst</option>
                                    <option value="gstfree">gstfree</option>
                                  </select>
                                </div>
                              </div>
                            ) : editType === 'staff_payroll_service' ? (
                              <div className="grid grid-cols-2 gap-3">
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Frequency</label>
                                  <select value={editAttrs.frequency ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, frequency: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                                    <option value="">Frequency</option>
                                    <option value="monthly">monthly</option>
                                    <option value="weekly">weekly</option>
                                    <option value="yearly">yearly</option>
                                  </select>
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Start date</label>
                                  <input type="date" value={editAttrs.start_date ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, start_date: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">End date</label>
                                  <input type="date" value={editAttrs.end_date ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, end_date: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Hourly rate</label>
                                  <input value={editAttrs.hourly_rate ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, hourly_rate: e.target.value }))} placeholder="Hourly rate" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Hours per pay period</label>
                                  <input value={editAttrs.hours_per_pay_period ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, hours_per_pay_period: e.target.value }))} placeholder="Hours per pay period" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Expected profitability (optional)</label>
                                  <input value={editAttrs.expected_profitability ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, expected_profitability: e.target.value }))} placeholder="Expected profitability (optional)" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Earnings due days (optional)</label>
                                  <input value={editAttrs.earnings_duedays ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, earnings_duedays: e.target.value }))} placeholder="Earnings due days (optional)" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Leave entitlement</label>
                                  <select value={editAttrs.leave_entitlement ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, leave_entitlement: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                                    <option value="">Leave entitlement</option>
                                    <option value="yes">yes</option>
                                    <option value="no">no</option>
                                  </select>
                                </div>
                              </div>
                            ) : editType === 'staff_payroll_product' ? (
                              <div className="grid grid-cols-2 gap-3">
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Frequency</label>
                                  <select value={editAttrs.frequency ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, frequency: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                                    <option value="">Frequency</option>
                                    <option value="monthly">monthly</option>
                                    <option value="weekly">weekly</option>
                                    <option value="yearly">yearly</option>
                                  </select>
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Start date</label>
                                  <input type="date" value={editAttrs.start_date ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, start_date: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">End date</label>
                                  <input type="date" value={editAttrs.end_date ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, end_date: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Hourly rate</label>
                                  <input value={editAttrs.hourly_rate ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, hourly_rate: e.target.value }))} placeholder="Hourly rate" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Hours per pay period</label>
                                  <input value={editAttrs.hours_per_pay_period ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, hours_per_pay_period: e.target.value }))} placeholder="Hours per pay period" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Leave entitlement</label>
                                  <select value={editAttrs.leave_entitlement ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, leave_entitlement: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                                    <option value="">Leave entitlement</option>
                                    <option value="yes">yes</option>
                                    <option value="no">no</option>
                                  </select>
                                </div>
                              </div>
                            ) : null}

                            <div className="flex gap-2">
                              <button disabled={editSaving} className="bg-yellow-400 text-gray-900 px-3 py-2 rounded-md disabled:opacity-50" onClick={async () => {
                                const type = editType
                                const name = (editName || editType || '').trim()
                                if (!type) return setError('Select an item type')
                                if (!name) return setError('Enter item name')
                                setEditSaving(true)
                                let attributes: any = {}
                                const a = editAttrs || {}
                                try {
                                  switch (type) {
                                    case 'owners_capital_added':
                                    case 'owners_capital_withdrawal':
                                      attributes = { amount: a.amount ? Number(a.amount) : null, date: a.date || null }
                                      break
                                    case 'fixed_expense_recurring':
                                    case 'project_income_recurring':
                                      attributes = {
                                        total_amount: a.total_amount ? Number(a.total_amount) : null,
                                        taxcode: a.taxcode || null,
                                        frequency: a.frequency || null,
                                        interval: a.interval ?? null,
                                        start_date: a.start_date || null,
                                        end_date: a.end_date || null,
                                      }
                                      break
                                    case 'expense_on_dates':
                                    case 'project_income_on_dates':
                                      const dates = (a.dates || '').split(',').map((s: string) => s.trim()).filter(Boolean)
                                      const amounts = (a.amount_array || '').split(',').map((s: string) => Number(s.trim()))
                                      attributes = { dates, amount_array: amounts, taxcode: a.taxcode || null }
                                      break
                                    case 'staff_payroll_service':
                                      attributes = {
                                        frequency: a.frequency || null,
                                        start_date: a.start_date || null,
                                        end_date: a.end_date || null,
                                        hourly_rate: a.hourly_rate ? Number(a.hourly_rate) : null,
                                        hours_per_pay_period: a.hours_per_pay_period ? Number(a.hours_per_pay_period) : null,
                                        expected_profitability: a.expected_profitability || null,
                                        earnings_duedays: a.earnings_duedays || null,
                                        leave_entitlement: a.leave_entitlement || null,
                                      }
                                      break
                                    case 'staff_payroll_product':
                                      attributes = {
                                        frequency: a.frequency || null,
                                        start_date: a.start_date || null,
                                        end_date: a.end_date || null,
                                        hourly_rate: a.hourly_rate ? Number(a.hourly_rate) : null,
                                        hours_per_pay_period: a.hours_per_pay_period ? Number(a.hours_per_pay_period) : null,
                                        leave_entitlement: a.leave_entitlement || null,
                                      }
                                      break
                                    default:
                                      attributes = { raw: a }
                                  }
                                } catch (err: any) {
                                  setEditSaving(false)
                                  return setError(String(err?.message || err))
                                }

                                const { data, error: updErr } = await supabase.from('budget_details').update({
                                  name,
                                  item_type: type,
                                  attributes,
                                }).eq('id', it.id).select('*').maybeSingle()
                                setEditSaving(false)
                                if (updErr) return setError(updErr.message)
                                if (data) setItems(prev => prev.map(p => String(p.id) === String(it.id) ? data : p))
                                setEditOpenId(null)
                                setEditType('')
                                setEditName('')
                                setEditAttrs({})
                              }}>Save</button>
                              <button className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 px-3 py-2 rounded-md" onClick={() => { setEditOpenId(null); setEditType(''); setEditName(''); setEditAttrs({}) }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-gray-100">{it.name}</div>
                              <div className="text-gray-400 text-xs">{it.item_type}</div>
                            </div>
                            <div className="flex items-center gap-3">
                              <button className="text-yellow-300 text-xs" onClick={() => {
                                setEditOpenId(String(it.id))
                                setEditType(it.item_type || '')
                                setEditName(it.name || '')
                                const a = it.attributes || {}
                                let norm = { ...a }
                                if (it.item_type === 'expense_on_dates' || it.item_type === 'project_income_on_dates') {
                                  norm = {
                                    ...norm,
                                    dates: Array.isArray(a.dates) ? a.dates.join(', ') : (a.dates || ''),
                                    amount_array: Array.isArray(a.amount_array) ? a.amount_array.join(', ') : (a.amount_array || ''),
                                  }
                                }
                                if (it.item_type === 'owners_capital_added' || it.item_type === 'owners_capital_withdrawal') {
                                  norm = { ...norm, amount: a.amount ?? '' }
                                }
                                if (it.item_type === 'fixed_expense_recurring' || it.item_type === 'project_income_recurring') {
                                  norm = { ...norm, total_amount: a.total_amount ?? '', interval: a.interval ?? '' }
                                }
                                if (it.item_type === 'staff_payroll_service' || it.item_type === 'staff_payroll_product') {
                                  norm = {
                                    ...norm,
                                    hourly_rate: a.hourly_rate ?? '',
                                    hours_per_pay_period: a.hours_per_pay_period ?? '',
                                  }
                                }
                                setEditAttrs(norm)
                              }}>Edit</button>
                              <button className="text-red-400 text-xs" onClick={() => deleteItem(it.id)}>Delete</button>
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
      <section className="max-w-4xl mx-auto pb-12 sm:px-6 lg:px-8">
        <div className="px-4 sm:px-0">
          <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-4 mt-4">
            <h3 className="text-sm text-gray-300 mb-3">Budget config</h3>
            {cfgLoading ? (
              <div className="text-gray-400 text-sm">Loading config…</div>
            ) : cfgError ? (
              <div className="text-red-400 text-sm">{cfgError}</div>
            ) : !cfgDraft ? (
              <div className="flex items-center justify-between">
                <div className="text-gray-400 text-sm">No config for this budget.</div>
                <button
                  className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 px-3 py-2 rounded-md text-sm"
                  onClick={async () => {
                    if (!id) return
                    setCfgLoading(true)
                    setCfgError(null)
                    try {
                      const { data, error } = await supabase.from('budget_config' as any).insert({ budget_id: id }).select('*').maybeSingle()
                      if (error) return setCfgError(error.message)
                      setCfg(data)
                      setCfgDraft(data ? { ...data } : null)
                    } catch (e: any) {
                      setCfgError(String(e?.message || e))
                    } finally {
                      setCfgLoading(false)
                    }
                  }}
                >Create config</button>
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(cfgDraft)
                  .filter(([k]) => !['id', 'budget_id', 'created_at', 'updated_at'].includes(k))
                  .map(([key, val]) => {
                    const type = typeof val
                    return (
                      <div key={key} className="grid grid-cols-3 gap-3 items-start">
                        <label className="text-xs text-gray-300 pt-2">{key}</label>
                        <div className="col-span-2">
                          {key.toLowerCase().includes('frequency') ? (
                            <select
                              className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2"
                              value={String(val ?? '')}
                              onChange={(e) => setCfgDraft((prev: any) => ({ ...prev, [key]: e.target.value }))}
                            >
                              <option value="">Select frequency</option>
                              <option value="daily">daily</option>
                              <option value="weekly">weekly</option>
                              <option value="monthly">monthly</option>
                            </select>
                          ) : val !== null && (type === 'object') ? (
                            <textarea
                              className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2"
                              rows={3}
                              value={(() => { try { return JSON.stringify(val, null, 2) } catch { return String(val) } })()}
                              onChange={(e) => {
                                let next: any = e.target.value
                                try { next = JSON.parse(e.target.value) } catch { /* keep string if parsing fails */ }
                                setCfgDraft((prev: any) => ({ ...prev, [key]: next }))
                              }}
                            />
                          ) : type === 'boolean' ? (
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={Boolean(val)}
                              onChange={(e) => setCfgDraft((prev: any) => ({ ...prev, [key]: e.target.checked }))}
                            />
                          ) : type === 'number' ? (
                            <input
                              type="number"
                              className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2"
                              value={String(val ?? '')}
                              onChange={(e) => setCfgDraft((prev: any) => ({ ...prev, [key]: e.target.value === '' ? null : Number(e.target.value) }))}
                            />
                          ) : (
                            <input
                              className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2"
                              value={String(val ?? '')}
                              onChange={(e) => setCfgDraft((prev: any) => ({ ...prev, [key]: e.target.value }))}
                            />
                          )}
                        </div>
                      </div>
                    )
                  })}

                <div className="flex gap-2">
                  <button
                    className="bg-yellow-400 text-gray-900 px-3 py-2 rounded-md"
                    onClick={async () => {
                      if (!id || !cfgDraft) return
                      setCfgError(null)
                      const payload: any = {}
                      for (const [k, v] of Object.entries(cfgDraft)) {
                        if (['id', 'budget_id', 'created_at', 'updated_at'].includes(k)) continue
                        payload[k] = v
                      }
                      // Try upsert by budget_id (works when a unique key exists on budget_id)
                      let upserted: any = null
                      try {
                        const up = await supabase
                          .from('budget_config' as any)
                          .upsert({ budget_id: id, ...payload }, { onConflict: 'budget_id' as any })
                          .select('*')
                          .maybeSingle()
                        if (up.error) throw up.error
                        upserted = up.data
                      } catch (e: any) {
                        // Fallback to update by budget_id
                        const { data, error } = await supabase
                          .from('budget_config' as any)
                          .update(payload)
                          .eq('budget_id', id)
                          .select('*')
                          .maybeSingle()
                        if (error) return setCfgError(error.message)
                        upserted = data
                      }
                      setCfg(upserted)
                      setCfgDraft(upserted ? { ...upserted } : null)
                    }}
                  >Save config</button>
                  <button
                    className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 px-3 py-2 rounded-md"
                    onClick={() => setCfgDraft(cfg ? { ...cfg } : null)}
                  >Reset</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
