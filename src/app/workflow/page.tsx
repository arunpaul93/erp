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
  type ReactFlowInstance,
  type Edge,
  type Node,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import ELK from 'elkjs/lib/elk.bundled.js'

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
  const [edgeDirtyEdits, setEdgeDirtyEdits] = useState<Record<string, string>>({})
  const [contextMenu, setContextMenu] = useState<
    | { visible: false }
    | { visible: true; x: number; y: number; kind: 'node' | 'edge'; targetId: string }
  >({ visible: false })
  const [labelEditor, setLabelEditor] = useState<
    | null
    | { visible: true; x: number; y: number; edgeId: string; value: string }
  >(null)
  const connectingFromRef = React.useRef<string | null>(null)
  const flowRef = React.useRef<ReactFlowInstance | null>(null)
  // Keep last computed layout positions (from ELK) so we can snap nodes back after drag
  const layoutPosRef = React.useRef<Map<string, { x: number; y: number }>>(new Map())
  // Layout config state
  const [showConfig, setShowConfig] = useState(false)
  const [colGap, setColGap] = useState<number>(280)
  const [rowGap, setRowGap] = useState<number>(140)
  const [tempColGap, setTempColGap] = useState<string>('')
  const [tempRowGap, setTempRowGap] = useState<string>('')
  useEffect(() => {
    try {
      const sx = localStorage.getItem('workflow_col_gap')
      const sy = localStorage.getItem('workflow_row_gap')
      if (sx) setColGap(Math.max(80, parseInt(sx)))
      if (sy) setRowGap(Math.max(60, parseInt(sy)))
    } catch {}
  }, [])
  // Sync temp values when panel opens
  useEffect(() => {
    if (showConfig) {
  setTempColGap(String(colGap))
  setTempRowGap(String(rowGap))
    }
  }, [showConfig, colGap, rowGap])
  const configRef = React.useRef<HTMLDivElement | null>(null)
  const configBtnRef = React.useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!showConfig) return
    const onDocMouseDown = (e: MouseEvent) => {
      const target = (e.target as Node | null)
      if (!target) return
  if (configRef.current && (configRef.current as any).contains(target as any)) return
  if (configBtnRef.current && (configBtnRef.current as any).contains(target as any)) return
      setShowConfig(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [showConfig])
  const persistGaps = useCallback((x: number, y: number) => {
    try {
      localStorage.setItem('workflow_col_gap', String(x))
      localStorage.setItem('workflow_row_gap', String(y))
    } catch {}
  }, [])
  // reactFlow hook not needed since we recompute layout; we don't set explicit position on create

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.push('/login')
    }
  }, [user, loading, router])

  // no-op

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

  const xGap = colGap
  const yGap = rowGap
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
      boxSizing: 'border-box',
          
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      }
    })

  const laidEdges = rawEdges.map((e) => {
      const text = (((e as any).data?.labelText ?? (typeof (e as any).label === 'string' ? (e as any).label : '')) as string) || ''
      return {
        ...e,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#f59e0b'
        },
  style: { stroke: '#f59e0b' },
        label: text && text.trim().length ? text : undefined,
        labelShowBg: true,
        labelBgPadding: [2, 1] as [number, number],
        labelBgBorderRadius: 3,
        labelBgStyle: { fill: '#030712', stroke: 'none' },
        labelStyle: {
          fill: '#ffffff',
          fontSize: 11,
          fontWeight: 600,
          whiteSpace: 'nowrap' as any,
        },
      }
    })

    return { nodes: laidOut, edges: laidEdges }
  }, [colGap, rowGap])

  // Edge styling helper (no node positioning): preserves labels and dark theme
  const styleEdges = useCallback((rawEdges: Edge[]): Edge[] => {
    return rawEdges.map((e) => {
      const text = (((e as any).data?.labelText ?? (typeof (e as any).label === 'string' ? (e as any).label : '')) as string) || ''
      return {
        ...e,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#f59e0b'
        },
        style: { stroke: '#f59e0b' },
        label: text && text.trim().length ? text : undefined,
        labelShowBg: true,
        labelBgPadding: [2, 1] as [number, number],
        labelBgBorderRadius: 3,
        labelBgStyle: { fill: '#030712', stroke: 'none' },
        labelStyle: {
          fill: '#ffffff',
          fontSize: 11,
          fontWeight: 600,
          whiteSpace: 'nowrap' as any,
        },
      }
    })
  }, [])

  // ELK auto layout: layered algorithm with spacing based on colGap/rowGap
  const elk = useMemo(() => new ELK({ defaultLayoutOptions: {} as any }), [])
  const applyElkLayout = useCallback(async (rawNodes: Node[], rawEdges: Edge[]): Promise<{ nodes: Node[]; edges: Edge[] }> => {
    // Build ELK graph
    const elkGraph: any = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNodeBetweenLayers': String(colGap),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(colGap),
        'elk.spacing.nodeNode': String(Math.max(40, rowGap - 40)),
        'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
        'elk.layered.crossingMinimization.semiInteractive': 'true',
      },
      children: rawNodes.map((n) => ({
        id: n.id,
        width: (n.style as any)?.width ?? 220,
        height: (n.style as any)?.height ?? 80,
      })),
      edges: rawEdges.map((e) => ({ id: String(e.id), sources: [String(e.source)], targets: [String(e.target)] }))
    }

    const res = await elk.layout(elkGraph)

  const posById = new Map<string, { x: number; y: number }>()
    for (const c of res.children || []) {
      posById.set(c.id, { x: c.x || 0, y: c.y || 0 })
    }

  // Remember positions for snap-back on drag stop
  layoutPosRef.current = posById

    // Reuse existing styling and label settings
    const laidNodes = rawNodes.map((n) => ({
      ...n,
      position: posById.get(n.id) || { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: {
        ...(n as any).style,
        width: (n as any).style?.width ?? 220,
        borderRadius: (n as any).style?.borderRadius ?? 12,
        border: (n as any).style?.border ?? '1px solid #1f2937',
        background: (n as any).style?.background ?? 'rgba(17,24,39,0.9)',
        color: (n as any).style?.color ?? '#e5e7eb',
        boxSizing: 'border-box',
      },
    }))

    // Preserve ELK positions; only style edges without changing node positions
    const styledEdges = styleEdges(rawEdges)
    return { nodes: laidNodes, edges: styledEdges }
  }, [elk, colGap, rowGap, styleEdges])

  // Re-layout current graph when gaps change via ELK
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { nodes: n, edges: e } = await applyElkLayout(nodes, edges)
      if (!cancelled) {
        setNodes(n)
        setEdges(e)
      }
    })()
    return () => { cancelled = true }
  }, [colGap, rowGap])

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

      // Render flows as direct labeled edges: step -> step with inline text label
  const edgeList: Edge[] = (flows || [])
        .filter((e) => !!e.from_step_id && !!e.to_step_id)
        .map((e) => ({
          id: String(e.id),
          source: String(e.from_step_id),
          target: String(e.to_step_id),
          type: 'default',
      // set both label (string) and store raw text so layout can style it
      label: e.label ?? undefined,
      data: { labelText: e.label ?? '' } as any,
        }))

  const allNodes = [...stepNodes]
  const { nodes: laidNodes, edges: laidEdges } = await applyElkLayout(allNodes, edgeList)
      setNodes(laidNodes)
      setEdges(laidEdges)
    } catch (err: any) {
      setError(err.message || 'Failed to load workflow')
    } finally {
      setIsLoading(false)
    }
  }, [selectedOrgId, setNodes, setEdges])

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
    const edgeEntries = Object.entries(edgeDirtyEdits)
    if (entries.length === 0 && edgeEntries.length === 0) return
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
      // Build upsert payload for process_flow_edge labels
      if (edgeEntries.length > 0) {
        const edgePayload = edgeEntries.map(([id, label]) => ({ id, label: (label?.trim()?.length ? label.trim() : null) as any }))
        const { error: edgeErr } = await supabase
          .from('process_flow_edge')
          .upsert(edgePayload, { onConflict: 'id' })
        if (edgeErr) throw edgeErr
      }
      setDirtyEdits({})
      setEdgeDirtyEdits({})
      setEditingNodeId(null)
      await fetchData()
    } catch (e: any) {
      setError(e.message || 'Failed to save changes')
    } finally {
      setIsSaving(false)
    }
  }, [dirtyEdits, edgeDirtyEdits, selectedOrgId, fetchData])

  const onConnect = useCallback(async (connection: any) => {
    // Persist a new flow edge between two steps, then refresh
    try {
      if (!selectedOrgId || !connection?.source || !connection?.target) return
      const { error: flowErr } = await supabase
        .from('process_flow_edge')
        .insert({
          organisation_id: selectedOrgId,
          from_step_id: String(connection.source),
          to_step_id: String(connection.target),
          metadata: {},
          label: null,
        })
      if (flowErr) throw flowErr
      await fetchData()
    } catch (e: any) {
      setError(e.message || 'Failed to connect nodes')
    }
  }, [selectedOrgId, fetchData])

  // Drag-to-create: start tracking source node
  const onConnectStart = useCallback((_: any, params: any) => {
    // Only when starting from a source handle (right edge)
    if (params?.handleType === 'source' && params?.nodeId) {
      connectingFromRef.current = String(params.nodeId)
    } else {
      connectingFromRef.current = null
    }
  }, [])
  // End: if dropped on pane (no target), create a new step + flow
  const onConnectEnd = useCallback(async (event: MouseEvent | TouchEvent) => {
    const sourceId = connectingFromRef.current
    connectingFromRef.current = null
    if (!sourceId || !selectedOrgId) return
    // If there was a valid target, onConnect would have handled it; we only handle pane drops
    // Heuristic: create when the original event target is the pane or SVG backdrop
    const target = event.target as HTMLElement | null
    const isPane = !!target && (
      target.classList?.contains('react-flow__pane') ||
      target.classList?.contains('xyflow__pane') ||
      target.tagName.toLowerCase() === 'svg'
    )
    if (!isPane) return

    try {
      // 1) Create the new step
      const { data: stepRows, error: stepErr } = await supabase
        .from('process_step')
        .insert({ organisation_id: selectedOrgId, name: 'New Node', description: null, metadata: {}, parent_step_id: null })
        .select('id')
        .limit(1)
      if (stepErr) throw stepErr
      const newStepId = stepRows?.[0]?.id as string
      if (!newStepId) throw new Error('Failed to create step')

      // 2) Create the flow connecting source -> new step
      const { error: flowErr } = await supabase
        .from('process_flow_edge')
        .insert({ organisation_id: selectedOrgId, from_step_id: sourceId, to_step_id: newStepId, metadata: {}, label: null })
      if (flowErr) throw flowErr

      // 3) Refresh and focus editing on new node
      await fetchData()
      setEditingNodeId(newStepId)
    } catch (e: any) {
      setError(e.message || 'Failed to create connected node')
    }
  }, [selectedOrgId, fetchData])

  // When a node drag ends, snap it back to the last ELK layout position (with CSS transition)
  const onNodeDragStop = useCallback((_: any, node: Node) => {
    const target = layoutPosRef.current.get(String(node.id))
    if (!target) return
    // Read current position from state (node passed in may not have latest state reference)
    const current = nodes.find((n) => n.id === node.id)?.position || node.position
    const start = { x: current.x, y: current.y }
    const end = { x: target.x, y: target.y }
    const duration = 250
    const startAt = performance.now()

    let raf = 0
    const step = (t: number) => {
      const elapsed = t - startAt
      const k = Math.min(1, elapsed / duration)
      // easeOutCubic
      const e = 1 - Math.pow(1 - k, 3)
      const x = start.x + (end.x - start.x) * e
      const y = start.y + (end.y - start.y) * e
      setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, position: { x, y } } : n)))
      if (k < 1) {
        raf = requestAnimationFrame(step)
      }
    }
    raf = requestAnimationFrame(step)
    // Cleanup if component unmounts during animation
    return () => cancelAnimationFrame(raf)
  }, [nodes, setNodes])

  // Context menu handlers
  const openNodeMenu = useCallback((event: React.MouseEvent, nodeId: string) => {
    event.preventDefault()
    setContextMenu({ visible: true, x: event.clientX, y: event.clientY, kind: 'node', targetId: nodeId })
  }, [])
  const openEdgeMenu = useCallback((event: React.MouseEvent, edgeId: string) => {
    event.preventDefault()
    setContextMenu({ visible: true, x: event.clientX, y: event.clientY, kind: 'edge', targetId: edgeId })
  }, [])
  const closeMenu = useCallback(() => setContextMenu({ visible: false }), [])

  const openEdgeLabelEditor = useCallback((x: number, y: number, edgeId: string) => {
    // Determine current label text from edge data/string label
    const ed = edges.find(e => String(e.id) === String(edgeId))
    let current = ((ed as any)?.data?.labelText as string) ?? (typeof (ed as any)?.label === 'string' ? (ed as any).label : '')
    if (current === 'Flow') current = ''
    setLabelEditor({ visible: true, x, y, edgeId, value: current })
  }, [edges])

  const closeLabelEditor = useCallback(() => setLabelEditor(null), [])

  const handleDelete = useCallback(async () => {
    if (!contextMenu.visible) return
    try {
      if (contextMenu.kind === 'node') {
        const nodeId = contextMenu.targetId
        // Delete any flow edges connected to this step first, then delete the step
        const { error: delConnsErr } = await supabase
          .from('process_flow_edge')
          .delete()
          .or(`from_step_id.eq.${nodeId},to_step_id.eq.${nodeId}`)
        if (delConnsErr) throw delConnsErr
        const { error: delStepErr } = await supabase.from('process_step').delete().eq('id', nodeId)
        if (delStepErr) throw delStepErr
        if (editingNodeId === nodeId) setEditingNodeId(null)
      } else if (contextMenu.kind === 'edge') {
        // Edge id equals flow id now
        const flowId = contextMenu.targetId
        const { error: delFlowErr } = await supabase.from('process_flow_edge').delete().eq('id', flowId)
        if (delFlowErr) throw delFlowErr
      }
      await fetchData()
    } catch (e: any) {
      setError(e.message || 'Failed to delete')
    } finally {
      closeMenu()
    }
  }, [contextMenu, edges, fetchData, closeMenu, editingNodeId])

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
            disabled={!selectedOrgId || isSaving || (Object.keys(dirtyEdits).length === 0 && Object.keys(edgeDirtyEdits).length === 0)}
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
        <div className="flex items-center gap-3">
          <button
            onClick={() => flowRef.current?.fitView({ padding: 0.15 })}
            className="inline-flex items-center gap-2 px-2 py-1 rounded-md text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700"
            aria-label="Fit to screen"
            title="Fit to screen"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9V5a2 2 0 0 1 2-2h4" />
              <path d="M21 9V5a2 2 0 0 0-2-2h-4" />
              <path d="M3 15v4a2 2 0 0 0 2 2h4" />
              <path d="M21 15v4a2 2 0 0 1-2 2h-4" />
            </svg>
            Fit
          </button>
          <button
            onClick={() => setShowConfig(v => !v)}
            className="inline-flex items-center gap-2 px-2 py-1 rounded-md text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700"
            aria-label="Layout settings"
            title="Layout settings"
            ref={configBtnRef}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0A1.65 1.65 0 0 0 9 3.09V3a2 2 0 1 1 4 0v.09c0 .67.39 1.27 1 1.51a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.46.46-.6 1.14-.33 1.74.24.55.84.94 1.51.94H21a2 2 0 1 1 0 4h-.09c-.67 0-1.27.39-1.51 1Z" />
            </svg>
            Config
          </button>
          <div className="text-xs text-gray-400">Org: {selectedOrgId || 'None selected'}</div>
        </div>
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
        <div className="h-[calc(100vh-64px)] relative">
          {showConfig && (
            <div ref={configRef} className="absolute top-2 right-4 z-50 min-w-64 rounded-md border border-gray-700 bg-gray-900 text-gray-100 shadow-lg p-3">
              <div className="text-sm font-medium mb-2">Layout</div>
              <div className="flex items-center gap-3 mb-2">
                <label className="text-xs text-gray-400 w-24">Column gap</label>
                <input
                  type="number"
                  min={80}
                  step={10}
                  value={tempColGap}
                  onChange={(e) => {
                    setTempColGap((e.target as HTMLInputElement).value)
                  }}
                  className="w-24 bg-gray-900 text-gray-100 border border-gray-700 rounded px-2 py-1 text-sm"
                />
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-400 w-24">Row gap</label>
                <input
                  type="number"
                  min={60}
                  step={10}
                  value={tempRowGap}
                  onChange={(e) => {
                    setTempRowGap((e.target as HTMLInputElement).value)
                  }}
                  className="w-24 bg-gray-900 text-gray-100 border border-gray-700 rounded px-2 py-1 text-sm"
                />
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => {
                    const parsedX = parseInt(tempColGap, 10)
                    const parsedY = parseInt(tempRowGap, 10)
                    const x = Number.isFinite(parsedX) ? Math.max(80, parsedX) : colGap
                    const y = Number.isFinite(parsedY) ? Math.max(60, parsedY) : rowGap
                    setColGap(x)
                    setRowGap(y)
                    persistGaps(x, y)
                    setTempColGap(String(x))
                    setTempRowGap(String(y))
                  }}
                  className="px-3 py-1.5 rounded-md text-sm font-medium bg-yellow-400 hover:bg-yellow-500 text-gray-900 border border-yellow-500/20"
                >
                  Apply
                </button>
              </div>
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            minZoom={0.01}
            maxZoom={50}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onNodeDragStop={onNodeDragStop}
            onNodeDoubleClick={(_, n) => startEditingNode(String(n.id))}
            onEdgeDoubleClick={(e, ed) => {
              e.preventDefault();
              openEdgeLabelEditor(e.clientX, e.clientY, String(ed.id))
            }}
            onPaneClick={() => { setEditingNodeId(null); closeMenu(); closeLabelEditor(); setShowConfig(false) }}
            onNodeClick={(_, n) => {
              if (editingNodeId && String(n.id) !== editingNodeId) setEditingNodeId(null)
              closeMenu();
              closeLabelEditor();
              setShowConfig(false)
            }}
            onEdgeClick={() => { setEditingNodeId(null); closeMenu(); closeLabelEditor(); setShowConfig(false) }}
            onNodeContextMenu={(e, n) => openNodeMenu(e, String(n.id))}
            onEdgeContextMenu={(e, ed) => openEdgeMenu(e, String(ed.id))}
            onPaneContextMenu={(e) => { e.preventDefault(); closeMenu() }}
            nodeTypes={{ stepNode: StepNode }}
            onInit={(instance) => { flowRef.current = instance }}
            fitView
          >
            <Background color="#1f2937" variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls
              style={{
                background: 'rgba(17, 24, 39, 0.9)', // bg-gray-900/90
                color: '#e5e7eb', // text-gray-200
                border: '1px solid #374151', // border-gray-700
              }}
              fitViewOptions={{ padding: 0.15 }}
            />
          </ReactFlow>
          {contextMenu.visible && (
            <div
              className="z-50"
              style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="min-w-32 rounded-md border border-gray-700 bg-gray-900 text-gray-100 shadow-lg py-1">
                {contextMenu.kind === 'edge' && (
                  <button
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-800"
                    onClick={() => { openEdgeLabelEditor(contextMenu.x, contextMenu.y, contextMenu.targetId); closeMenu() }}
                  >
                    Edit label
                  </button>
                )}
                <button
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-800"
                  onClick={handleDelete}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
          {labelEditor?.visible && (
            <div
              className="z-50"
              style={{ position: 'fixed', top: labelEditor.y, left: labelEditor.x }}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                autoFocus
                className="px-2 py-1 text-sm rounded border border-gray-700 bg-gray-900 text-gray-100 shadow"
                placeholder="Edge label"
                value={labelEditor.value}
                onChange={(e) => setLabelEditor(prev => prev ? { ...prev, value: e.target.value } : prev)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    const val = labelEditor.value
                    // update local edge label text + string label and mark dirty
                    setEdges(eds => eds.map(ed => ed.id === labelEditor.edgeId ? {
                      ...ed,
                      data: { ...(ed as any).data, labelText: val },
                      label: (val?.trim()?.length ? val : undefined),
                    } : ed))
                    setEdgeDirtyEdits(prev => ({ ...prev, [labelEditor.edgeId]: val }))
                    closeLabelEditor()
                  } else if (e.key === 'Escape') {
                    closeLabelEditor()
                  }
                }}
                onBlur={() => {
                  const val = labelEditor.value
                  setEdges(eds => eds.map(ed => ed.id === labelEditor.edgeId ? {
                    ...ed,
                    data: { ...(ed as any).data, labelText: val },
                    label: (val?.trim()?.length ? val : undefined),
                  } : ed))
                  setEdgeDirtyEdits(prev => ({ ...prev, [labelEditor.edgeId]: val }))
                  closeLabelEditor()
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
