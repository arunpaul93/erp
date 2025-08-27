'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import StrategyCanvas from '@/components/StrategyCanvas'
import type { CanvasData } from '@/components/StrategyCanvas'
import WorkflowEditor, { type WorkflowGraph } from '@/components/WorkflowEditor'

export default function BusinessPlanDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = String(params?.id ?? '')
  const { user, loading: authLoading } = useAuth()
  const { selectedOrgId, orgs, loading: orgLoading } = useOrg()

  const [plan, setPlan] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Editable fields
  const [name, setName] = useState('')
  const [problem, setProblem] = useState('')

  const [uniqueSellingPoint, setUniqueSellingPoint] = useState('')
  const [targetMarket, setTargetMarket] = useState('')



  const [keyMetrics, setKeyMetrics] = useState('')
  const [risksAndPlanB, setRisksAndPlanB] = useState('')
  const [vision35Years, setVision35Years] = useState('')

  const [prioritiesNext90Days, setPrioritiesNext90Days] = useState('')
  const [operationalWorkflow, setOperationalWorkflow] = useState<WorkflowGraph | null>(null)
  // budget items are managed on the budget detail page
  const [canvas, setCanvas] = useState<CanvasData | null>(null)

  const orgName = useMemo(() => orgs.find(o => o.id === selectedOrgId)?.name ?? '—', [orgs, selectedOrgId])

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [authLoading, user, router])

  useEffect(() => {
    const run = async () => {
      if (!id || !selectedOrgId) return
      setLoading(true)
      setError(null)

      const { data, error } = await supabase
        .from('business_plan')
        .select('*')
        .eq('id', id)
        .eq('organisation_id', selectedOrgId)
        .maybeSingle()

      if (error) {
        setError(error.message)
        setPlan(null)
      } else {
        setPlan(data)
        // Hydrate form
        setName(data?.name ?? '')
        setProblem(data?.problem ?? '')

        setUniqueSellingPoint(data?.unique_selling_point ?? '')
        setTargetMarket(data?.target_market ?? '')



        setKeyMetrics(data?.key_metrics ?? '')
        setRisksAndPlanB(data?.risks_and_plan_b ?? '')
        setVision35Years(data?.vision_3_5_years ?? '')
        setCanvas((data as any)?.canvas ?? null)

        setPrioritiesNext90Days(data?.priorities_next_90_days ?? '')
        // operational_workflow now stores a visual graph (nodes/edges)
        if (data?.operational_workflow && typeof data.operational_workflow === 'object') {
          setOperationalWorkflow(data.operational_workflow as WorkflowGraph)
        } else if (typeof data?.operational_workflow === 'string') {
          try {
            const parsed = JSON.parse(data.operational_workflow)
            setOperationalWorkflow(parsed as WorkflowGraph)
          } catch {
            setOperationalWorkflow(null)
          }
        } else {
          setOperationalWorkflow(null)
        }
      }
      setLoading(false)
    }

    run()
  }, [id, selectedOrgId])

  // budget items are managed on the budget detail page

  const onSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!id || !selectedOrgId) return
    setSaving(true)
    setError(null)
    setSuccess(null)

    const { error } = await supabase
      .from('business_plan')
      .update({
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
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('organisation_id', selectedOrgId)

    if (error) {
      setError(error.message)
      setSaving(false)
      return
    }
    // Close modal / navigate back to list after save
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

      <main className="max-w-4xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 sm:px-0">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-yellow-400">Business Plan</h2>
            <p className="text-sm text-gray-400 mt-1">Organisation: {orgName}</p>
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
            {error && <div className="text-sm text-red-400 mb-2">{error}</div>}
            {success && <div className="text-sm text-green-400 mb-2">{success}</div>}
            {loading ? (
              <div className="text-gray-300">Loading…</div>
            ) : !plan ? (
              <div className="text-gray-400 text-sm">Not found.</div>
            ) : !selectedOrgId ? (
              <div className="text-gray-400 text-sm">Select an organisation first.</div>
            ) : (
              <form onSubmit={onSave} className="space-y-4">
                {/* Budget selection removed per request */}
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Name</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2"
                    placeholder="Title"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-300 mb-1">Problem</label>
                  <textarea
                    value={problem}
                    onChange={(e) => setProblem(e.target.value)}
                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 min-h-[100px]"
                  />
                </div>



                <div>
                  <label className="block text-sm text-gray-300 mb-1">Unique Selling Point</label>
                  <textarea
                    value={uniqueSellingPoint}
                    onChange={(e) => setUniqueSellingPoint(e.target.value)}
                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 min-h-[100px]"
                  />
                </div>

                {/* Strategy Canvas */}
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
                    onChange={(e) => setTargetMarket(e.target.value)}
                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 min-h-[100px]"
                  />
                </div>



                <div>
                  <label className="block text-sm text-gray-300 mb-1">Operational Workflow (visual)</label>
                  <WorkflowEditor value={operationalWorkflow} onChange={setOperationalWorkflow} height={480} />
                </div>





                <div>
                  <label className="block text-sm text-gray-300 mb-1">Key Metrics</label>
                  <textarea
                    value={keyMetrics}
                    onChange={(e) => setKeyMetrics(e.target.value)}
                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 min-h-[80px]"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-300 mb-1">Risks and Plan B</label>
                  <textarea
                    value={risksAndPlanB}
                    onChange={(e) => setRisksAndPlanB(e.target.value)}
                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 min-h-[100px]"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-300 mb-1">Vision (3–5 years)</label>
                  <textarea
                    value={vision35Years}
                    onChange={(e) => setVision35Years(e.target.value)}
                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 min-h-[100px]"
                  />
                </div>



                <div>
                  <label className="block text-sm text-gray-300 mb-1">Priorities (next 90 days)</label>
                  <textarea
                    value={prioritiesNext90Days}
                    onChange={(e) => setPrioritiesNext90Days(e.target.value)}
                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2 min-h-[100px]"
                  />
                </div>

                {/* Operational workflow steps rendered earlier in the form */}

                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-gray-900 px-4 py-2 rounded-md text-sm font-medium"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push('/business-plan')}
                    className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 px-4 py-2 rounded-md text-sm"
                  >
                    Back
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
