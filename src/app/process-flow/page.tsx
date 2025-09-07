'use client'

import React from 'react'
import { useRouter } from 'next/navigation'

export default function ProcessFlowPage() {
    const router = useRouter()
    return (
        <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-8">
            <div className="text-center space-y-3">
                <h1 className="text-xl font-semibold">Process Flow</h1>
                <p className="text-gray-400 text-sm">This page is temporarily disabled while we stabilize the graph editor.</p>
                <button
                    onClick={() => router.push('/home')}
                    className="mt-2 inline-flex items-center px-3 py-1.5 rounded bg-yellow-400 text-gray-900 text-sm hover:bg-yellow-500"
                >
                    Go to Home
                </button>
            </div>
        </div>
    )
}

