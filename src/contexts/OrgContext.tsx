'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

type Org = { id: string; name: string }

interface OrgContextType {
  orgs: Org[]
  selectedOrgId: string | null
  setSelectedOrgId: (id: string | null) => void
  loading: boolean
  refresh: () => Promise<void>
}

const OrgContext = createContext<OrgContextType | undefined>(undefined)

export const useOrg = () => {
  const ctx = useContext(OrgContext)
  if (!ctx) throw new Error('useOrg must be used within an OrgProvider')
  return ctx
}

export const OrgProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [selectedOrgId, setSelectedOrgIdState] = useState<string | null>(() => {
    try {
      return typeof window !== 'undefined' ? localStorage.getItem('selectedOrgId') : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(false)

  const setSelectedOrgId = (id: string | null) => {
    setSelectedOrgIdState(id)
    try {
      if (typeof window !== 'undefined') {
        if (id) localStorage.setItem('selectedOrgId', id)
        else localStorage.removeItem('selectedOrgId')
      }
    } catch { }
  }

  const refresh = async () => {
    if (!user) {
      setOrgs([])
      setSelectedOrgId(null)
      return
    }

    setLoading(true)
    try {
      // Find the corresponding public user ID by email (case-insensitive)
      if (!user.email) {
        console.warn('Auth user missing email; cannot resolve public user.')
        setOrgs([])
        setSelectedOrgId(null)
        setLoading(false)
        return
      }
      const { data: appUser, error: userError } = await supabase
        .from('user')
        .select('id')
        .ilike('email', user.email)
        .single()

      if (userError || !appUser) {
        console.error('Error fetching public user:', userError)
        setOrgs([])
        setSelectedOrgId(null)
        setLoading(false)
        return
      }

      // Now fetch organisations for the public user from employee_organisation table
      const { data, error } = await supabase
        .from('employee_organisation')
        .select('organisation_id')
        .eq('user_id', appUser.id)

      if (error) {
        console.error('Error fetching organisations:', error)
        setOrgs([])
        return
      }

      if (!data || data.length === 0) {
        console.debug('No employee_organisation rows for user', appUser.id)
        setOrgs([])
        return
      }

      // Get unique organisation IDs
      const orgIds = [...new Set(data.map(r => r.organisation_id))]

      // Fetch organisation names
      const { data: orgData, error: orgError } = await supabase
        .from('organisation')
        .select('id, name')
        .in('id', orgIds)

      if (orgError) {
        console.error('Error fetching organisation names:', orgError)
        // Fall back to IDs so the dropdown still shows entries
        const fallback: Org[] = orgIds.map((id) => ({ id: String(id), name: String(id) }))
        setOrgs(fallback)
        return
      }

      const mapped: Org[] = (orgData || []).map((r: any) => ({
        id: String(r.id),
        name: String(r.name),
      }))

      // If orgData returned empty unexpectedly, still fall back to ids
      let finalOrgs: Org[]
      if (mapped.length === 0) {
        finalOrgs = orgIds.map((id) => ({ id: String(id), name: String(id) }))
      } else {
        // dedupe by id (sometimes multiple rows per org)
        finalOrgs = Array.from(new Map(mapped.map((o) => [o.id, o])).values())
      }

      setOrgs(finalOrgs)

      // ensure selectedOrgId is still valid
      if (finalOrgs.length > 0) {
        const exists = finalOrgs.some((m: Org) => m.id === selectedOrgId)
        if (!exists) setSelectedOrgId(finalOrgs[0].id)
      } else {
        setSelectedOrgId(null)
      }
    } catch (err) {
      console.error(err)
      setOrgs([])
      setSelectedOrgId(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // refresh when user changes
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  return (
    <OrgContext.Provider value={{ orgs, selectedOrgId, setSelectedOrgId, loading, refresh }}>
      {children}
    </OrgContext.Provider>
  )
}

export default OrgContext
