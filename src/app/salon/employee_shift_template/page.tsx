'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'

type UUID = string

type Shift = {
  shift_start_time: string
  shift_end_time: string
  unpaid_meal_break_start_time?: string
  unpaid_meal_break_end_time?: string
  paid_rest_break_minutes: number
  open_to_bookings: boolean
}

type Day = {
  day: string
  shifts: Shift[]
}

type Week = {
  week: number
  days: Day[]
}

type Attributes = {
  frequency: 'weekly'
  start_date: string
  end_date?: string | null
  interval_weeks: number
  weeks: Week[]
}

type Template = {
  id: UUID
  employee_organisation_id: UUID | null
  branch_id: UUID | null
  attributes: Attributes
  created_at?: string
  updated_at?: string
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const defaultShift: Shift = {
  shift_start_time: '09:00',
  shift_end_time: '17:00',
  paid_rest_break_minutes: 0,
  open_to_bookings: true,
}

const newAttributes = (): Attributes => ({
  frequency: 'weekly',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: null,
  interval_weeks: 1,
  weeks: [
    {
      week: 1,
      days: DAYS.map((d) => ({ day: d, shifts: [] })),
    },
  ],
})

export default function EmployeeShiftTemplatesPage() {
  const { user, loading: authLoading } = useAuth()
  const [loading, setLoading] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [editingId, setEditingId] = useState<UUID | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [employeeOrgs, setEmployeeOrgs] = useState<{ id: UUID; display: string }[]>([])
  const [branches, setBranches] = useState<{ id: UUID; name: string }[]>([])
  const [form, setForm] = useState<{
    employee_organisation_id: UUID | ''
    branch_id: UUID | ''
    attributes: Attributes
  }>({
    employee_organisation_id: '',
    branch_id: '',
    attributes: newAttributes(),
  })

  useEffect(() => {
    if (user) {
      void fetchDropdowns()
      void fetchTemplates()
    }
  }, [user])

  const fetchDropdowns = async () => {
    try {
      const { data: empOrgs, error: empErr } = await supabase
        .from('employee_organisation')
        .select(
          `id, user:user_id(full_name, email), organisation:organisation_id(name)`
        )
      if (empErr) throw empErr
      setEmployeeOrgs(
        (empOrgs || []).map((eo: any) => ({
          id: eo.id,
          display: `${eo.user?.full_name || eo.user?.email || 'User'} - ${eo.organisation?.name || 'Org'}`,
        }))
      )

      const { data: orgBranches, error: brErr } = await supabase
        .from('organisation_branch')
        .select('id, name')
        .eq('is_active', true)
      if (brErr) throw brErr
      setBranches(orgBranches || [])
    } catch (e) {
      console.error('Dropdowns load failed', e)
    }
  }

  const fetchTemplates = async () => {
    try {
      let q = supabase.schema('salon').from('employee_shift_template').select('*').order('created_at', { ascending: false })
      let { data, error } = await q
      if (error && String(error.message).includes('permission denied')) {
        ; ({ data, error } = await supabase.from('employee_shift_template').select('*').order('created_at', { ascending: false }))
      }
      if (error) throw error
      setTemplates((data || []) as any)
    } catch (e) {
      console.error('Templates load failed', e)
    }
  }

  // Helpers
  const timeToMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }
  const minutesToHours = (mins: number) => {
    const h = Math.max(0, Math.floor(mins / 60))
    const m = Math.max(0, mins % 60)
    return `${h}h${m ? ` ${m}m` : ''}`
  }

  const mealBreakMinutes = (s: Shift) => {
    if (!s.unpaid_meal_break_start_time || !s.unpaid_meal_break_end_time) return 0
    return Math.max(
      0,
      timeToMinutes(s.unpaid_meal_break_end_time) - timeToMinutes(s.unpaid_meal_break_start_time)
    )
  }

  const shiftMinutes = (s: Shift) => {
    return Math.max(0, timeToMinutes(s.shift_end_time) - timeToMinutes(s.shift_start_time) - mealBreakMinutes(s))
  }

  const dayMinutes = (d: Day) => d.shifts.reduce((acc, s) => acc + shiftMinutes(s), 0)
  const weekMinutes = (w: Week) => w.days.reduce((acc, d) => acc + dayMinutes(d), 0)

  const timeOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = []
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 30) {
        const v = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
        const hr12 = h % 12 || 12
        const ampm = h < 12 ? 'am' : 'pm'
        opts.push({ value: v, label: `${hr12}:${String(m).padStart(2, '0')}${ampm}` })
      }
    }
    return opts
  }, [])

  // Form updaters
  const setIntervalWeeks = (n: number) => {
    setForm((prev) => {
      const weeks = [...prev.attributes.weeks]
      if (n > weeks.length) {
        for (let i = weeks.length; i < n; i++) {
          weeks.push({ week: i + 1, days: DAYS.map((d) => ({ day: d, shifts: [] })) })
        }
      } else if (n < weeks.length) {
        weeks.length = n
      }
      weeks.forEach((w, idx) => (w.week = idx + 1))
      return { ...prev, attributes: { ...prev.attributes, interval_weeks: n, weeks } }
    })
  }

  const toggleDay = (weekIndex: number, dayIndex: number, on: boolean) => {
    setForm((prev) => {
      const weeks = structuredClone(prev.attributes.weeks)
      const day = weeks[weekIndex].days[dayIndex]
      if (on && day.shifts.length === 0) day.shifts.push({ ...defaultShift })
      if (!on) day.shifts = []
      return { ...prev, attributes: { ...prev.attributes, weeks } }
    })
  }

  const addShift = (weekIndex: number, dayIndex: number) => {
    setForm((prev) => {
      const weeks = structuredClone(prev.attributes.weeks)
      weeks[weekIndex].days[dayIndex].shifts.push({ ...defaultShift })
      return { ...prev, attributes: { ...prev.attributes, weeks } }
    })
  }

  const removeShift = (weekIndex: number, dayIndex: number, shiftIndex: number) => {
    setForm((prev) => {
      const weeks = structuredClone(prev.attributes.weeks)
      weeks[weekIndex].days[dayIndex].shifts.splice(shiftIndex, 1)
      return { ...prev, attributes: { ...prev.attributes, weeks } }
    })
  }

  const updateShift = (weekIndex: number, dayIndex: number, shiftIndex: number, patch: Partial<Shift>) => {
    setForm((prev) => {
      const weeks = structuredClone(prev.attributes.weeks)
      weeks[weekIndex].days[dayIndex].shifts[shiftIndex] = {
        ...weeks[weekIndex].days[dayIndex].shifts[shiftIndex],
        ...patch,
      }
      return { ...prev, attributes: { ...prev.attributes, weeks } }
    })
  }

  const startEditing = (t: Template) => {
    setEditingId(t.id)
    setForm({
      employee_organisation_id: (t.employee_organisation_id || '') as any,
      branch_id: (t.branch_id || '') as any,
      attributes: structuredClone(t.attributes),
    })
    setShowModal(true)
  }

  const resetForm = () => {
    setEditingId(null)
    setForm({ employee_organisation_id: '', branch_id: '', attributes: newAttributes() })
  }

  const save = async () => {
    if (!form.attributes.start_date) {
      alert('Start date is required')
      return
    }
    setLoading(true)
    try {
      const payload: any = {
        employee_organisation_id: form.employee_organisation_id || null,
        branch_id: form.branch_id || null,
        attributes: { ...form.attributes, end_date: form.attributes.end_date || null },
      }

      let error: any = null
      if (editingId) {
        let res = await supabase.schema('salon').from('employee_shift_template').update(payload).eq('id', editingId)
        error = res.error
        if (error && String(error.message).includes('permission denied')) {
          res = await supabase.from('employee_shift_template').update(payload).eq('id', editingId)
          error = res.error
        }
      } else {
        let res = await supabase.schema('salon').from('employee_shift_template').insert(payload)
        error = res.error
        if (error && String(error.message).includes('permission denied')) {
          res = await supabase.from('employee_shift_template').insert(payload)
          error = res.error
        }
      }

      if (error) throw error
      await fetchTemplates()
      resetForm()
      alert('Saved')
    } catch (e) {
      console.error('Save failed', e)
      alert('Error saving template')
    } finally {
      setLoading(false)
    }
  }

  if (authLoading) return null

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="mx-auto max-w-6xl p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-100">Employee Shift Templates</h1>
            <p className="text-sm text-gray-400">Create and edit recurring weekly shift templates.</p>
          </div>
          <button
            onClick={() => {
              resetForm()
              setShowModal(true)
            }}
            className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-yellow-400"
          >
            New Template
          </button>
        </div>

        {/* List */}
        <div className="mb-8 grid gap-3">
          {templates.map((t) => (
            <div key={t.id} className="rounded-xl border border-gray-800 bg-gray-900/80 backdrop-blur p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-300">
                  <div className="text-base font-semibold text-gray-100">
                    {employeeOrgs.find((eo) => eo.id === (t.employee_organisation_id as any))?.display || 'Unassigned'}
                  </div>
                  {(t.branch_id) && (
                    <div className="mt-0.5 text-xs text-gray-400">
                      Branch: {branches.find((b) => b.id === (t.branch_id as any))?.name || t.branch_id}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-gray-400">
                    {t.attributes.start_date} {t.attributes.end_date ? `→ ${t.attributes.end_date}` : ''}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Weekly • {t.attributes.interval_weeks} week{t.attributes.interval_weeks > 1 ? 's' : ''} • Weeks: {t.attributes.weeks.length} • Total: {minutesToHours(t.attributes.weeks.reduce((acc, w) => acc + weekMinutes(w), 0))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startEditing(t)}
                    className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 hover:bg-gray-700"
                  >
                    Edit
                  </button>
                </div>
              </div>
            </div>
          ))}
          {templates.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-800 bg-gray-900 p-6 text-center text-gray-400">
              No templates yet.
            </div>
          )}
        </div>
        {/* Modal: Create/Edit Template (full-screen) */}
        {showModal && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/60"
              onClick={() => setShowModal(false)}
            />
            <div className="fixed inset-0 z-50 flex h-screen w-screen flex-col">
              <div className="flex h-full w-full flex-col bg-gray-900 border border-gray-800 shadow-xl">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 p-4 bg-gray-900">
                  <h2 className="text-lg font-semibold text-gray-100">{editingId ? 'Edit Template' : 'New Template'}</h2>
                  <button
                    onClick={() => setShowModal(false)}
                    className="rounded-md p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-100"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-5">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-300">Employee Organisation</label>
                      <select
                        value={form.employee_organisation_id}
                        onChange={(e) => setForm((p) => ({ ...p, employee_organisation_id: (e.target.value as any) }))}
                        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-yellow-500 focus:ring-2 focus:ring-yellow-500/20"
                      >
                        <option value="">Select</option>
                        {employeeOrgs.map((eo) => (
                          <option key={eo.id} value={eo.id}>{eo.display}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-300">Branch</label>
                      <select
                        value={form.branch_id}
                        onChange={(e) => setForm((p) => ({ ...p, branch_id: (e.target.value as any) }))}
                        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-yellow-500 focus:ring-2 focus:ring-yellow-500/20"
                      >
                        <option value="">Select</option>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-300">Start Date</label>
                      <input
                        type="date"
                        value={form.attributes.start_date}
                        onChange={(e) => setForm((p) => ({ ...p, attributes: { ...p.attributes, start_date: e.target.value } }))}
                        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-yellow-500 focus:ring-2 focus:ring-yellow-500/20"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-300">End Date (optional)</label>
                      <input
                        type="date"
                        value={form.attributes.end_date || ''}
                        onChange={(e) => setForm((p) => ({ ...p, attributes: { ...p.attributes, end_date: e.target.value || null } }))}
                        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-yellow-500 focus:ring-2 focus:ring-yellow-500/20"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-300">Repeat every (weeks)</label>
                      <select
                        value={form.attributes.interval_weeks}
                        onChange={(e) => setIntervalWeeks(parseInt(e.target.value))}
                        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-yellow-500 focus:ring-2 focus:ring-yellow-500/20"
                      >
                        <option value={1}>Every week</option>
                        <option value={2}>Every 2 weeks</option>
                        <option value={3}>Every 3 weeks</option>
                        <option value={4}>Every 4 weeks</option>
                      </select>
                    </div>
                  </div>

                  {/* Weeks */}
                  <div className="mt-6 space-y-6">
                    {form.attributes.weeks.map((w, wi) => (
                      <div key={wi} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
                        <div className="mb-4 flex items-center justify-between">
                          <div className="text-sm font-semibold text-gray-100">Week {w.week}</div>
                          <div className="text-xs text-gray-400">Total: {minutesToHours(weekMinutes(w))}</div>
                        </div>
                        <div className="space-y-3">
                          {w.days.map((d, di) => (
                            <div key={di} className="flex items-start gap-4 rounded-lg border border-gray-800 bg-gray-900 p-3">
                              <div className="flex w-32 items-center gap-2">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-gray-600 text-yellow-500 focus:ring-yellow-500 bg-gray-800"
                                  checked={d.shifts.length > 0}
                                  onChange={(e) => toggleDay(wi, di, e.target.checked)}
                                />
                                <div>
                                  <div className="font-medium text-gray-100">{d.day}</div>
                                  <div className="text-xs text-gray-500">{minutesToHours(dayMinutes(d))}</div>
                                </div>
                              </div>

                              <div className="flex-1">
                                {d.shifts.length === 0 ? (
                                  <div className="text-sm text-gray-500">No shifts</div>
                                ) : (
                                  <div className="space-y-3">
                                    {d.shifts.map((s, si) => (
                                      <div key={si} className="rounded-md border border-gray-800 bg-gray-800 p-3">
                                        <div className="mb-2 flex items-center gap-2">
                                          <select
                                            value={s.shift_start_time}
                                            onChange={(e) => updateShift(wi, di, si, { shift_start_time: e.target.value })}
                                            className="rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-100"
                                          >
                                            {timeOptions.map((o) => (
                                              <option key={o.value} value={o.value}>{o.label}</option>
                                            ))}
                                          </select>
                                          <span className="text-gray-500">-</span>
                                          <select
                                            value={s.shift_end_time}
                                            onChange={(e) => updateShift(wi, di, si, { shift_end_time: e.target.value })}
                                            className="rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-100"
                                          >
                                            {timeOptions.map((o) => (
                                              <option key={o.value} value={o.value}>{o.label}</option>
                                            ))}
                                          </select>

                                          <button
                                            onClick={() => removeShift(wi, di, si)}
                                            className="ml-auto rounded-md p-1 text-gray-400 hover:bg-gray-700 hover:text-gray-100"
                                            title="Delete shift"
                                          >
                                            🗑
                                          </button>
                                        </div>

                                        {/* Meal break + rest + open */}
                                        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                                          <div className="flex items-center gap-2 text-sm">
                                            <span className="text-gray-300">Meal:</span>
                                            <select
                                              value={s.unpaid_meal_break_start_time || ''}
                                              onChange={(e) => updateShift(wi, di, si, { unpaid_meal_break_start_time: e.target.value || undefined })}
                                              className="rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-100"
                                            >
                                              <option value="">Start</option>
                                              {timeOptions.map((o) => (
                                                <option key={o.value} value={o.value}>{o.label}</option>
                                              ))}
                                            </select>
                                            <span className="text-gray-500">-</span>
                                            <select
                                              value={s.unpaid_meal_break_end_time || ''}
                                              onChange={(e) => updateShift(wi, di, si, { unpaid_meal_break_end_time: e.target.value || undefined })}
                                              className="rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-100"
                                            >
                                              <option value="">End</option>
                                              {timeOptions.map((o) => (
                                                <option key={o.value} value={o.value}>{o.label}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <label className="flex items-center gap-2 text-sm">
                                            <span className="text-gray-300">Open to bookings:</span>
                                            <input
                                              type="checkbox"
                                              checked={s.open_to_bookings}
                                              onChange={(e) => updateShift(wi, di, si, { open_to_bookings: e.target.checked })}
                                              className="h-4 w-4 rounded border-gray-600 text-yellow-500 focus:ring-yellow-500 bg-gray-800"
                                            />
                                          </label>
                                          <div className="text-xs text-gray-400">Scheduled: {minutesToHours(shiftMinutes(s))}</div>
                                        </div>
                                      </div>
                                    ))}

                                    <button
                                      type="button"
                                      onClick={() => addShift(wi, di)}
                                      className="text-sm font-medium text-yellow-400 hover:text-yellow-300"
                                    >
                                      Add a shift
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="sticky bottom-0 z-10 flex justify-end gap-3 border-t border-gray-800 p-4 bg-gray-900">
                  <button
                    onClick={() => setShowModal(false)}
                    className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-100 hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={save}
                    disabled={loading}
                    className="rounded-lg bg-yellow-500 px-5 py-2 text-sm font-semibold text-gray-900 hover:bg-yellow-400 disabled:opacity-50"
                  >
                    {loading ? 'Saving...' : 'Save Template'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
