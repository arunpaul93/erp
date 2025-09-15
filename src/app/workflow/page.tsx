"use client"

import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import { supabase } from '@/lib/supabase'
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  addEdge,
  useEdgesState,
  useNodesState,
  MarkerType,
  Position,
  Handle,
  type Edge,
  type Node,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

// Custom editable node for process steps
type StepNodeData = { label: string; description?: string; editing?: boolean; onChange?: (name: string, desc: string) => void }
function StepNode(props: any) {
  const data = (props?.data || {}) as StepNodeData
  const { label, description, editing, onChange } = data
  // Auto-expand description textarea when edit mode starts
  const descRef = React.useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    if (editing && descRef.current) {
      const el = descRef.current
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [editing, description])
  if (editing) {
    return (
      <div className="w-full h-full p-2 flex flex-col gap-2" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <Handle type="target" position={Position.Left} className="!bg-yellow-400" />
        <Handle type="source" position={Position.Right} className="!bg-yellow-400" />
        <input
          defaultValue={label}
          onChange={(e) => onChange && onChange(e.target.value, description || '')}
          placeholder="Name"
          className="bg-gray-900 text-gray-100 border border-gray-700 rounded px-2 py-1 text-sm w-full"
        />
        <label className="text-[11px] text-gray-400">Description</label>
        <textarea
          ref={descRef}
          defaultValue={description || ''}
          onChange={(e) => onChange && onChange(label || '', e.target.value)}
          onInput={(e) => {
            const el = e.currentTarget as HTMLTextAreaElement
            el.style.height = 'auto'
            el.style.height = `${el.scrollHeight}px`
          }}
          placeholder="Description"
          className="bg-gray-900 text-gray-300 border border-gray-700 rounded px-2 py-1 text-xs w-full resize-none overflow-hidden"
          style={{ height: 'auto' }}
        />
      </div>
    )
  }
  return (
    <div className="w-full px-3 py-6 flex items-center justify-center text-center overflow-hidden">
      <Handle type="target" position={Position.Left} className="!bg-yellow-400" />
      <Handle type="source" position={Position.Right} className="!bg-yellow-400" />
      <div
        className="w-full text-sm font-semibold text-gray-100 whitespace-pre-wrap break-all leading-snug"
        style={{ overflowWrap: 'anywhere' }}
      >
        {label || 'Step'}
      </div>
    </div>
  )
}

// Types from DB
interface ProcessStep {
  id: string
  organisation_id: string | null
  name: string
  description: string | null
  metadata: any | null
  parent_step_id: string | null
}

interface ProcessFlowEdge {
  id: string
  organisation_id: string | null
  from_step_id: string | null
  to_step_id: string | null
  metadata: any | null
  label: string | null
}

export default function WorkflowPage() {
  const { user, loading } = useAuth()
  const { selectedOrgId } = useOrg()
  const router = useRouter()

  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[])
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftDesc, setDraftDesc] = useState('')
  const [dirtyEdits, setDirtyEdits] = useState<Record<string, { name?: string; description?: string }>>({})

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.push('/login')
    }
  }, [user, loading, router])

  const computeLayout = useCallback((rawNodes: Node[], rawEdges: Edge[]): { nodes: Node[]; edges: Edge[] } => {
    // Simple layered layout: BFS levels by incoming count
    const inCount = new Map<string, number>()
    rawNodes.forEach(n => inCount.set(n.id, 0))
    rawEdges.forEach(e => {
      const tid = String(e.target)
      inCount.set(tid, (inCount.get(tid) || 0) + 1)
    })

    const children = new Map<string, string[]>()
    rawNodes.forEach(n => children.set(n.id, []))
    rawEdges.forEach(e => {
      const sid = String(e.source)
      const tid = String(e.target)
      children.get(sid)?.push(tid)
    })

    const level = new Map<string, number>()
    const q: string[] = []
    rawNodes.forEach(n => {
      if ((inCount.get(n.id) || 0) === 0) {
        level.set(n.id, 0)
        q.push(n.id)
      }
    })
    while (q.length) {
      const u = q.shift() as string
      const next = (level.get(u) || 0) + 1
      for (const v of (children.get(u) || [])) {
        if (!level.has(v) || next > (level.get(v) || 0)) {
          level.set(v, next)
          q.push(v)
        }
      }
    }

    // Group nodes by level and position them in grid
    const grouped: Record<number, Node[]> = {}
    for (const n of rawNodes) {
      const l = level.get(n.id) ?? 0
      if (!grouped[l]) grouped[l] = []
      grouped[l].push(n)
    }

    const xGap = 280
    const yGap = 140
    const nodeW = 220
    const nodeH = 80

  const laidOut = rawNodes.map((n) => {
      const l = level.get(n.id) ?? 0
      const siblings = grouped[l]
      const idx = siblings.findIndex(s => s.id === n.id)
      return {
        ...n,
        position: {
          x: l * xGap,
          y: idx * yGap,
        },
        // Preserve any existing style and apply sensible dark defaults
        style: {
          ...(n as any).style,
          width: (n as any).style?.width ?? nodeW,
          height: (n as any).style?.height,
          borderRadius: (n as any).style?.borderRadius ?? 12,
          border: (n as any).style?.border ?? '1px solid rgb(31 41 55)',
          background: (n as any).style?.background ?? 'rgba(17, 24, 39, 0.9)',
          color: (n as any).style?.color ?? '#e5e7eb',
          boxSizing: 'border-box'
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      }
    })

    const laidEdges = rawEdges.map((e) => ({
      ...e,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: '#f59e0b'
      },
      style: { stroke: '#f59e0b' },
      labelStyle: { fill: '#fbbf24', fontSize: 12 },
    }))

    return { nodes: laidOut, edges: laidEdges }
  }, [])

  const fetchData = useCallback(async () => {
    if (!selectedOrgId) {
      setNodes([])
      setEdges([])
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const { data: steps, error: stepsErr } = await supabase
        .from('process_step')
        .select('id, organisation_id, name, description, metadata, parent_step_id')
        .or(`organisation_id.is.null,organisation_id.eq.${selectedOrgId}`)

      if (stepsErr) throw stepsErr

      const { data: flows, error: flowsErr } = await supabase
        .from('process_flow_edge')
        .select('id, organisation_id, from_step_id, to_step_id, metadata, label')
        .or(`organisation_id.is.null,organisation_id.eq.${selectedOrgId}`)

      if (flowsErr) throw flowsErr

      // Step nodes
      const stepNodes: Node[] = (steps || []).map((s) => ({
        id: s.id,
        data: { label: s.name || 'Step', description: s.description || '' },
        position: { x: 0, y: 0 },
        type: 'stepNode',
        style: {
          border: '1px solid #1f2937',
          background: 'rgba(17,24,39,0.9)',
          color: '#e5e7eb'
        }
      }))

      // Flow edge nodes (represent each process_flow_edge as a node)
      const flowNodes: Node[] = (flows || []).map((f) => ({
        id: `flow-${f.id}`,
        data: { label: f.label || 'Flow' },
        position: { x: 0, y: 0 },
        type: 'default',
        style: {
          width: 160,
          height: 56,
          borderRadius: 10,
          border: '1px dashed #374151',
          background: 'rgba(17,24,39,0.7)',
          color: '#fbbf24'
        }
      }))

      // Connect: step -> flow-node -> step
      const edgeList: Edge[] = (flows || [])
        .flatMap((e) => {
          const A: Edge[] = e.from_step_id ? [{
            id: `${e.id}-a`,
            source: String(e.from_step_id),
            target: `flow-${e.id}`,
            type: 'default'
          }] : []
          const B: Edge[] = e.to_step_id ? [{
            id: `${e.id}-b`,
            source: `flow-${e.id}`,
            target: String(e.to_step_id),
            type: 'default'
          }] : []
          return [...A, ...B]
        })

      const allNodes = [...stepNodes, ...flowNodes]
      const { nodes: laidNodes, edges: laidEdges } = computeLayout(allNodes, edgeList)
      setNodes(laidNodes)
      setEdges(laidEdges)
    } catch (err: any) {
      setError(err.message || 'Failed to load workflow')
    } finally {
      setIsLoading(false)
    }
  }, [selectedOrgId, computeLayout, setNodes, setEdges])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Add a new process_step as a node for the selected organization
  const handleAddStep = useCallback(async () => {
    if (!selectedOrgId) {
      setError('Select an organization first')
      return
    }
    try {
      const { error: insertErr } = await supabase
        .from('process_step')
        .insert({
          organisation_id: selectedOrgId,
          name: 'New Node',
          description: null,
          metadata: {},
          parent_step_id: null,
        })
      if (insertErr) throw insertErr
      await fetchData()
    } catch (e: any) {
      setError(e.message || 'Failed to add node')
    }
  }, [selectedOrgId, fetchData])

  // Track edits in local state and update rendered node label live
  const startEditingNode = useCallback((nodeId: string) => {
    const n = nodes.find(nd => nd.id === nodeId)
    if (!n) return
    const currentName = (n.data as any)?.label || ''
    const currentDesc = (n.data as any)?.description || ''
    setEditingNodeId(nodeId)
    setDraftName(currentName)
    setDraftDesc(currentDesc)
  }, [nodes])

  const applyDraftToNode = useCallback((nodeId: string, name: string, description: string) => {
    setNodes(ns => ns.map(n => n.id === nodeId ? {
      ...n,
      data: { ...(n.data as any), label: name, description }
    } : n))
    setDirtyEdits(prev => ({ ...prev, [nodeId]: { name, description } }))
  }, [setNodes])

  // Reflect editing state and inject change handler into node data
  useEffect(() => {
    setNodes(ns => ns.map(n => {
      if (n.type !== 'stepNode') return n
      const isEditing = n.id === editingNodeId
    return {
        ...n,
        style: {
          ...(n.style as any),
      height: isEditing ? undefined : (n.style as any)?.height,
        },
        data: {
          ...(n.data as any),
          editing: isEditing,
          onChange: (name: string, desc: string) => applyDraftToNode(n.id, name, desc)
        }
      }
    }))
  }, [editingNodeId, applyDraftToNode, setNodes])

  const handleSave = useCallback(async () => {
    if (!selectedOrgId) return
    const entries = Object.entries(dirtyEdits)
    if (entries.length === 0) return
    setIsSaving(true)
    try {
      // Build upsert payload for process_step
      const payload = entries.filter(([id]) => !id.startsWith('flow-')).map(([id, val]) => ({
        id,
        name: val.name ?? undefined,
        description: val.description ?? undefined,
      }))
      if (payload.length > 0) {
        const { error: upsertErr } = await supabase
          .from('process_step')
          .upsert(payload, { onConflict: 'id' })
        if (upsertErr) throw upsertErr
      }
      setDirtyEdits({})
      setEditingNodeId(null)
      await fetchData()
    } catch (e: any) {
      setError(e.message || 'Failed to save changes')
    } finally {
      setIsSaving(false)
    }
  }, [dirtyEdits, selectedOrgId, fetchData])

  const onConnect = useCallback((connection: any) => {
    setEdges((eds) => addEdge({ ...connection, type: 'default' }, eds))
  }, [setEdges])

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-950">Loading...</div>
  }
  if (!user) return null

  return (
    <div className="h-[calc(100vh-0px)] w-screen bg-gray-950">
      <div className="h-16 px-6 flex items-center justify-between border-b border-gray-800 bg-gray-900/70 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="text-yellow-400 font-semibold">Workflow</div>
          <button
            onClick={handleAddStep}
            disabled={!selectedOrgId}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed bg-yellow-400 hover:bg-yellow-500 text-gray-900"
            aria-label="Add step"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Node
          </button>
          <button
            onClick={handleSave}
            disabled={!selectedOrgId || isSaving || Object.keys(dirtyEdits).length === 0}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed bg-gray-800 hover:bg-gray-700 text-yellow-400 border border-gray-700"
            aria-label="Save changes"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V7l4-4h10l4 4v12a2 2 0 0 1-2 2z" />
              <path d="M17 21v-8H7v8M7 3v4h10V3" />
            </svg>
            {isSaving ? 'Saving…' : 'Save'}
          </button>
          {/* Inline node editing is handled inside each StepNode */}
        </div>
        <div className="text-xs text-gray-400">Org: {selectedOrgId || 'None selected'}</div>
      </div>

      {error && (
        <div className="px-6 py-2 text-sm text-red-400">{error}</div>
      )}

      {!selectedOrgId ? (
        <div className="h-[calc(100vh-64px)] flex items-center justify-center text-gray-400">
          Select an organization on the Home page to view workflows.
        </div>
      ) : isLoading ? (
        <div className="h-[calc(100vh-64px)] flex items-center justify-center text-gray-400">Loading workflow…</div>
      ) : (
        <div className="h-[calc(100vh-64px)]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDoubleClick={(_, n) => {
              if (!String(n.id).startsWith('flow-')) startEditingNode(String(n.id))
            }}
            onPaneClick={() => setEditingNodeId(null)}
            onNodeClick={(_, n) => {
              if (editingNodeId && String(n.id) !== editingNodeId) setEditingNodeId(null)
            }}
            onEdgeClick={() => setEditingNodeId(null)}
            nodeTypes={{ stepNode: StepNode }}
            fitView
          >
            <Background color="#1f2937" variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls
              style={{
                background: 'rgba(17, 24, 39, 0.9)', // bg-gray-900/90
                color: '#e5e7eb', // text-gray-200
                border: '1px solid #374151', // border-gray-700
              }}
            />
          </ReactFlow>
        </div>
      )}
    </div>
  )
}
