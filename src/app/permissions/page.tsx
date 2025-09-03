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
    const [schemasTables, setSchemasTables] = useState<{ [schema: string]: string[] }>({
        public: [],
        ndis: [],
        salon: []
    })
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

    // Delete confirmation states
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [roleToDelete, setRoleToDelete] = useState<Role | null>(null)

    // Redirect if not authenticated
    useEffect(() => {
        if (!authLoading && !user) router.push('/login')
    }, [authLoading, user, router])

    // Check if user is super user for the current organization
    const checkSuperUserStatus = async () => {
        if (!user?.id || !currentOrgId) return

        try {
            const { data: userRoles, error } = await supabase
                .from('user_organisation_role')
                .select(`
          organisation_role:organisation_role_id (
            name,
            organisation_id
          )
        `)
                .eq('user_id', user.id)

            if (error) throw error

            console.log('User roles:', userRoles)
            console.log('Current org ID:', currentOrgId)

            // Check if user has super user role specifically in the current organization
            const currentOrgRoles = userRoles?.filter(ur =>
                (ur.organisation_role as any)?.organisation_id === currentOrgId
            ) || []

            console.log('Current org roles:', currentOrgRoles)

            const roleNames = currentOrgRoles.map(ur => (ur.organisation_role as any)?.name).filter(Boolean) || []
            console.log('Role names:', roleNames)

            const superUserRoles = ['director', 'admin', 'super_admin', 'system_admin']
            const isSuperUserForCurrentOrg = roleNames.some(name => superUserRoles.includes(name.toLowerCase()))

            console.log('Is super user for current org:', isSuperUserForCurrentOrg)

            setIsSuperUser(isSuperUserForCurrentOrg)

            // Only fetch all organizations if user is super user for current org
            if (isSuperUserForCurrentOrg) {
                const { data: allOrgs, error: orgsError } = await supabase
                    .from('organisation')
                    .select('id, name')
                    .order('name')

                if (!orgsError && allOrgs) {
                    setAllOrganisations(allOrgs)
                }
            } else {
                setAllOrganisations([])
            }
        } catch (err: any) {
            console.error('Error checking super user status:', err)
        }
    }

    // Initialize current organization ID first
    useEffect(() => {
        if (!currentOrgId) {
            // Start with selectedOrgId from context as default
            if (selectedOrgId) {
                setCurrentOrgId(selectedOrgId)
            }
        }
    }, [selectedOrgId, currentOrgId])

    // Check super user status when user or currentOrgId changes
    useEffect(() => {
        if (user?.id && currentOrgId) {
            checkSuperUserStatus()
        }
    }, [user?.id, currentOrgId])

    // Update current org selection for super users
    useEffect(() => {
        if (isSuperUser && allOrganisations.length > 0) {
            // If current org is not in the list, set to first available
            const currentOrgExists = allOrganisations.some(org => org.id === currentOrgId)
            if (!currentOrgExists) {
                setCurrentOrgId(allOrganisations[0].id)
            }
        }
    }, [isSuperUser, allOrganisations, currentOrgId])

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
            // Define hardcoded tables for all schemas
            const tablesData: { [schema: string]: string[] } = {
                public: [
                    'user',
                    'organisation',
                    'organisation_role',
                    'organisation_role_permission',
                    'user_organisation_role',
                    'business_plan',
                    'budget',
                    'budget_details',
                    'budget_config',
                    'cashflow_forecast'
                ],
                ndis: [
                    'ndis_participants',
                    'ndis_services',
                    'ndis_support_plans',
                    'ndis_claims',
                    'ndis_providers',
                    'ndis_goals'
                ],
                salon: [
                    'salon_appointments',
                    'salon_services',
                    'salon_staff',
                    'salon_clients',
                    'salon_products',
                    'salon_inventory'
                ]
            }

            setSchemasTables(tablesData)

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

    const deleteRole = async () => {
        if (!roleToDelete) return
        setSaving(true)
        setError(null)

        try {
            // First, delete all permissions associated with this role
            const { error: permissionsError } = await supabase
                .from('organisation_role_permission')
                .delete()
                .eq('organisation_role_id', roleToDelete.id)

            if (permissionsError) throw permissionsError

            // Then delete the role itself
            const { error: roleError } = await supabase
                .from('organisation_role')
                .delete()
                .eq('id', roleToDelete.id)

            if (roleError) throw roleError

            // Update local state
            setRoles(prev => prev.filter(role => role.id !== roleToDelete.id))
            setPermissions(prev => prev.filter(permission => permission.organisation_role_id !== roleToDelete.id))

            // Close confirmation dialog
            setShowDeleteConfirm(false)
            setRoleToDelete(null)
        } catch (err: any) {
            setError(err.message || 'Failed to delete role')
        } finally {
            setSaving(false)
        }
    }

    const confirmDeleteRole = (role: Role) => {
        setRoleToDelete(role)
        setShowDeleteConfirm(true)
    }

    const cancelDeleteRole = () => {
        setShowDeleteConfirm(false)
        setRoleToDelete(null)
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
                            <div className="mt-2 text-xs">
                                Debug: currentOrgId={currentOrgId}, selectedOrgId={selectedOrgId}, isSuperUser={isSuperUser.toString()}
                            </div>
                        </div>
                    ) : loading ? (
                        <div className="text-gray-300">Loading permissions data...</div>
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
                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                                        {roles.map((role) => (
                                            <div key={role.id} className="p-3 border border-gray-700 rounded-md bg-gray-800/30">
                                                <div className="flex justify-between items-start mb-1">
                                                    <h4 className="font-medium text-gray-100 text-sm truncate pr-1">{role.name}</h4>
                                                    <button
                                                        onClick={() => confirmDeleteRole(role)}
                                                        className="text-red-400 hover:text-red-300 p-0.5 rounded hover:bg-red-900/20 transition-colors flex-shrink-0"
                                                        title="Delete role"
                                                    >
                                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                        </svg>
                                                    </button>
                                                </div>
                                                {role.description && (
                                                    <p className="text-xs text-gray-400 line-clamp-2">{role.description}</p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Permissions Matrix */}
                            <div className="space-y-6">
                                {Object.entries(schemasTables).map(([schema, tables]) => (
                                    <div key={schema} className="rounded-xl border border-gray-800 bg-gray-900/80 p-6">
                                        <h3 className="text-lg font-medium text-gray-100 mb-4 capitalize">
                                            {schema} Schema Permissions
                                        </h3>

                                        {roles.length === 0 || tables.length === 0 ? (
                                            <div className="text-gray-400 text-sm">
                                                {roles.length === 0 ? 'Create roles first to manage permissions.' : `No ${schema} tables found.`}
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
                                                        {tables.map((tableName: string) => (
                                                            <tr key={`${schema}.${tableName}`}>
                                                                <td className="p-3 border border-gray-700 bg-gray-900/50 text-gray-300 font-mono text-sm">
                                                                    {schema}.{tableName}
                                                                </td>
                                                                {roles.map((role) => {
                                                                    const permission = permissions.find(p =>
                                                                        p.organisation_role_id === role.id &&
                                                                        p.table_name === `${schema}.${tableName}`
                                                                    )
                                                                    return (
                                                                        <td key={role.id} className="p-2 border border-gray-700 bg-gray-900/30">
                                                                            <div className="flex justify-center gap-1">
                                                                                {(['can_create', 'can_read', 'can_update', 'can_delete'] as const).map((action) => {
                                                                                    const isChecked = permission?.[action] || false
                                                                                    const actionLabel = action.replace('can_', '').charAt(0).toUpperCase()
                                                                                    return (
                                                                                        <button
                                                                                            key={action}
                                                                                            onClick={() => updatePermission(role.id, `${schema}.${tableName}`, action, !isChecked)}
                                                                                            className={`w-6 h-6 rounded text-xs font-bold transition-colors ${isChecked
                                                                                                ? 'bg-green-600 text-white hover:bg-green-700'
                                                                                                : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                                                                                                }`}
                                                                                            title={`${action.replace('_', ' ')} for ${schema}.${tableName}`}
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
                                ))}
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

            {/* Delete Confirmation Dialog */}
            {showDeleteConfirm && roleToDelete && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 max-w-md w-full mx-4">
                        <h3 className="text-lg font-medium text-white mb-4">Delete Role</h3>
                        <p className="text-gray-300 mb-6">
                            Are you sure you want to delete the role <strong className="text-white">"{roleToDelete.name}"</strong>?
                            This will also delete all permissions associated with this role and cannot be undone.
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={cancelDeleteRole}
                                disabled={saving}
                                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 disabled:opacity-50 text-white rounded-md text-sm"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={deleteRole}
                                disabled={saving}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-md text-sm"
                            >
                                {saving ? 'Deleting...' : 'Delete Role'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
