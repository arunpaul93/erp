"use client"

import { useEffect, useRef, useState } from 'react'
import ProcessFlowEditor from '@/components/ProcessFlowEditor'

export default function SuperPlannerClient() {
  // Top-level config: adjust group container padding here
  const GROUP_PADDING = { x: 24, y: 24, header: 64 }
  const headerRef = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState<number>(720)

  useEffect(() => {
    const compute = () => {
      const vh = window.innerHeight
      const header = headerRef.current?.getBoundingClientRect().height ?? 0
      setHeight(Math.max(0, vh - header))
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [])

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-950">
      <div ref={headerRef} className="shrink-0 px-4 py-3 md:px-6 lg:px-8 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-yellow-400">Super Planner</h1>
          <p className="text-sm text-gray-400">React Flow + Supabase (process_step, process_flow_edge)</p>
        </div>
      </div>
      <div className="flex-1 min-h-0">
  <ProcessFlowEditor height={height} className="h-full" hideToolbar groupPadding={GROUP_PADDING} />
      </div>
    </div>
  )
}
