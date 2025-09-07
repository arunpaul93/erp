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
  const { user, loading: authLoading } = useAuth()
  const [orgs, setOrgs] = useState<Org[]>([])
  // Cookie helpers (client-only)
  const getCookie = (name: string): string | null => {
    if (typeof document === 'undefined') return null
    const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()\[\]\\\/\+^])/g, '\\$1') + '=([^;]*)'))
    return match ? decodeURIComponent(match[1]) : null
  }
  const setCookie = (name: string, value: string, days = 365) => {
    if (typeof document === 'undefined') return
    const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString()
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
  }
  const deleteCookie = (name: string) => {
    if (typeof document === 'undefined') return
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`
  }
  const [selectedOrgId, setSelectedOrgIdState] = useState<string | null>(null)
  const [orgInitialized, setOrgInitialized] = useState(false)
  const [loading, setLoading] = useState(false)

  const setSelectedOrgId = (id: string | null) => {
    console.log('OrgContext: setSelectedOrgId called with:', id, 'previous:', selectedOrgId)
    setSelectedOrgIdState(id)
    try {
      if (typeof window !== 'undefined') {
        if (id) {
          // Save to BOTH sessionStorage and localStorage for maximum persistence
          sessionStorage.setItem('selectedOrgId', id)
          localStorage.setItem('selectedOrgId', id)
          setCookie('selectedOrgId', id)
          console.log('OrgContext: saved to both storages:', id)
        } else {
          sessionStorage.removeItem('selectedOrgId')
          localStorage.removeItem('selectedOrgId')
          deleteCookie('selectedOrgId')
          console.log('OrgContext: removed from both storages')
        }
      }
    } catch (error) {
      console.error('OrgContext: storage error:', error)
    }
  }

  const refresh = async () => {
    // Don't fetch until auth has resolved
    if (authLoading) {
      console.log('OrgContext.refresh: auth still loading; skipping')
      return
    }
    // Also wait until we attempted to restore selection from storage
    if (!orgInitialized) {
      console.log('OrgContext.refresh: org not initialized; skipping')
      return
    }
    if (!user) {
      setOrgs([])
      // Keep selectedOrgId - user might just be loading
      return
    }

    setLoading(true)
    try {
      // Find the corresponding public user ID by email (case-insensitive)
      if (!user.email) {
        console.warn('Auth user missing email; cannot resolve public user.')
        setOrgs([])
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
        setLoading(false)
        return
      }

      // Now fetch organisations for the public user from user_role_position table
      const { data, error } = await supabase
        .from('user_role_position')
        .select('organisation_role_position_id')
        .eq('user_id', appUser.id)

      if (error) {
        console.error('Error fetching user role positions:', error)
        setOrgs([])
        return
      }

      if (!data || data.length === 0) {
        console.debug('No user_role_position rows for user', appUser.id)
        setOrgs([])
        return
      }

      // Get organisation role position IDs
      const orgRolePositionIds = [...new Set(data.map(r => r.organisation_role_position_id))]

      // Fetch organisation role IDs from organisation role positions
      const { data: orgRolePositionData, error: orgRolePositionError } = await supabase
        .from('organisation_role_position')
        .select('organisation_role_id')
        .in('id', orgRolePositionIds)

      if (orgRolePositionError) {
        console.error('Error fetching organisation role positions:', orgRolePositionError)
        setOrgs([])
        return
      }

      if (!orgRolePositionData || orgRolePositionData.length === 0) {
        setOrgs([])
        return
      }

      // Get unique organisation role IDs
      const orgRoleIds = [...new Set(orgRolePositionData.map(r => r.organisation_role_id))]

      // Fetch organisation IDs from organisation roles
      const { data: orgRoleData, error: orgRoleError } = await supabase
        .from('organisation_role')
        .select('organisation_id')
        .in('id', orgRoleIds)

      if (orgRoleError) {
        console.error('Error fetching organisation roles:', orgRoleError)
        setOrgs([])
        return
      }

      if (!orgRoleData || orgRoleData.length === 0) {
        setOrgs([])
        return
      }

      // Get unique organisation IDs
      const orgIds = [...new Set(orgRoleData.map(r => r.organisation_id))]

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

      // Only auto-select if we have no selection after initialization
      if (!selectedOrgId && finalOrgs.length > 0) {
        console.log('OrgContext: no org selected, choosing first available:', finalOrgs[0].id)
        setSelectedOrgId(finalOrgs[0].id)
      }

      // Otherwise: NEVER change the user's selection automatically
      console.log('OrgContext: keeping existing selection:', selectedOrgId)
    } catch (err) {
      console.error(err)
      setOrgs([])
      // Keep selectedOrgId even on errors
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Wait until auth resolves to avoid clearing selection on page refresh
    if (authLoading) return

    if (user?.id) {
      // User is logged in - refresh their orgs (after we initialize org)
      console.log('OrgContext: user logged in, refreshing orgs for:', user.email)
      refresh()
    } else if (user === null) {
      // User explicitly logged out - clear everything
      console.log('OrgContext: user logged out, clearing state')
      setOrgs([])
      setSelectedOrgId(null)
    }
    // If user is undefined, do nothing (still loading)
  }, [user?.id, authLoading, orgInitialized])

  // Mount: restore selectedOrgId from storage/cookie before any refresh
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const sessionStored = sessionStorage.getItem('selectedOrgId')
        const localStored = localStorage.getItem('selectedOrgId')
        const cookieStored = getCookie('selectedOrgId')
        const stored = sessionStored || localStored || cookieStored || null
        console.log('OrgContext: mount restore - session:', sessionStored, 'local:', localStored, 'cookie:', cookieStored)
        if (stored) {
          setSelectedOrgIdState(stored)
          // sync across stores
          sessionStorage.setItem('selectedOrgId', stored)
          localStorage.setItem('selectedOrgId', stored)
          setCookie('selectedOrgId', stored)
        }
      }
    } catch (e) {
      console.error('OrgContext: mount restore error:', e)
    } finally {
      setOrgInitialized(true)
    }
  }, [])

  // Extra persistence: save to storage before page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (selectedOrgId && typeof window !== 'undefined') {
        try {
          sessionStorage.setItem('selectedOrgId', selectedOrgId)
          localStorage.setItem('selectedOrgId', selectedOrgId)
          console.log('OrgContext: saved on beforeunload:', selectedOrgId)
        } catch (error) {
          console.error('OrgContext: beforeunload save error:', error)
        }
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [selectedOrgId])

  return (
    <OrgContext.Provider value={{ orgs, selectedOrgId, setSelectedOrgId, loading, refresh }}>
      {children}
    </OrgContext.Provider>
  )
}

export default OrgContext
