"use client"

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import OperationalFlowEditor, { type WorkflowGraph } from '@/components/OperationalFlowEditor'

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
  const [operationalWorkflow, setOperationalWorkflow] = useState<WorkflowGraph | null>(null)
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
  const [cfgOpen, setCfgOpen] = useState(false)
  const [cfgSaving, setCfgSaving] = useState(false)
  const [cfgSaveSuccess, setCfgSaveSuccess] = useState(false)
  const [budgetSaving, setBudgetSaving] = useState(false)
  const [budgetSaveSuccess, setBudgetSaveSuccess] = useState(false)
  const [calculatingCashFlow, setCalculatingCashFlow] = useState(false)
  const [cashFlowSuccess, setCashFlowSuccess] = useState(false)
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
          // Handle WorkflowGraph object for the visual editor
          if (bp.operational_workflow && typeof bp.operational_workflow === 'object') {
            setOperationalWorkflow(bp.operational_workflow as WorkflowGraph)
          } else if (typeof bp.operational_workflow === 'string') {
            try {
              const parsed = JSON.parse(bp.operational_workflow)
              if (parsed && typeof parsed === 'object' && (parsed.nodes || parsed.edges)) {
                // It's a WorkflowGraph object
                setOperationalWorkflow(parsed as WorkflowGraph)
              } else if (Array.isArray(parsed)) {
                // It's an array of step strings
                setWorkflowSteps(parsed)
                setOperationalWorkflow(null)
              } else {
                // It's a simple string, split by '>'
                setWorkflowSteps((bp.operational_workflow as string).split('>').map((s: string) => s.trim()).filter(Boolean))
                setOperationalWorkflow(null)
              }
            } catch {
              // Parsing failed, treat as simple string
              setWorkflowSteps((bp.operational_workflow as string).split('>').map((s: string) => s.trim()).filter(Boolean))
              setOperationalWorkflow(null)
            }
          } else {
            setOperationalWorkflow(null)
            setWorkflowSteps([])
          }
        } else {
          setOperationalWorkflow(null)
          setWorkflowSteps([])
        }
      } else {
        setOperationalWorkflow(null)
        setWorkflowSteps([])
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
    if (!id || !budget || budgetSaving) return
    if (!newName.trim()) return
    
    setBudgetSaving(true)
    setBudgetSaveSuccess(false)
    setError(null)
    
    const { error } = await supabase.from('budget').update({ name: newName.trim() }).eq('id', id)
    
    setBudgetSaving(false)
    
    if (error) {
      setError(error.message)
      return
    }
    
    setBudget((prev: any) => ({ ...prev, name: newName.trim() }))
    setNewName('')
    setBudgetSaveSuccess(true)
    
    // Show success state for 2 seconds
    setTimeout(() => {
      setBudgetSaveSuccess(false)
    }, 2000)
  }

  const deleteItem = async (itemId: string) => {
    const { error } = await supabase.from('budget_details').delete().eq('id', itemId)
    if (error) return setError(error.message)
    setItems(prev => prev.filter(i => String(i.id) !== String(itemId)))
  }

  const calculateCashFlow = async () => {
    if (!id) return
    setCalculatingCashFlow(true)
    setCashFlowSuccess(false)
    setError(null)
    
    try {
      const { data, error } = await supabase.rpc('recalculate_budget_cashflow', { 
        p_budget_id: id 
      })
      
      setCalculatingCashFlow(false)
      
      if (error) {
        setError(error.message)
        return
      }
      
      // Log the results
      if (data) {
        console.log(`Success: ${data.success}`)
        console.log(`Generated ${data.calculation_summary?.total_forecast_entries || 0} forecast entries`)
        console.log(`Processed ${data.calculation_summary?.budget_details_processed || 0} budget details`)
        console.log(`Config processed: ${data.calculation_summary?.budget_config_processed || false}`)
      }
      
      setCashFlowSuccess(true)
      
      // Show success state for 3 seconds
      setTimeout(() => {
        setCashFlowSuccess(false)
      }, 3000)
    } catch (err: any) {
      setCalculatingCashFlow(false)
      setError(String(err?.message || err))
    }
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
                  <button 
                    onClick={onSaveBudget} 
                    disabled={budgetSaving || !newName.trim()}
                    className={`px-3 py-2 rounded-md transition-all duration-200 flex items-center gap-2 ${
                      budgetSaving 
                        ? 'bg-yellow-300 text-gray-800 cursor-not-allowed' 
                        : budgetSaveSuccess 
                          ? 'bg-green-500 text-white' 
                          : newName.trim()
                            ? 'bg-yellow-400 hover:bg-yellow-500 text-gray-900'
                            : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    {budgetSaving ? (
                      <>
                        <div className="w-4 h-4 border-2 border-gray-800 border-t-transparent rounded-full animate-spin"></div>
                        Saving...
                      </>
                    ) : budgetSaveSuccess ? (
                      <>
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        Saved!
                      </>
                    ) : (
                      'Save'
                    )}
                  </button>
                  <button 
                    disabled={duplicating || budgetSaving} 
                    onClick={duplicateBudget} 
                    className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 border border-gray-700 px-3 py-2 rounded-md transition-all duration-200 flex items-center gap-2"
                  >
                    {duplicating ? (
                      <>
                        <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                        Duplicating…
                      </>
                    ) : (
                      'Duplicate budget'
                    )}
                  </button>
                </div>
              </div>
              {dupError && <div className="mt-2 text-xs text-red-400">{dupError}</div>}
              {newBudgetId && <div className="mt-2 text-xs text-green-400">Duplicated to <button className="underline" onClick={() => router.push(`/budget/${newBudgetId}`)}>open new budget</button>.</div>}

              <div className="mt-4">
                <h3 className="text-sm text-gray-300 mb-2">Operational workflow</h3>
                {operationalWorkflow ? (
                  <div className="border border-gray-800 rounded-lg">
                    <OperationalFlowEditor
                      value={operationalWorkflow}
                      height={400}
                      onChange={undefined} // Read-only in budget context
                    />
                  </div>
                ) : workflowSteps.length > 0 ? (
                  <div>
                    <p className="text-gray-400 text-sm mb-2">Legacy workflow steps:</p>
                    <ul className="space-y-2">
                      {workflowSteps.map((step, idx) => (
                        <li key={idx} className="p-3 bg-gray-900/60 border border-gray-800 rounded text-gray-100">Step {idx + 1}: {step}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="text-gray-400 text-sm">No workflow found on the linked business plan.</div>
                )}
              </div>

              {/* Budget items section - only visible if config is setup */}
              {cfg ? (
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm text-gray-300">Budget items</h3>
                    <div className="flex items-center gap-2">
                      <button 
                        className={`relative px-3 py-2 rounded-md text-sm transition-all duration-300 min-w-[140px] ${
                          calculatingCashFlow 
                            ? 'bg-green-600 text-white' 
                            : cashFlowSuccess 
                              ? 'bg-green-500 text-white' 
                              : 'bg-green-600 hover:bg-green-700 text-white disabled:opacity-50'
                        }`}
                        onClick={calculateCashFlow}
                        disabled={!items.length || calculatingCashFlow}
                      >
                        <div className={`transition-opacity duration-300 ${calculatingCashFlow ? 'opacity-0' : 'opacity-100'}`}>
                          {cashFlowSuccess ? '✓ Cash Flow Calculated' : 'Calculate Cash Flow'}
                        </div>
                        {calculatingCashFlow && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          </div>
                        )}
                      </button>
                      <button className="text-yellow-300 text-xs" onClick={() => setAddOpen(v => !v)}>{addOpen ? 'Cancel' : 'Add item'}</button>
                    </div>
                  </div>

                {addOpen && (
                  <div className="mb-4 p-3 bg-gray-900/60 border border-gray-800 rounded space-y-3">
                    <div className="flex gap-2">
                      <select value={addType} onChange={(e) => { 
                        const v = e.target.value; 
                        setAddType(v); 
                        // Initialize with one entry for date-based types
                        if (v === 'expense_on_dates' || v === 'project_income_on_dates') {
                          setAddAttrs({ dateAmountEntries: [{ date: '', amount: '' }] }); 
                        } else {
                          setAddAttrs({});
                        }
                        if (!addName) setAddName(v) 
                      }} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                        <option value="">Select type</option>
                        <option value="owners_capital_added">owners_capital_added</option>
                        <option value="owners_capital_withdrawal">owners_capital_withdrawal</option>
                        <option value="fixed_expense_recurring">fixed_expense_recurring</option>
                        <option value="expense_on_dates">expense_on_dates</option>
                        <option value="staff_payroll">staff_payroll</option>
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
                          <label className="text-xs text-gray-300 mb-1">Amount</label>
                          <input value={addAttrs.amount ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, amount: e.target.value }))} placeholder="Amount" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
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
                        <div className="flex items-center justify-between">
                          <label className="text-xs text-gray-300">Date & Amount Entries</label>
                          <div className="flex gap-2">
                            {(addAttrs.dateAmountEntries || []).length > 0 && (
                              <button 
                                type="button"
                                className="bg-gray-600 hover:bg-gray-500 text-white px-2 py-1 rounded text-xs"
                                onClick={() => setAddAttrs((prev: any) => ({ ...prev, dateAmountEntries: [] }))}
                              >
                                Clear All
                              </button>
                            )}
                            <button 
                              type="button"
                              className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs"
                              onClick={() => {
                                const currentEntries = addAttrs.dateAmountEntries || []
                                setAddAttrs((prev: any) => ({ 
                                  ...prev, 
                                  dateAmountEntries: [...currentEntries, { date: '', amount: '' }] 
                                }))
                              }}
                            >
                              Add Entry
                            </button>
                          </div>
                        </div>
                        
                        {(addAttrs.dateAmountEntries || []).length === 0 ? (
                          <div className="text-gray-500 text-sm italic text-center py-4 border border-gray-700 rounded border-dashed">
                            Click "Add Entry" to add date and amount pairs
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {(addAttrs.dateAmountEntries || []).map((entry: any, index: number) => (
                              <div key={index} className="flex gap-2 items-center">
                                <div className="flex-1">
                                  <input 
                                    type="date" 
                                    value={entry.date || ''} 
                                    onChange={(e) => {
                                      const newEntries = [...(addAttrs.dateAmountEntries || [])]
                                      newEntries[index] = { ...newEntries[index], date: e.target.value }
                                      setAddAttrs((prev: any) => ({ ...prev, dateAmountEntries: newEntries }))
                                    }}
                                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" 
                                  />
                                </div>
                                <div className="flex-1">
                                  <input 
                                    type="number" 
                                    step="0.01"
                                    value={entry.amount || ''} 
                                    onChange={(e) => {
                                      const newEntries = [...(addAttrs.dateAmountEntries || [])]
                                      newEntries[index] = { ...newEntries[index], amount: e.target.value }
                                      setAddAttrs((prev: any) => ({ ...prev, dateAmountEntries: newEntries }))
                                    }}
                                    placeholder="Amount" 
                                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" 
                                  />
                                </div>
                                <button 
                                  type="button"
                                  className="text-red-400 hover:text-red-300 px-2 py-1"
                                  onClick={() => {
                                    const newEntries = (addAttrs.dateAmountEntries || []).filter((_: any, i: number) => i !== index)
                                    setAddAttrs((prev: any) => ({ ...prev, dateAmountEntries: newEntries }))
                                  }}
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        <div className="flex flex-col">
                          <label className="text-xs text-gray-300 mb-1">Tax code</label>
                          <select value={addAttrs.taxcode ?? ''} onChange={(e) => setAddAttrs((prev: any) => ({ ...prev, taxcode: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                            <option value="">Tax code</option>
                            <option value="gst">gst</option>
                            <option value="gstfree">gstfree</option>
                          </select>
                        </div>
                      </div>
                    ) : addType === 'staff_payroll' ? (
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
                                amount: a.amount ? Number(a.amount) : null,
                                taxcode: a.taxcode || null,
                                frequency: a.frequency || null,
                                interval: a.interval ?? null,
                                start_date: a.start_date || null,
                                end_date: a.end_date || null,
                              }
                              break
                            case 'expense_on_dates':
                            case 'project_income_on_dates':
                              // Convert user-friendly format to backend format
                              const entries = a.dateAmountEntries || []
                              const dates = entries.map((entry: any) => entry.date).filter(Boolean)
                              const amounts = entries.map((entry: any) => Number(entry.amount || 0))
                              attributes = { dates, amount_array: amounts, taxcode: a.taxcode || null }
                              break
                            case 'staff_payroll':
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
                              <select value={editType} onChange={(e) => { 
                                const v = e.target.value; 
                                setEditType(v); 
                                // Initialize with one entry for date-based types if switching types
                                if (v === 'expense_on_dates' || v === 'project_income_on_dates') {
                                  setEditAttrs({ dateAmountEntries: [{ date: '', amount: '' }] }); 
                                } else {
                                  setEditAttrs({});
                                }
                              }} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                                <option value="">Select type</option>
                                <option value="owners_capital_added">owners_capital_added</option>
                                <option value="owners_capital_withdrawal">owners_capital_withdrawal</option>
                                <option value="fixed_expense_recurring">fixed_expense_recurring</option>
                                <option value="expense_on_dates">expense_on_dates</option>
                                <option value="staff_payroll">staff_payroll</option>
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
                                  <label className="text-xs text-gray-300 mb-1">Amount</label>
                                  <input value={editAttrs.amount ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, amount: e.target.value }))} placeholder="Amount" className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
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
                                <div className="flex items-center justify-between">
                                  <label className="text-xs text-gray-300">Date & Amount Entries</label>
                                  <div className="flex gap-2">
                                    {(editAttrs.dateAmountEntries || []).length > 0 && (
                                      <button 
                                        type="button"
                                        className="bg-gray-600 hover:bg-gray-500 text-white px-2 py-1 rounded text-xs"
                                        onClick={() => setEditAttrs((prev: any) => ({ ...prev, dateAmountEntries: [] }))}
                                      >
                                        Clear All
                                      </button>
                                    )}
                                    <button 
                                      type="button"
                                      className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs"
                                      onClick={() => {
                                        const currentEntries = editAttrs.dateAmountEntries || []
                                        setEditAttrs((prev: any) => ({ 
                                          ...prev, 
                                          dateAmountEntries: [...currentEntries, { date: '', amount: '' }] 
                                        }))
                                      }}
                                    >
                                      Add Entry
                                    </button>
                                  </div>
                                </div>
                                
                                {(editAttrs.dateAmountEntries || []).length === 0 ? (
                                  <div className="text-gray-500 text-sm italic text-center py-4 border border-gray-700 rounded border-dashed">
                                    Click "Add Entry" to add date and amount pairs
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    {(editAttrs.dateAmountEntries || []).map((entry: any, index: number) => (
                                      <div key={index} className="flex gap-2 items-center">
                                        <div className="flex-1">
                                          <input 
                                            type="date" 
                                            value={entry.date || ''} 
                                            onChange={(e) => {
                                              const newEntries = [...(editAttrs.dateAmountEntries || [])]
                                              newEntries[index] = { ...newEntries[index], date: e.target.value }
                                              setEditAttrs((prev: any) => ({ ...prev, dateAmountEntries: newEntries }))
                                            }}
                                            className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" 
                                          />
                                        </div>
                                        <div className="flex-1">
                                          <input 
                                            type="number" 
                                            step="0.01"
                                            value={entry.amount || ''} 
                                            onChange={(e) => {
                                              const newEntries = [...(editAttrs.dateAmountEntries || [])]
                                              newEntries[index] = { ...newEntries[index], amount: e.target.value }
                                              setEditAttrs((prev: any) => ({ ...prev, dateAmountEntries: newEntries }))
                                            }}
                                            placeholder="Amount" 
                                            className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" 
                                          />
                                        </div>
                                        <button 
                                          type="button"
                                          className="text-red-400 hover:text-red-300 px-2 py-1"
                                          onClick={() => {
                                            const newEntries = (editAttrs.dateAmountEntries || []).filter((_: any, i: number) => i !== index)
                                            setEditAttrs((prev: any) => ({ ...prev, dateAmountEntries: newEntries }))
                                          }}
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                
                                <div className="flex flex-col">
                                  <label className="text-xs text-gray-300 mb-1">Tax code</label>
                                  <select value={editAttrs.taxcode ?? ''} onChange={(e) => setEditAttrs((prev: any) => ({ ...prev, taxcode: e.target.value }))} className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2">
                                    <option value="">Tax code</option>
                                    <option value="gst">gst</option>
                                    <option value="gstfree">gstfree</option>
                                  </select>
                                </div>
                              </div>
                            ) : editType === 'staff_payroll' ? (
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
                                        amount: a.amount ? Number(a.amount) : null,
                                        taxcode: a.taxcode || null,
                                        frequency: a.frequency || null,
                                        interval: a.interval ?? null,
                                        start_date: a.start_date || null,
                                        end_date: a.end_date || null,
                                      }
                                      break
                                    case 'expense_on_dates':
                                    case 'project_income_on_dates':
                                      // Convert user-friendly format to backend format
                                      const editEntries = a.dateAmountEntries || []
                                      const editDates = editEntries.map((entry: any) => entry.date).filter(Boolean)
                                      const editAmounts = editEntries.map((entry: any) => Number(entry.amount || 0))
                                      attributes = { dates: editDates, amount_array: editAmounts, taxcode: a.taxcode || null }
                                      break
                                    case 'staff_payroll':
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
                                  // Convert backend format to user-friendly format
                                  const dates = Array.isArray(a.dates) ? a.dates : (a.dates || '').split(',').map((s: string) => s.trim()).filter(Boolean)
                                  const amounts = Array.isArray(a.amount_array) ? a.amount_array : (a.amount_array || '').split(',').map((s: string) => s.trim()).filter(Boolean)
                                  const dateAmountEntries = dates.map((date: string, index: number) => ({
                                    date: date,
                                    amount: amounts[index] || ''
                                  }))
                                  norm = {
                                    ...norm,
                                    dateAmountEntries,
                                    // Keep original format for backwards compatibility
                                    dates: Array.isArray(a.dates) ? a.dates.join(', ') : (a.dates || ''),
                                    amount_array: Array.isArray(a.amount_array) ? a.amount_array.join(', ') : (a.amount_array || ''),
                                  }
                                }
                                if (it.item_type === 'owners_capital_added' || it.item_type === 'owners_capital_withdrawal') {
                                  norm = { ...norm, amount: a.amount ?? '' }
                                }
                                if (it.item_type === 'fixed_expense_recurring' || it.item_type === 'project_income_recurring') {
                                  norm = { ...norm, amount: a.amount ?? '', interval: a.interval ?? '' }
                                }
                                if (it.item_type === 'staff_payroll') {
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
              ) : (
                <div className="mt-6 p-4 bg-gray-900/60 border border-gray-800 rounded-lg text-center">
                  <div className="text-gray-400 text-sm mb-2">Budget config required</div>
                  <div className="text-gray-500 text-xs">Please set up the budget configuration first before adding items.</div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
      <section className="max-w-4xl mx-auto pb-12 sm:px-6 lg:px-8">
        <div className="px-4 sm:px-0">
          <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-4 mt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm text-gray-300">Budget config</h3>
              {cfg && (
                <button
                  className="text-yellow-300 hover:text-yellow-400 text-xs transition-colors duration-200 flex items-center gap-1"
                  onClick={() => {
                    setCfgOpen(!cfgOpen)
                    setCfgSaveSuccess(false) // Reset success state when toggling
                    if (!cfgOpen && cfg) {
                      setCfgDraft({ ...cfg })
                    }
                  }}
                >
                  <svg className={`w-3 h-3 transition-transform duration-200 ${cfgOpen ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  {cfgOpen ? 'Close' : 'Edit config'}
                </button>
              )}
            </div>
            {cfgLoading ? (
              <div className="text-gray-400 text-sm">Loading config…</div>
            ) : cfgError ? (
              <div className="text-red-400 text-sm">{cfgError}</div>
            ) : !cfg ? (
              <div className="flex items-center justify-between">
                <div className="text-gray-400 text-sm">No config for this budget.</div>
                <button
                  className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 px-3 py-2 rounded-md text-sm"
                  onClick={async () => {
                    if (!id) return
                    setCfgLoading(true)
                    setCfgError(null)
                    try {
                      const { data, error } = await supabase.from('budget_config' as any).insert({ 
                        budget_id: id,
                        gst_frequency: null,
                        leave_entitlement_rate: null,
                        superannuation_frequency: null,
                        payroll_tax_rate: null,
                        payroll_expense_account_code: null,
                        leave_entitlement_account_code: null,
                        superannuation_expense_account_code: null,
                        gst_payment_account_code: null,
                        income_tax_payment_account_code: null,
                        workers_compensation_account_code: null,
                        payroll_tax_payment_account_code: null
                      }).select('*').maybeSingle()
                      if (error) return setCfgError(error.message)
                      setCfg(data)
                      setCfgDraft(data ? { ...data } : null)
                      setCfgOpen(true) // Open the config editor after creating
                    } catch (e: any) {
                      setCfgError(String(e?.message || e))
                    } finally {
                      setCfgLoading(false)
                    }
                  }}
                >Create config</button>
              </div>
            ) : !cfgOpen ? (
              <div className="text-gray-400 text-sm transition-opacity duration-200">Config saved. Click 'Edit config' to modify.</div>
            ) : (
              <div className="space-y-3 animate-fadeIn">
                {/* GST Frequency */}
                <div className="grid grid-cols-3 gap-3 items-start">
                  <label className="text-xs text-gray-300 pt-2">GST Frequency</label>
                  <div className="col-span-2">
                    <select
                      className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2"
                      value={cfgDraft?.gst_frequency ?? ''}
                      onChange={(e) => setCfgDraft((prev: any) => ({ ...prev, gst_frequency: e.target.value }))}
                    >
                      <option value="">Select GST frequency</option>
                      <option value="quarterly">quarterly</option>
                      <option value="monthly">monthly</option>
                    </select>
                  </div>
                </div>

                {/* Leave Entitlement Rate */}
                <div className="grid grid-cols-3 gap-3 items-start">
                  <label className="text-xs text-gray-300 pt-2">Leave Entitlement Rate (%)</label>
                  <div className="col-span-2">
                    <input
                      type="number"
                      step="0.01"
                      className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2"
                      value={cfgDraft?.leave_entitlement_rate ?? ''}
                      onChange={(e) => setCfgDraft((prev: any) => ({ ...prev, leave_entitlement_rate: e.target.value === '' ? null : Number(e.target.value) }))}
                      placeholder="e.g. 8.5"
                    />
                  </div>
                </div>

                {/* Superannuation Frequency */}
                <div className="grid grid-cols-3 gap-3 items-start">
                  <label className="text-xs text-gray-300 pt-2">Superannuation Frequency</label>
                  <div className="col-span-2">
                    <select
                      className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2"
                      value={cfgDraft?.superannuation_frequency ?? ''}
                      onChange={(e) => setCfgDraft((prev: any) => ({ ...prev, superannuation_frequency: e.target.value }))}
                    >
                      <option value="">Select superannuation frequency</option>
                      <option value="quarterly">quarterly</option>
                      <option value="monthly">monthly</option>
                    </select>
                  </div>
                </div>

                {/* Payroll Tax Rate */}
                <div className="grid grid-cols-3 gap-3 items-start">
                  <label className="text-xs text-gray-300 pt-2">Payroll Tax Rate (%)</label>
                  <div className="col-span-2">
                    <input
                      type="number"
                      step="0.01"
                      className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2"
                      value={cfgDraft?.payroll_tax_rate ?? ''}
                      onChange={(e) => setCfgDraft((prev: any) => ({ ...prev, payroll_tax_rate: e.target.value === '' ? null : Number(e.target.value) }))}
                      placeholder="e.g. 4.85"
                    />
                  </div>
                </div>

                {/* Account Codes Section */}
                <div className="border-t border-gray-700 pt-3 mt-4">
                  <h4 className="text-xs text-gray-300 mb-3 font-medium">Account Codes</h4>
                  
                  {/* Payroll Expense Account Code */}
                  <div className="grid grid-cols-3 gap-3 items-start mb-3">
                    <label className="text-xs text-gray-300 pt-2">Payroll Expense Account</label>
                    <div className="col-span-2">
                      <input
                        type="text"
                        className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2"
                        value={cfgDraft?.payroll_expense_account_code ?? ''}
                        onChange={(e) => setCfgDraft((prev: any) => ({ ...prev, payroll_expense_account_code: e.target.value }))}
                        placeholder="e.g. 6200"
                      />
                    </div>
                  </div>

                  {/* Leave Entitlement Account Code */}
                  <div className="grid grid-cols-3 gap-3 items-start mb-3">
                    <label className="text-xs text-gray-300 pt-2">Leave Entitlement Account</label>
                    <div className="col-span-2">
                      <input
                        type="text"
                        className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2"
                        value={cfgDraft?.leave_entitlement_account_code ?? ''}
                        onChange={(e) => setCfgDraft((prev: any) => ({ ...prev, leave_entitlement_account_code: e.target.value }))}
                        placeholder="e.g. 2150"
                      />
                    </div>
                  </div>

                  {/* Superannuation Expense Account Code */}
                  <div className="grid grid-cols-3 gap-3 items-start mb-3">
                    <label className="text-xs text-gray-300 pt-2">Superannuation Expense Account</label>
                    <div className="col-span-2">
                      <input
                        type="text"
                        className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2"
                        value={cfgDraft?.superannuation_expense_account_code ?? ''}
                        onChange={(e) => setCfgDraft((prev: any) => ({ ...prev, superannuation_expense_account_code: e.target.value }))}
                        placeholder="e.g. 6210"
                      />
                    </div>
                  </div>

                  {/* GST Payment Account Code */}
                  <div className="grid grid-cols-3 gap-3 items-start mb-3">
                    <label className="text-xs text-gray-300 pt-2">GST Payment Account</label>
                    <div className="col-span-2">
                      <input
                        type="text"
                        className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2"
                        value={cfgDraft?.gst_payment_account_code ?? ''}
                        onChange={(e) => setCfgDraft((prev: any) => ({ ...prev, gst_payment_account_code: e.target.value }))}
                        placeholder="e.g. 2210"
                      />
                    </div>
                  </div>

                  {/* Income Tax Payment Account Code */}
                  <div className="grid grid-cols-3 gap-3 items-start mb-3">
                    <label className="text-xs text-gray-300 pt-2">Income Tax Payment Account</label>
                    <div className="col-span-2">
                      <input
                        type="text"
                        className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2"
                        value={cfgDraft?.income_tax_payment_account_code ?? ''}
                        onChange={(e) => setCfgDraft((prev: any) => ({ ...prev, income_tax_payment_account_code: e.target.value }))}
                        placeholder="e.g. 2220"
                      />
                    </div>
                  </div>

                  {/* Workers Compensation Account Code */}
                  <div className="grid grid-cols-3 gap-3 items-start mb-3">
                    <label className="text-xs text-gray-300 pt-2">Workers Compensation Account</label>
                    <div className="col-span-2">
                      <input
                        type="text"
                        className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2"
                        value={cfgDraft?.workers_compensation_account_code ?? ''}
                        onChange={(e) => setCfgDraft((prev: any) => ({ ...prev, workers_compensation_account_code: e.target.value }))}
                        placeholder="e.g. 6220"
                      />
                    </div>
                  </div>

                  {/* Payroll Tax Payment Account Code */}
                  <div className="grid grid-cols-3 gap-3 items-start mb-3">
                    <label className="text-xs text-gray-300 pt-2">Payroll Tax Payment Account</label>
                    <div className="col-span-2">
                      <input
                        type="text"
                        className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2"
                        value={cfgDraft?.payroll_tax_payment_account_code ?? ''}
                        onChange={(e) => setCfgDraft((prev: any) => ({ ...prev, payroll_tax_payment_account_code: e.target.value }))}
                        placeholder="e.g. 2230"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    disabled={cfgSaving}
                    className={`px-3 py-2 rounded-md transition-all duration-200 flex items-center gap-2 ${
                      cfgSaving 
                        ? 'bg-yellow-300 text-gray-800 cursor-not-allowed' 
                        : cfgSaveSuccess 
                          ? 'bg-green-500 text-white' 
                          : 'bg-yellow-400 hover:bg-yellow-500 text-gray-900'
                    }`}
                    onClick={async () => {
                      if (!id || !cfgDraft || cfgSaving) return
                      setCfgSaving(true)
                      setCfgError(null)
                      setCfgSaveSuccess(false)
                      
                      // Only save the specific fields we need
                      const payload = {
                        gst_frequency: cfgDraft?.gst_frequency || null,
                        leave_entitlement_rate: cfgDraft?.leave_entitlement_rate || null,
                        superannuation_frequency: cfgDraft?.superannuation_frequency || null,
                        payroll_tax_rate: cfgDraft?.payroll_tax_rate || null,
                        payroll_expense_account_code: cfgDraft?.payroll_expense_account_code || null,
                        leave_entitlement_account_code: cfgDraft?.leave_entitlement_account_code || null,
                        superannuation_expense_account_code: cfgDraft?.superannuation_expense_account_code || null,
                        gst_payment_account_code: cfgDraft?.gst_payment_account_code || null,
                        income_tax_payment_account_code: cfgDraft?.income_tax_payment_account_code || null,
                        workers_compensation_account_code: cfgDraft?.workers_compensation_account_code || null,
                        payroll_tax_payment_account_code: cfgDraft?.payroll_tax_payment_account_code || null
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
                        if (error) {
                          setCfgError(error.message)
                          setCfgSaving(false)
                          return
                        }
                        upserted = data
                      }
                      
                      setCfg(upserted)
                      setCfgDraft(upserted ? { ...upserted } : null)
                      setCfgSaving(false)
                      setCfgSaveSuccess(true)
                      
                      // Show success state for 1.5 seconds, then close
                      setTimeout(() => {
                        setCfgSaveSuccess(false)
                        setCfgOpen(false) // Close the config fields after saving
                      }, 1500)
                    }}
                  >
                    {cfgSaving ? (
                      <>
                        <div className="w-4 h-4 border-2 border-gray-800 border-t-transparent rounded-full animate-spin"></div>
                        Saving...
                      </>
                    ) : cfgSaveSuccess ? (
                      <>
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        Saved!
                      </>
                    ) : (
                      'Save config'
                    )}
                  </button>
                  <button
                    disabled={cfgSaving}
                    className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 border border-gray-700 px-3 py-2 rounded-md transition-all duration-200"
                    onClick={() => {
                      setCfgDraft(cfg ? { ...cfg } : null)
                      setCfgOpen(false) // Close the config fields
                      setCfgSaveSuccess(false) // Reset success state
                    }}
                  >Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
