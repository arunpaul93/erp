'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import { supabase } from '@/lib/supabase'

interface Role {
    id: string
    organisation_id: string
    name: string
    description?: string
    created_at: string
    updated_at: string
}

interface Permission {
    id: string
    organisation_role_id: string
    table_name: string
    can_create: boolean
    can_read: boolean
    can_update: boolean
    can_delete: boolean
    created_at: string
    updated_at: string
}

interface User {
    id: string
    full_name: string
    email: string
    roles: Role[]
}

interface Organisation {
    id: string
    name: string
}

export default function PermissionsPage() {
    const router = useRouter()
    const { user, loading: authLoading } = useAuth()
    const { selectedOrgId, orgs, loading: orgLoading } = useOrg()

    // State
    const [roles, setRoles] = useState<Role[]>([])
    const [permissions, setPermissions] = useState<Permission[]>([])
    const [users, setUsers] = useState<User[]>([])
    const [publicTables, setPublicTables] = useState<string[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    // Super user functionality
    const [isSuperUser, setIsSuperUser] = useState(false)
    const [allOrganisations, setAllOrganisations] = useState<Organisation[]>([])
    const [currentOrgId, setCurrentOrgId] = useState<string | null>(null)

    // Form states
    const [showNewRoleForm, setShowNewRoleForm] = useState(false)
    const [newRoleName, setNewRoleName] = useState('')
    const [newRoleDescription, setNewRoleDescription] = useState('')

    // Redirect if not authenticated
    useEffect(() => {
        if (!authLoading && !user) router.push('/login')
    }, [authLoading, user, router])

    // Check if user is super user
    const checkSuperUserStatus = async () => {
        if (!user?.id) return

        try {
            const { data: userRoles, error } = await supabase
                .from('user_organisation_role')
                .select(`
          organisation_role:organisation_role_id (
            name
          )
        `)
                .eq('user_id', user.id)

            if (error) throw error

            const roleNames = userRoles?.map(ur => ur.organisation_role?.name).filter(Boolean) || []
            const superUserRoles = ['director', 'admin', 'super_admin', 'system_admin']
            const isSuperUserRole = roleNames.some(name => superUserRoles.includes(name.toLowerCase()))

            setIsSuperUser(isSuperUserRole)

            if (isSuperUserRole) {
                // Fetch all organizations for super user
                const { data: allOrgs, error: orgsError } = await supabase
                    .from('organisation')
                    .select('id, name')
                    .order('name')

                if (!orgsError && allOrgs) {
                    setAllOrganisations(allOrgs)
                }
            }
        } catch (err: any) {
            console.error('Error checking super user status:', err)
        }
    }

    // Set current organization ID
    useEffect(() => {
        if (isSuperUser) {
            // For super users, use their selection or default to first org
            if (!currentOrgId && allOrganisations.length > 0) {
                setCurrentOrgId(allOrganisations[0].id)
            }
        } else {
            // For regular users, use selected org from context
            setCurrentOrgId(selectedOrgId)
        }
    }, [isSuperUser, selectedOrgId, allOrganisations, currentOrgId])

    // Check super user status when user is available
    useEffect(() => {
        if (user?.id) {
            checkSuperUserStatus()
        }
    }, [user?.id])

    // Fetch data when org changes
    useEffect(() => {
        if (currentOrgId) {
            fetchData()
        }
    }, [currentOrgId])

    const fetchData = async () => {
        if (!currentOrgId) return

        setLoading(true)
        setError(null)

        try {
            // Fetch public schema tables
            const { data: tablesData, error: tablesError } = await supabase
                .from('information_schema_tables')
                .select('table_name')
                .eq('table_schema', 'public')
                .order('table_name')

            if (tablesError) throw tablesError
            setPublicTables(tablesData?.map(t => t.table_name) || [])

            // Fetch roles for this organization
            const { data: rolesData, error: rolesError } = await supabase
                .from('organisation_role')
                .select('*')
                .eq('organisation_id', currentOrgId)
                .order('name')

            if (rolesError) throw rolesError
            setRoles(rolesData || [])

            // Fetch permissions for these roles
            if (rolesData && rolesData.length > 0) {
                const roleIds = rolesData.map(r => r.id)
                const { data: permissionsData, error: permissionsError } = await supabase
                    .from('organisation_role_permission')
                    .select('*')
                    .in('organisation_role_id', roleIds)

                if (permissionsError) throw permissionsError
                setPermissions(permissionsData || [])
            } else {
                setPermissions([])
            }

            // Fetch users and their roles for this organization
            const { data: userRolesData, error: userRolesError } = await supabase
                .from('user_organisation_role')
                .select(`
          user:user_id (
            id,
            full_name,
            email
          ),
          organisation_role:organisation_role_id (
            id,
            name,
            description,
            organisation_id
          )
        `)
                .eq('organisation_role.organisation_id', currentOrgId)

            if (userRolesError) throw userRolesError

            // Group by user
            const userMap = new Map<string, User>()
            userRolesData?.forEach((ur: any) => {
                if (!ur.user || !ur.organisation_role) return

                const userId = ur.user.id
                if (!userMap.has(userId)) {
                    userMap.set(userId, {
                        id: userId,
                        full_name: ur.user.full_name,
                        email: ur.user.email,
                        roles: []
                    })
                }
                userMap.get(userId)!.roles.push(ur.organisation_role)
            })

            setUsers(Array.from(userMap.values()))
        } catch (err: any) {
            setError(err.message || 'Failed to fetch data')
        } finally {
            setLoading(false)
        }
    }

    const createRole = async () => {
        if (!currentOrgId || !newRoleName.trim()) return
        setSaving(true)
        setError(null)

        try {
            const { data, error } = await supabase
                .from('organisation_role')
                .insert({
                    organisation_id: currentOrgId,
                    name: newRoleName.trim(),
                    description: newRoleDescription.trim() || null
                })
                .select()
                .single()

            if (error) throw error

            setRoles(prev => [...prev, data])
            setNewRoleName('')
            setNewRoleDescription('')
            setShowNewRoleForm(false)
        } catch (err: any) {
            setError(err.message || 'Failed to create role')
        } finally {
            setSaving(false)
        }
    }

    const updatePermission = async (roleId: string, tableName: string, field: keyof Omit<Permission, 'id' | 'organisation_role_id' | 'table_name' | 'created_at' | 'updated_at'>, value: boolean) => {
        try {
            const existing = permissions.find(p => p.organisation_role_id === roleId && p.table_name === tableName)

            if (existing) {
                const { error } = await supabase
                    .from('organisation_role_permission')
                    .update({ [field]: value })
                    .eq('id', existing.id)

                if (error) throw error

                setPermissions(prev => prev.map(p =>
                    p.id === existing.id ? { ...p, [field]: value } : p
                ))
            } else {
                const { data, error } = await supabase
                    .from('organisation_role_permission')
                    .insert({
                        organisation_role_id: roleId,
                        table_name: tableName,
                        can_create: field === 'can_create' ? value : false,
                        can_read: field === 'can_read' ? value : false,
                        can_update: field === 'can_update' ? value : false,
                        can_delete: field === 'can_delete' ? value : false
                    })
                    .select()
                    .single()

                if (error) throw error

                setPermissions(prev => [...prev, data])
            }
        } catch (err: any) {
            setError(err.message || 'Failed to update permission')
        }
    }

    if (authLoading || orgLoading) return null

    const orgName = isSuperUser
        ? allOrganisations.find(org => org.id === currentOrgId)?.name
        : orgs.find(org => org.id === selectedOrgId)?.name

    return (
        <div className="min-h-screen bg-gray-950">
            <nav className="bg-gray-900 shadow">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16">
                        <div className="flex items-center">
                            <button onClick={() => router.push('/home')} className="text-yellow-400 hover:text-yellow-300 text-sm">← Back</button>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-gray-300">{user?.email}</span>
                        </div>
                    </div>
                </div>
            </nav>

            <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
                <div className="px-4 sm:px-0">
                    <div className="mb-6">
                        <h1 className="text-3xl font-bold text-white mb-2">Permissions Management</h1>

                        {/* Organization Switcher for Super Users */}
                        {isSuperUser && allOrganisations.length > 0 && (
                            <div className="mb-4">
                                <label htmlFor="org-select" className="block text-sm font-medium text-gray-300 mb-2">
                                    Select Organization:
                                </label>
                                <select
                                    id="org-select"
                                    value={currentOrgId || ''}
                                    onChange={(e) => setCurrentOrgId(e.target.value)}
                                    className="block w-full max-w-md px-3 py-2 border border-gray-600 bg-gray-800 text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                >
                                    <option value="">Select an organization...</option>
                                    {allOrganisations.map((org) => (
                                        <option key={org.id} value={org.id}>
                                            {org.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <p className="text-gray-300">
                            Manage user roles and permissions for your organization.
                            {isSuperUser && " As a super user, you can manage permissions across all organizations."}
                        </p>
                        <p className="text-sm text-gray-400 mt-1">Organisation: {orgName}</p>
                    </div>

                    {error && <div className="mb-4 text-sm text-red-400">{error}</div>}

                    {!currentOrgId ? (
                        <div className="text-gray-400 text-sm">
                            {isSuperUser ? "Please select an organisation from the dropdown above." : "Please select an organisation first."}
                        </div>
                    ) : loading ? (
                        <div className="text-gray-300">Loading...</div>
                    ) : (
                        <div className="space-y-8">
                            {/* Roles Section */}
                            <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-6">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-medium text-gray-100">Roles</h3>
                                    <button
                                        onClick={() => setShowNewRoleForm(true)}
                                        className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 px-4 py-2 rounded-md text-sm font-medium"
                                    >
                                        Add Role
                                    </button>
                                </div>

                                {showNewRoleForm && (
                                    <div className="mb-4 p-4 border border-gray-700 rounded-lg bg-gray-800/50">
                                        <div className="space-y-3">
                                            <input
                                                type="text"
                                                placeholder="Role name"
                                                value={newRoleName}
                                                onChange={(e) => setNewRoleName(e.target.value)}
                                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                            <input
                                                type="text"
                                                placeholder="Role description (optional)"
                                                value={newRoleDescription}
                                                onChange={(e) => setNewRoleDescription(e.target.value)}
                                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={createRole}
                                                    disabled={saving || !newRoleName.trim()}
                                                    className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm"
                                                >
                                                    {saving ? 'Creating...' : 'Create Role'}
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setShowNewRoleForm(false)
                                                        setNewRoleName('')
                                                        setNewRoleDescription('')
                                                    }}
                                                    className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md text-sm"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {roles.length === 0 ? (
                                    <div className="text-gray-400 text-sm">No roles found for this organization.</div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {roles.map((role) => (
                                            <div key={role.id} className="p-4 border border-gray-700 rounded-lg bg-gray-800/30">
                                                <h4 className="font-medium text-gray-100">{role.name}</h4>
                                                {role.description && (
                                                    <p className="text-sm text-gray-400 mt-1">{role.description}</p>
                                                )}
                                                <p className="text-xs text-gray-500 mt-2">
                                                    Created: {new Date(role.created_at).toLocaleDateString()}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Permissions Matrix */}
                            <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-6">
                                <h3 className="text-lg font-medium text-gray-100 mb-4">Permissions Matrix</h3>

                                {roles.length === 0 || publicTables.length === 0 ? (
                                    <div className="text-gray-400 text-sm">
                                        {roles.length === 0 ? 'Create roles first to manage permissions.' : 'No public tables found.'}
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full border-collapse">
                                            <thead>
                                                <tr>
                                                    <th className="text-left p-3 border border-gray-700 bg-gray-800 text-gray-200 font-medium">Table</th>
                                                    {roles.map((role) => (
                                                        <th key={role.id} className="text-center p-3 border border-gray-700 bg-gray-800 text-gray-200 font-medium min-w-[120px]">
                                                            {role.name}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {publicTables.map((tableName) => (
                                                    <tr key={tableName}>
                                                        <td className="p-3 border border-gray-700 bg-gray-900/50 text-gray-300 font-mono text-sm">
                                                            {tableName}
                                                        </td>
                                                        {roles.map((role) => {
                                                            const permission = permissions.find(p => p.organisation_role_id === role.id && p.table_name === tableName)
                                                            return (
                                                                <td key={role.id} className="p-2 border border-gray-700 bg-gray-900/30">
                                                                    <div className="flex justify-center gap-1">
                                                                        {(['can_create', 'can_read', 'can_update', 'can_delete'] as const).map((action) => {
                                                                            const isChecked = permission?.[action] || false
                                                                            const actionLabel = action.replace('can_', '').charAt(0).toUpperCase()
                                                                            return (
                                                                                <button
                                                                                    key={action}
                                                                                    onClick={() => updatePermission(role.id, tableName, action, !isChecked)}
                                                                                    className={`w-6 h-6 rounded text-xs font-bold transition-colors ${isChecked
                                                                                            ? 'bg-green-600 text-white hover:bg-green-700'
                                                                                            : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                                                                                        }`}
                                                                                    title={`${action.replace('_', ' ')} for ${tableName}`}
                                                                                >
                                                                                    {actionLabel}
                                                                                </button>
                                                                            )
                                                                        })}
                                                                    </div>
                                                                </td>
                                                            )
                                                        })}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            {/* Users and Roles Overview */}
                            <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-6">
                                <h3 className="text-lg font-medium text-gray-100 mb-4">Users and Roles</h3>

                                {users.length === 0 ? (
                                    <div className="text-gray-400 text-sm">No users with roles found for this organization.</div>
                                ) : (
                                    <div className="space-y-3">
                                        {users.map((user) => (
                                            <div key={user.id} className="p-4 border border-gray-700 rounded-lg bg-gray-800/30">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <h4 className="font-medium text-gray-100">{user.full_name}</h4>
                                                        <p className="text-sm text-gray-400">{user.email}</p>
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                        {user.roles.map(role => (
                                                            <span
                                                                key={role.id}
                                                                className="px-2 py-1 bg-yellow-400/20 text-yellow-300 text-xs rounded-full"
                                                            >
                                                                {role.name}
                                                            </span>
                                                        ))}
                                                        {user.roles.length === 0 && (
                                                            <span className="text-gray-500 text-sm">No roles assigned</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    )
}
