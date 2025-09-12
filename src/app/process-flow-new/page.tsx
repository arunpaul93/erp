'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import ProcessFlowEditor from '@/components/ProcessFlowEditor'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'

export default function ProcessFlowPage() {
    const { user, loading } = useAuth()
    const { selectedOrgId, selectedOrg } = useOrg()
    const router = useRouter()
    const [windowHeight, setWindowHeight] = useState(800) // Default height
    const [isSaving, setIsSaving] = useState(false)
    const editorRef = useRef<any>(null)

    useEffect(() => {
        if (!loading && !user) {
            router.push('/login')
        }
    }, [user, loading, router])

    // Handle window resize
    useEffect(() => {
        const updateHeight = () => {
            setWindowHeight(window.innerHeight)
        }

        // Set initial height
        updateHeight()

        // Add resize listener
        window.addEventListener('resize', updateHeight)
        return () => window.removeEventListener('resize', updateHeight)
    }, [])

    // Handle save
    const handleSave = async () => {
        if (editorRef.current && editorRef.current.saveProcessFlow) {
            setIsSaving(true)
            try {
                await editorRef.current.saveProcessFlow()
            } finally {
                setIsSaving(false)
            }
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-950 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400 mx-auto mb-2"></div>
                    <p className="text-gray-400">Loading...</p>
                </div>
            </div>
        )
    }

    if (!user) {
        return null
    }

    if (!selectedOrgId) {
        return (
            <div className="min-h-screen bg-gray-950 flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-xl font-semibold text-gray-300 mb-2">No Organization Selected</h2>
                    <p className="text-gray-500">Please select an organization to continue.</p>
                </div>
            </div>
        )
    }

    return (
        <div className="h-screen w-screen bg-gray-950 flex flex-col overflow-hidden">
            {/* Header bar */}
            <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex-shrink-0">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold text-white">Process Flow Editor</h1>
                        <p className="text-sm text-gray-400 mt-1">
                            {selectedOrg?.name || 'Your organization'} - Design and manage process flows
                        </p>
                    </div>
                    <div>
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-gray-900 text-sm rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSaving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Full-screen process flow editor */}
            <div className="flex-1 overflow-hidden">
                <ProcessFlowEditor
                    ref={editorRef}
                    height={windowHeight - 80} // Full height minus header
                    className=""
                    hideToolbar={true}
                    onSave={() => {
                        // Optional: Add notification or callback after save
                        console.log('Process flow saved successfully')
                    }}
                />
            </div>
        </div>
    )
}