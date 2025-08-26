"use client"

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

export default function NewBudgetPage() {
  const router = useRouter()
  const params = useParams() as { id?: string }
  const planId = params?.id
  const { user, loading: authLoading } = useAuth()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [authLoading, user, router])

  const onCreate = async () => {
    if (!planId) return
    if (!name.trim()) return setError('Enter a name')
    setLoading(true)
    const today = new Date()
    const start = new Date(today.getFullYear(), today.getMonth(), 1)
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    const { data, error } = await supabase.from('budget').insert({
      name: name.trim(),
      business_plan_id: planId,
      period_start: start.toISOString().slice(0, 10),
      period_end: end.toISOString().slice(0, 10),
    }).select('id').maybeSingle()
    setLoading(false)
    if (error) return setError(error.message)
    if (data) router.push(`/business-plan/${planId}/budgets`)
  }

  if (authLoading) return null

  return (
    <div className="min-h-screen bg-gray-950">
      <main className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 sm:px-0">
          <h2 className="text-2xl font-bold text-yellow-400">Create Budget</h2>
          <div className="mt-4 rounded-xl border border-gray-800 bg-gray-900/80 p-4">
            {error && <div className="text-sm text-red-400 mb-2">{error}</div>}
            <div className="space-y-3">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Budget name" className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
              <div className="flex gap-2">
                <button onClick={onCreate} className="bg-yellow-400 text-gray-900 px-4 py-2 rounded-md">Create</button>
                <button onClick={() => router.push(`/business-plan/${planId}/budgets`)} className="bg-gray-800 text-gray-200 border border-gray-700 px-4 py-2 rounded-md">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
