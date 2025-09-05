'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'

interface ShiftTemplate {
  id: string
  employee_organisation_id: string
  created_at: string
  updated_at: string
  branch_id?: string | null
}

export default function ShiftTemplatesPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [rows, setRows] = useState<ShiftTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ShiftTemplate | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    employee_organisation_id: '',
    branch_id: ''
  })
  
  // Dropdown data
  const [employeeOrgs, setEmployeeOrgs] = useState<{id: string, display: string}[]>([])
  const [branches, setBranches] = useState<{id: string, name: string}[]>([])
  const [loadingDropdowns, setLoadingDropdowns] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [authLoading, user, router])

  useEffect(() => {
    fetchRows()
    fetchDropdownData()
  }, [])

  const fetchDropdownData = async () => {
    setLoadingDropdowns(true)
    try {
      // Fetch employee organisations with user and organisation names
      console.log('Fetching employee organisations...')
      const { data: empOrgs, error: empError } = await supabase
        .from('employee_organisation')
        .select(`
          id, 
          user_id,
          organisation_id,
          user:user_id(full_name, email),
          organisation:organisation_id(name)
        `)
      
      if (empError) {
        console.error('Employee organisation fetch error:', empError)
        throw new Error(`Failed to fetch employee organisations: ${empError.message}`)
      }

      console.log('Employee orgs fetched:', empOrgs?.length || 0, 'records')

      // Fetch organisation branches  
      console.log('Fetching organisation branches...')
      const { data: orgBranches, error: branchError } = await supabase
        .from('organisation_branch')
        .select('id, name, organisation_id')
        .eq('is_active', true)
      
      if (branchError) {
        console.error('Organisation branch fetch error:', branchError)
        throw new Error(`Failed to fetch organisation branches: ${branchError.message}`)
      }

      console.log('Organisation branches fetched:', orgBranches?.length || 0, 'records')

      setEmployeeOrgs(empOrgs?.map(eo => ({
        id: eo.id,
        display: `${(eo.user as any)?.full_name || (eo.user as any)?.email || eo.user_id} - ${(eo.organisation as any)?.name || eo.organisation_id}`
      })) || [])
      
      setBranches(orgBranches || [])
    } catch (err: any) {
      console.error('Failed to load dropdown data:', err)
      setError(`Failed to load dropdown data: ${err.message}`)
    } finally {
      setLoadingDropdowns(false)
    }
  }

  const fetchRows = async () => {
    setLoading(true)
    setError(null)
    try {
      // Try the salon schema first
      let { data, error } = await supabase
        .schema('salon')
        .from('employee_shift_template')
        .select('*')
        .order('created_at', { ascending: false })

      // If permission denied, try public schema (in case a view exists)
      if (error && error.message.includes('permission denied')) {
        console.warn('Permission denied for salon schema, trying public view...')
        ;({ data, error } = await supabase
          .from('employee_shift_template')
          .select('*')
          .order('created_at', { ascending: false }))
      }

      if (error) {
        if (error.message.includes('permission denied')) {
          throw new Error('Permission denied for salon schema. Please ask your administrator to:\n1. Grant access to the salon schema, OR\n2. Create a public view: CREATE VIEW public.employee_shift_template AS SELECT * FROM salon.employee_shift_template')
        }
        throw error
      }

      setRows(data || [])
    } catch (err: any) {
      setError(err.message || 'Failed to load shift templates')
    } finally {
      setLoading(false)
    }
  }

  const openNew = () => {
    setFormData({ 
      employee_organisation_id: '', 
      branch_id: ''
    })
    setSelected(null)
    setShowForm(true)
  }

  const openEdit = (r: ShiftTemplate) => {
    setSelected(r)
    setFormData({ 
      employee_organisation_id: r.employee_organisation_id,
      branch_id: r.branch_id || ''
    })
    setShowForm(true)
  }

  const save = async () => {
    // Validate required fields
    if (!formData.employee_organisation_id?.trim()) {
      setError('Employee Organisation is required')
      return
    }
    if (!formData.branch_id?.trim()) {
      setError('Branch is required')
      return
    }

    setLoading(true)
    setError(null)
    try {
      if (selected) {
        // Try salon schema first, fallback to public
        let { error } = await supabase
          .schema('salon')
          .from('employee_shift_template')
          .update({ 
            employee_organisation_id: formData.employee_organisation_id, 
            branch_id: formData.branch_id 
          })
          .eq('id', selected.id)

        if (error && error.message.includes('permission denied')) {
          ;({ error } = await supabase
            .from('employee_shift_template')
            .update({ 
              employee_organisation_id: formData.employee_organisation_id, 
              branch_id: formData.branch_id 
            })
            .eq('id', selected.id))
        }

        if (error) throw error
      } else {
        // Try salon schema first, fallback to public
        let { data, error } = await supabase
          .schema('salon')
          .from('employee_shift_template')
          .insert({
            employee_organisation_id: formData.employee_organisation_id,
            branch_id: formData.branch_id
          })
          .select()
          .single()

        if (error && error.message.includes('permission denied')) {
          ;({ data, error } = await supabase
            .from('employee_shift_template')
            .insert({
              employee_organisation_id: formData.employee_organisation_id,
              branch_id: formData.branch_id
            })
            .select()
            .single())
        }

        if (error) throw error
        setRows(prev => [data, ...prev])
      }

      setShowForm(false)
      fetchRows()
    } catch (err: any) {
      setError(err.message || 'Save failed')
    } finally {
      setLoading(false)
    }
  }

  if (authLoading) return null

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Shift Templates (salon.employee_shift_template)</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => router.push('/home')} className="text-yellow-400">← Back</button>
            <button onClick={openNew} className="px-3 py-1 bg-yellow-400 text-black rounded">New</button>
          </div>
        </div>

        {error && <div className="text-sm text-red-400 mb-2">{error}</div>}

        {loading ? (
          <div className="text-gray-300">Loading...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rows.map(r => (
              <div key={r.id} className="p-4 bg-gray-900/60 border border-gray-800 rounded cursor-pointer hover:border-yellow-400" onClick={() => openEdit(r)}>
                <div className="text-sm text-gray-200 font-medium mb-2">
                  {new Date(r.created_at).toLocaleDateString()}
                </div>
                <div className="text-xs text-gray-400 space-y-1">
                  <div>Employee ID: {r.employee_organisation_id}</div>
                  {r.branch_id && <div>Branch ID: {r.branch_id}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {showForm && (
          <div className="fixed inset-0 flex items-center justify-center bg-black/40 z-50">
            <div className="bg-gray-900 p-6 rounded-lg w-[600px] max-w-full">
              <h2 className="text-lg font-medium text-white mb-4">{selected ? 'Edit' : 'New'} Shift Template</h2>
              
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">Employee Organisation *</label>
                    <select 
                      className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600 focus:border-yellow-400" 
                      value={formData.employee_organisation_id || ''} 
                      onChange={(e) => setFormData(fd => ({ ...fd, employee_organisation_id: e.target.value }))}
                      disabled={loadingDropdowns}
                    >
                      <option value="">Select Employee Organisation</option>
                      {employeeOrgs.map(eo => (
                        <option key={eo.id} value={eo.id}>{eo.display}</option>
                      ))}
                    </select>
                    {loadingDropdowns && <div className="text-xs text-gray-500 mt-1">Loading options...</div>}
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">Branch *</label>
                    <select 
                      className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600 focus:border-yellow-400" 
                      value={formData.branch_id || ''} 
                      onChange={(e) => setFormData(fd => ({ ...fd, branch_id: e.target.value }))}
                      disabled={loadingDropdowns}
                    >
                      <option value="">Select Branch</option>
                      {branches.map(branch => (
                        <option key={branch.id} value={branch.id}>{branch.name}</option>
                      ))}
                    </select>
                    {loadingDropdowns && <div className="text-xs text-gray-500 mt-1">Loading options...</div>}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-700 rounded text-white">Cancel</button>
                <button onClick={save} className="px-4 py-2 bg-yellow-400 text-black rounded">Save</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
