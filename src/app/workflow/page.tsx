"use client"

import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
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
import ElectronEdge from './ElectronEdge'

// Custom editable node for process steps
type StepNodeData = { label: string; description?: string; editing?: boolean; onChange?: (name: string, desc: string) => void }
function StepNode(props: any) {
    const data = (props?.data || {}) as StepNodeData
    const { label, description, editing, onChange } = data
    // Auto-expand description textarea when edit mode starts
    const descRef = React.useRef<HTMLTextAreaElement | null>(null)
    // View-mode autosize for label to keep wrapping nice while using native control rendering
    const viewLabelRef = React.useRef<HTMLTextAreaElement | null>(null)
    useEffect(() => {
        if (editing && descRef.current) {
            const el = descRef.current
            el.style.height = 'auto'
            el.style.height = `${el.scrollHeight}px`
        }
    }, [editing, description])

    // When not editing, autosize the readOnly label textarea
    useEffect(() => {
        if (!editing && viewLabelRef.current) {
            const el = viewLabelRef.current
            el.style.height = 'auto'
            el.style.height = `${el.scrollHeight}px`
        }
    }, [editing, label])

    if (editing) {
        return (
            <div
                className="relative"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                style={{
                    transform: 'translate3d(0, 0, 0)',
                    backfaceVisibility: 'hidden',
                    willChange: 'transform'
                }}
            >
                <div
                    className="relative z-10 p-2 flex flex-col gap-2"
                    style={{
                        transform: 'translate3d(0, 0, 0)',
                        backfaceVisibility: 'hidden'
                    }}
                >
                    <Handle type="target" position={Position.Left} className="!bg-yellow-400" />
                    <Handle type="source" position={Position.Right} className="!bg-yellow-400" />
                    <input
                        defaultValue={label}
                        onChange={(e) => onChange && onChange(e.target.value, description || '')}
                        placeholder="Name"
                        className="bg-gray-900 text-gray-100 border border-gray-700 rounded px-2 py-1 text-sm w-full"
                        style={{
                            wordBreak: 'keep-all',
                            overflowWrap: 'normal',
                            transform: 'translate3d(0, 0, 0)',
                            backfaceVisibility: 'hidden',
                            WebkitFontSmoothing: 'subpixel-antialiased' as any,
                            textRendering: 'optimizeSpeed' as any
                        }}
                    />
                    <label
                        className="text-[11px] text-gray-400"
                        style={{
                            transform: 'translate3d(0, 0, 0)',
                            WebkitFontSmoothing: 'subpixel-antialiased' as any
                        }}
                    >
                        Description
                    </label>
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
                        style={{
                            height: 'auto',
                            wordBreak: 'keep-all',
                            overflowWrap: 'normal',
                            transform: 'translate3d(0, 0, 0)',
                            backfaceVisibility: 'hidden',
                            WebkitFontSmoothing: 'subpixel-antialiased' as any,
                            textRendering: 'optimizeSpeed' as any
                        }}
                    />
                </div>
            </div>
        )
    }

    return (
        <div
            className="relative overflow-visible"
            style={{
                transform: 'translate3d(0, 0, 0)',
                transformStyle: 'preserve-3d' as any,
                backfaceVisibility: 'hidden',
                willChange: 'transform',
                imageRendering: 'crisp-edges'
            }}
        >
            <div
                className="relative z-10 px-3 py-6 flex items-center justify-center text-center"
                style={{
                    transform: 'translate3d(0, 0, 0)',
                    backfaceVisibility: 'hidden',
                    willChange: 'transform'
                }}
            >
                <Handle type="target" position={Position.Left} className="!bg-yellow-400" />
                <Handle type="source" position={Position.Right} className="!bg-yellow-400" />
                <textarea
                    ref={viewLabelRef}
                    readOnly
                    value={label || 'Step'}
                    rows={1}
                    spellCheck={false}
                    className="text-sm font-medium text-gray-100 leading-snug bg-transparent border-0 resize-none overflow-hidden text-center w-full"
                    style={{
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'break-word',
                        wordBreak: 'break-word',
                        maxWidth: '100%',
                        // Use native control rendering for crisper zoomed text
                        transform: 'translate3d(0, 0, 0)',
                        backfaceVisibility: 'hidden',
                        willChange: 'transform',
                        outline: 'none',
                        boxShadow: 'none',
                        padding: 0,
                        margin: 0,
                        caretColor: 'transparent',
                        pointerEvents: 'none',
                    }}
                />
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

// Tree types for sidebar
interface TreeItem {
    id: string
    name: string
    children: TreeItem[]
}

export default function WorkflowPage() {
    const { user, loading } = useAuth()
    const { selectedOrgId, orgs } = useOrg()
    const router = useRouter()
    const searchParams = useSearchParams()
    const pathname = usePathname()

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
    // Pending deletions (soft delete until Save)
    const [pendingNodeDeletes, setPendingNodeDeletes] = useState<Record<string, boolean>>({})
    const [pendingEdgeDeletes, setPendingEdgeDeletes] = useState<Record<string, boolean>>({})
    const [contextMenu, setContextMenu] = useState<
        | { visible: false }
        | { visible: true; x: number; y: number; kind: 'node' | 'edge'; targetId: string }
    >({ visible: false })
    const [labelEditor, setLabelEditor] = useState<
        | null
        | { visible: true; x: number; y: number; edgeId: string; value: string }
    >(null)
    const connectingFromRef = React.useRef<string | null>(null)
    // Track whether a successful connect happened to avoid creating a new node on end
    const didConnectRef = React.useRef<boolean>(false)
    const flowRef = React.useRef<ReactFlowInstance | null>(null)
    // Track which parent filter from URL has been applied to avoid loops
    const appliedParentRef = React.useRef<string | null>(null)
    // Keep last computed layout positions (from ELK) so we can snap nodes back after drag
    const layoutPosRef = React.useRef<Map<string, { x: number; y: number }>>(new Map())
    // Track topology signature to trigger auto layout when structure changes
    const layoutSigRef = React.useRef<string>("")
    const computeTopologySignature = useCallback((ns: Node[], es: Edge[]) => {
        const nodeIds = ns.filter((n) => n.type === 'stepNode').map((n) => String(n.id)).sort().join(',')
        const edgePairs = es.map((e) => `${String(e.source)}->${String(e.target)}`).sort().join(',')
        return `${nodeIds}|${edgePairs}`
    }, [])
    // No special view persistence
    // Fiber optics animation toggle
    const [animateEdges, setAnimateEdges] = useState<boolean>(false)
    // Layout config state
    const [showConfig, setShowConfig] = useState(false)
    const [colGap, setColGap] = useState<number>(280)
    const [rowGap, setRowGap] = useState<number>(140)
    const [tempColGap, setTempColGap] = useState<string>('')
    const [tempRowGap, setTempRowGap] = useState<string>('')
    // Sidebar and tree state
    const [sidebarOpen, setSidebarOpen] = useState<boolean>(true)
    const [tree, setTree] = useState<TreeItem[]>([])
    const [expanded, setExpanded] = useState<Record<string, boolean>>({})
    useEffect(() => {
        try {
            const sx = localStorage.getItem('workflow_col_gap')
            const sy = localStorage.getItem('workflow_row_gap')
            if (sx) setColGap(Math.max(80, parseInt(sx)))
            if (sy) setRowGap(Math.max(60, parseInt(sy)))
        } catch { }
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
        } catch { }
    }, [])

    // Sync selection filter with URL (?parent=ID)
    const setParentQuery = useCallback((id: string | null) => {
        try {
            const params = new URLSearchParams(searchParams?.toString())
            if (id) params.set('parent', String(id))
            else params.delete('parent')
            router.replace(`${pathname}?${params.toString()}`)
        } catch { /* no-op */ }
    }, [router, pathname, searchParams])

    // Arrange nodes in a grid layout (for organization view)
    const arrangeInGrid = useCallback((nodes: Node[], gap: number = 300): Node[] => {
        const visibleNodes = nodes.filter(n => !(n as any).hidden)
        const gridSize = Math.ceil(Math.sqrt(visibleNodes.length))
        
        return nodes.map(node => {
            if ((node as any).hidden) return node
            
            const index = visibleNodes.findIndex(n => n.id === node.id)
            const row = Math.floor(index / gridSize)
            const col = index % gridSize
            
            return {
                ...node,
                position: {
                    x: col * gap,
                    y: row * gap
                }
            }
        })
    }, [])

    // Show only direct children (nodes whose parent_step_id matches given id)
    const showChildrenOf = useCallback((parentId: string) => {
        setNodes((ns) => {
            const childIds = new Set<string>(
                ns
                    .filter((n) => n.type === 'stepNode' && String((n.data as any)?.parentId || '') === String(parentId))
                    .map((n) => String(n.id))
            )
            // Determine if a change is needed
            let changed = false
            for (const n of ns) {
                const shouldBeVisible = n.type === 'stepNode' && childIds.has(String(n.id))
                const shouldBeHidden = !shouldBeVisible
                const currentlyHidden = !!(n as any).hidden
                if (currentlyHidden !== shouldBeHidden) { changed = true; break }
            }
            if (!changed) return ns

            // Hide non-children nodes
            const nextNodes = ns.map((n) => ({
                ...n,
                hidden: !(n.type === 'stepNode' && childIds.has(String(n.id)))
            }))
            // Hide edges not fully within the visible subset
            setEdges((es) => {
                let edgeChanged = false
                const nextEdges = es.map((e) => {
                    const shouldHide = !(childIds.has(String(e.source)) && childIds.has(String(e.target)))
                    const currentlyHidden = !!(e as any).hidden
                    if (currentlyHidden !== shouldHide) edgeChanged = true
                    return { ...e, hidden: shouldHide }
                })
                return edgeChanged ? nextEdges : es
            })
            // Fit view to visible nodes
            queueMicrotask(() => {
                const instance = flowRef.current
                if (instance) {
                    const visible = (instance as any).getNodes ? (instance as any).getNodes().filter((n: any) => !n.hidden) : nextNodes.filter((n) => !(n as any).hidden)
                    if (visible.length) instance.fitView({ nodes: visible as any, padding: 0.2, duration: 0 })
                }
            })
            return nextNodes
        })
    }, [setNodes, setEdges])

    // Show only root nodes (parent_step_id is null) by querying backend, hide others, arrange in grid, and fit view
    const showRootNodesOnly = useCallback(async () => {
        if (!selectedOrgId) return
        try {
            const { data: roots, error: rootsErr } = await supabase
                .from('process_step')
                .select('id')
                .or(`organisation_id.is.null,organisation_id.eq.${selectedOrgId}`)
                .is('parent_step_id', null)
            if (rootsErr) throw rootsErr
            const rootIds = new Set<string>((roots || []).map((r: any) => String(r.id)))
            let updatedNodes = nodes.map((n) => ({
                ...n,
                hidden: !(n.type === 'stepNode' && rootIds.has(String(n.id)))
            }))
            // Apply grid layout to visible root nodes
            updatedNodes = arrangeInGrid(updatedNodes, Math.max(colGap, 300))
            setNodes(updatedNodes)
            setEdges((es) => es.map((e) => ({
                ...e,
                hidden: !(rootIds.has(String(e.source)) && rootIds.has(String(e.target)))
            })))
            queueMicrotask(() => flowRef.current?.fitView({ padding: 0.2, duration: 0 }))
        } catch (e: any) {
            setError(e.message || 'Failed to filter root nodes')
        }
    }, [selectedOrgId, setNodes, setEdges, nodes, arrangeInGrid, colGap])

    // Simple fit helpers only
    const fitAll = useCallback(() => flowRef.current?.fitView({ padding: 0.15, duration: 0 }), [])
    const fitRoots = useCallback(() => {
        const roots = nodes.filter((n) => n.type === 'stepNode' && !((n.data as any)?.parentId))
        if (roots.length) flowRef.current?.fitView({ nodes: roots as any, padding: 0.2, duration: 0 })
    }, [nodes])
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
                    // height is content-driven; don't force a height
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
                    color: '#60a5fa'
                },
                style: { stroke: '#60a5fa' },
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
                type: 'electron',
                markerEnd: {
                    type: MarkerType.ArrowClosed,
                    color: '#60a5fa'
                },
                style: { stroke: '#60a5fa' },
                data: { ...(e as any).data, animate: animateEdges },
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
    }, [animateEdges])

    // ELK auto layout: layered algorithm with spacing based on colGap/rowGap
    const elk = useMemo(() => new ELK({ defaultLayoutOptions: {} as any }), [])
    const applyElkLayout = useCallback(async (rawNodes: Node[], rawEdges: Edge[]): Promise<{ nodes: Node[]; edges: Edge[] }> => {
        // Build ELK graph
        const elkGraph: any = {
            id: 'root',
            layoutOptions: {
                'elk.algorithm': 'layered',
                'elk.direction': 'RIGHT',
                // Primary horizontal spacing between layers/columns
                'elk.spacing.nodeNodeBetweenLayers': String(colGap),
                'elk.layered.spacing.nodeNodeBetweenLayers': String(colGap),
                // Additional layer spacing options to ensure consistency
                'elk.layered.spacing.edgeNodeBetweenLayers': String(Math.floor(colGap * 0.5)),
                'elk.layered.spacing.edgeEdgeBetweenLayers': String(Math.floor(colGap * 0.3)),
                // Vertical spacing within a layer (rows)
                'elk.spacing.nodeNode': String(rowGap),
                // Keep separate components/flows apart vertically as well
                'elk.spacing.componentComponent': String(rowGap),
                // Ensure uniform spacing by setting base value consistently
                'elk.layered.spacing.baseValue': String(colGap),
                'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
                'elk.layered.crossingMinimization.semiInteractive': 'true',
                // Try to respect existing positions when possible
                'elk.interactiveLayout': 'true',
                // Force consistent layer assignment
                'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
            },
            children: rawNodes.map((n) => {
                const existing = layoutPosRef.current.get(n.id)
                return {
                    id: n.id,
                    width: ((n.style as any)?.width ?? 220),
                    height: (n.style as any)?.height ?? 80,
                    // Provide existing position as hint to ELK
                    ...(existing ? { x: existing.x, y: existing.y } : {})
                }
            }),
            edges: rawEdges.map((e) => ({ id: String(e.id), sources: [String(e.source)], targets: [String(e.target)] }))
        }

        const res = await elk.layout(elkGraph)

        const posById = new Map<string, { x: number; y: number }>()
        for (const c of res.children || []) {
            const x = typeof c.x === 'number' ? Math.round(c.x) : 0
            const y = typeof c.y === 'number' ? Math.round(c.y) : 0
            posById.set(c.id, { x, y })
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
            ; (async () => {
                const { nodes: n, edges: e } = await applyElkLayout(nodes, edges)
                if (!cancelled) {
                    setNodes(n)
                    setEdges(e)
                }
            })()
        return () => { cancelled = true }
    }, [colGap, rowGap])

    // Auto layout whenever topology (node/edge set) changes
    useEffect(() => {
        const sig = computeTopologySignature(nodes, edges)
        if (sig === layoutSigRef.current) return
        layoutSigRef.current = sig
        let cancelled = false
            ; (async () => {
                const { nodes: n, edges: e } = await applyElkLayout(nodes, edges)
                if (!cancelled) {
                    setNodes(n)
                    setEdges(e)
                }
            })()
        return () => { cancelled = true }
    }, [nodes, edges, computeTopologySignature, applyElkLayout])

    // When animation toggle changes, restyle edges without moving nodes
    useEffect(() => {
        // Only restyle edges based on animate toggle; node visuals remain static
        setEdges((eds) => styleEdges(eds))
    }, [animateEdges, styleEdges, setEdges])

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

            // Step nodes (include parentId for tree building)
            const stepNodes: Node[] = (steps || []).map((s) => ({
                id: s.id,
                data: { label: s.name || 'Step', description: s.description || '', parentId: s.parent_step_id },
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
                    type: 'electron',
                    // set both label (string) and store raw text so layout can style it
                    label: e.label ?? undefined,
                    data: { labelText: e.label ?? '', animate: animateEdges } as any,
                }))

            const allNodes = [...stepNodes]
            const { nodes: laidNodes, edges: laidEdges } = await applyElkLayout(allNodes, edgeList)
            
            // Apply initial filtering based on URL before setting nodes
            const parentId = searchParams?.get('parent')
            let finalNodes = laidNodes
            let finalEdges = laidEdges
            
            if (parentId) {
                // Filter to children of specific parent
                const childIds = new Set<string>(
                    laidNodes
                        .filter((n) => n.type === 'stepNode' && String((n.data as any)?.parentId || '') === String(parentId))
                        .map((n) => String(n.id))
                )
                finalNodes = laidNodes.map((n) => ({
                    ...n,
                    hidden: !(n.type === 'stepNode' && childIds.has(String(n.id))),
                    selected: n.id === parentId
                }))
                finalEdges = laidEdges.map((e) => ({
                    ...e,
                    hidden: !(childIds.has(String(e.source)) && childIds.has(String(e.target)))
                }))
            } else {
                // Filter to root nodes (null parent_step_id) by default and arrange in grid
                const rootIds = new Set<string>((steps || [])
                    .filter((s) => !s.parent_step_id)
                    .map((s) => String(s.id))
                )
                finalNodes = laidNodes.map((n) => ({
                    ...n,
                    hidden: !(n.type === 'stepNode' && rootIds.has(String(n.id)))
                }))
                finalEdges = laidEdges.map((e) => ({
                    ...e,
                    hidden: !(rootIds.has(String(e.source)) && rootIds.has(String(e.target)))
                }))
                
                // Apply grid layout to root nodes
                finalNodes = arrangeInGrid(finalNodes, Math.max(colGap, 300))
            }
            
            setNodes(finalNodes)
            setEdges(finalEdges)
            layoutSigRef.current = computeTopologySignature(finalNodes, finalEdges)

            // Sidebar index: only include nodes that are parents (appear in someone else's parent_step_id)
            const parentIds = new Set<string>((steps || [])
                .map((s) => s.parent_step_id)
                .filter((v): v is string => !!v)
                .map(String))
            const byId: Record<string, TreeItem> = {}
            for (const s of (steps || [])) {
                if (parentIds.has(String(s.id))) {
                    byId[s.id] = { id: s.id, name: s.name || 'Step', children: [] }
                }
            }
            for (const s of (steps || [])) {
                const pid = s.parent_step_id
                if (pid && byId[pid] && byId[s.id]) {
                    byId[pid].children.push(byId[s.id])
                }
            }
            // Roots are parent nodes with no parent_step_id
            const roots: TreeItem[] = (steps || [])
                .filter((s) => !s.parent_step_id && byId[s.id])
                .map((s) => byId[s.id])
            const sortTree = (items: TreeItem[]) => { items.sort((a, b) => a.name.localeCompare(b.name)); items.forEach((it) => sortTree(it.children)) }
            sortTree(roots)
            setTree(roots)
            // Initialize expanded with filtered roots if empty (first load)
            setExpanded((prev) => {
                if (Object.keys(prev).length) return prev
                const next: Record<string, boolean> = {}
                for (const r of roots) next[r.id] = true
                // If we have a parent from URL, also expand it
                const parentFromUrl = searchParams?.get('parent')
                if (parentFromUrl) next[parentFromUrl] = true
                return next
            })
        } catch (err: any) {
            setError(err.message || 'Failed to load workflow')
        } finally {
            setIsLoading(false)
        }
    }, [selectedOrgId, setNodes, setEdges])

    // Helper: rebuild sidebar tree from current nodes state (used after local deletes)
    const rebuildTreeFromNodes = useCallback((ns: Node[]) => {
        const items: { id: string; name: string; parentId?: string | null }[] = ns
            .filter((n) => n.type === 'stepNode')
            .map((n) => ({ id: n.id, name: (n.data as any)?.label || 'Step', parentId: (n.data as any)?.parentId ?? null }))
        // Only include nodes that are parents of someone
        const parentIds = new Set<string>(items.map((i) => i.parentId).filter((v): v is string => !!v))
        const byId: Record<string, TreeItem> = {}
        for (const it of items) if (parentIds.has(it.id)) byId[it.id] = { id: it.id, name: it.name, children: [] }
        const roots: TreeItem[] = []
        for (const it of items) {
            if (!parentIds.has(it.id)) continue
            const pid = it.parentId
            if (pid && byId[pid]) byId[pid].children.push(byId[it.id])
            else roots.push(byId[it.id])
        }
        const sortTree = (arr: TreeItem[]) => { arr.sort((a, b) => a.name.localeCompare(b.name)); arr.forEach((c) => sortTree(c.children)) }
        sortTree(roots)
        setTree(roots)
    }, [])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    // Apply initial selection from URL after nodes/edges are loaded (run once per parent value)
    // This is now mainly for subsequent URL changes since initial filtering happens in fetchData
    useEffect(() => {
        const parentId = searchParams?.get('parent')
        if (!nodes.length) return
        
        if (parentId) {
            // If parent param exists, filter to children of that parent
            if (appliedParentRef.current === parentId) return
            // Mark selected only if needed
            setNodes((ns) => {
                let changed = false
                for (const n of ns) {
                    const desired = n.id === parentId
                    if ((!!n.selected) !== desired) { changed = true; break }
                }
                if (!changed) return ns
                return ns.map((n) => ({ ...n, selected: n.id === parentId }))
            })
            showChildrenOf(parentId)
            // Ensure expanded state includes this parent
            setExpanded((prev) => ({ ...prev, [parentId]: true }))
            appliedParentRef.current = parentId
        } else {
            // If no parent param, show only root nodes (empty parent_step_id)
            if (appliedParentRef.current === null) return
            showRootNodesOnly()
            appliedParentRef.current = null
        }
    }, [searchParams, nodes, showChildrenOf, setNodes, showRootNodesOnly])

    // Add a new process_step as a node for the selected organization
    const handleAddStep = useCallback(async () => {
        if (!selectedOrgId) {
            setError('Select an organization first')
            return
        }
        try {
            const parentFromUrl = searchParams?.get('parent') || null
            const { data: newRows, error: insertErr } = await supabase
                .from('process_step')
                .insert({
                    organisation_id: selectedOrgId,
                    name: 'New Node',
                    description: null,
                    metadata: {},
                    parent_step_id: parentFromUrl,
                })
                .select('id')
                .limit(1)
            if (insertErr) throw insertErr
            const newId = newRows?.[0]?.id as string
            if (!newId) throw new Error('Failed to create step')

            // Add to local graph and re-layout with position hints
            const newNode: Node = {
                id: newId,
                type: 'stepNode',
                data: { label: 'New Node', description: '', parentId: parentFromUrl },
                position: { x: 0, y: 0 }, // ELK will position this
                style: {
                    border: '1px solid #1f2937',
                    background: 'rgba(17,24,39,0.9)',
                    color: '#e5e7eb',
                }
            }
            const allNodes = [...nodes, newNode]
            const { nodes: laidNodes, edges: laidEdges } = await applyElkLayout(allNodes, edges)
            setNodes(laidNodes)
            setEdges(laidEdges)
            layoutSigRef.current = computeTopologySignature(laidNodes, laidEdges)
            if (parentFromUrl) {
                queueMicrotask(() => showChildrenOf(parentFromUrl))
            }
        } catch (e: any) {
            setError(e.message || 'Failed to add node')
        }
    }, [selectedOrgId, nodes, edges, applyElkLayout, searchParams, showChildrenOf])

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
        const nodeDeletes = Object.keys(pendingNodeDeletes)
        const edgeDeletes = Object.keys(pendingEdgeDeletes)
        if (entries.length === 0 && edgeEntries.length === 0 && nodeDeletes.length === 0 && edgeDeletes.length === 0) return
        setIsSaving(true)
        try {
            // Build upsert payload for process_step
            const payload = entries
                .filter(([id]) => !id.startsWith('flow-'))
                .filter(([id]) => !pendingNodeDeletes[id]) // skip nodes being deleted
                .map(([id, val]) => ({
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
                const edgePayload = edgeEntries
                    .filter(([id]) => !pendingEdgeDeletes[id]) // skip edges being deleted
                    .map(([id, label]) => ({ id, label: (label?.trim()?.length ? label.trim() : null) as any }))
                const { error: edgeErr } = await supabase
                    .from('process_flow_edge')
                    .upsert(edgePayload, { onConflict: 'id' })
                if (edgeErr) throw edgeErr
            }
            // Apply deletions: edges first, then nodes
            if (edgeDeletes.length > 0) {
                const { error: delEdgesErr } = await supabase
                    .from('process_flow_edge')
                    .delete()
                    .in('id', edgeDeletes as any)
                if (delEdgesErr) throw delEdgesErr
            }
            // Ensure no edges remain that reference nodes being deleted
            if (nodeDeletes.length > 0) {
                const { error: delEdgesFromNodesErr } = await supabase
                    .from('process_flow_edge')
                    .delete()
                    .in('from_step_id', nodeDeletes as any)
                if (delEdgesFromNodesErr) throw delEdgesFromNodesErr
                const { error: delEdgesToNodesErr } = await supabase
                    .from('process_flow_edge')
                    .delete()
                    .in('to_step_id', nodeDeletes as any)
                if (delEdgesToNodesErr) throw delEdgesToNodesErr
            }
            if (nodeDeletes.length > 0) {
                const { error: delNodesErr } = await supabase
                    .from('process_step')
                    .delete()
                    .in('id', nodeDeletes as any)
                if (delNodesErr) throw delNodesErr
            }
            // Clear local dirty flags; graph is already up-to-date locally (soft-deletes applied earlier)
            setDirtyEdits({})
            setEdgeDirtyEdits({})
            setPendingNodeDeletes({})
            setPendingEdgeDeletes({})
            setEditingNodeId(null)
        } catch (e: any) {
            setError(e.message || 'Failed to save changes')
        } finally {
            setIsSaving(false)
        }
    }, [dirtyEdits, edgeDirtyEdits, pendingNodeDeletes, pendingEdgeDeletes, selectedOrgId])

    const onConnect = useCallback(async (connection: any) => {
        // Persist a new flow edge between two steps, then refresh
        try {
            // Mark that a valid connection occurred so onConnectEnd won't create a new node
            didConnectRef.current = true
            if (!selectedOrgId || !connection?.source || !connection?.target) return
            const { data: flowRows, error: flowErr } = await supabase
                .from('process_flow_edge')
                .insert({
                    organisation_id: selectedOrgId,
                    from_step_id: String(connection.source),
                    to_step_id: String(connection.target),
                    metadata: {},
                    label: null,
                })
                .select('id, label')
                .limit(1)
            if (flowErr) throw flowErr
            const newEdgeId = String(flowRows?.[0]?.id)
            // Update local edges without re-fetching
            const newEdge: Edge = {
                id: newEdgeId,
                source: String(connection.source),
                target: String(connection.target),
                type: 'electron',
                label: undefined,
                data: { labelText: '', animate: animateEdges } as any,
            }
            setEdges((prev) => styleEdges([...prev, newEdge]))
        } catch (e: any) {
            // Reset flag on failure so user can retry and pane-drop works
            didConnectRef.current = false
            setError(e.message || 'Failed to connect nodes')
        }
    }, [selectedOrgId, animateEdges, styleEdges])

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
        // If a connection was made, do not create a new node
        if (didConnectRef.current) {
            didConnectRef.current = false
            return
        }
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
            const parentFromUrl = searchParams?.get('parent') || null
            // 1) Create the new step
            const { data: stepRows, error: stepErr } = await supabase
                .from('process_step')
                .insert({ organisation_id: selectedOrgId, name: 'New Node', description: null, metadata: {}, parent_step_id: parentFromUrl })
                .select('id')
                .limit(1)
            if (stepErr) throw stepErr
            const newStepId = stepRows?.[0]?.id as string
            if (!newStepId) throw new Error('Failed to create step')

            // 2) Create the flow connecting source -> new step
            const { data: flowRows, error: flowErr } = await supabase
                .from('process_flow_edge')
                .insert({ organisation_id: selectedOrgId, from_step_id: sourceId, to_step_id: newStepId, metadata: {}, label: null })
                .select('id')
                .limit(1)
            if (flowErr) throw flowErr

            // 3) Update local graph and re-layout with position hints; start editing new node
            const newNode: Node = {
                id: newStepId,
                type: 'stepNode',
                data: { label: 'New Node', description: '', parentId: parentFromUrl },
                position: { x: 0, y: 0 }, // ELK will position this
                style: { border: '1px solid #1f2937', background: 'rgba(17,24,39,0.9)', color: '#e5e7eb' }
            }
            const newEdge: Edge = {
                id: String(flowRows?.[0]?.id || `${sourceId}-${newStepId}`),
                source: String(sourceId),
                target: String(newStepId),
                type: 'electron',
                label: undefined,
                data: { labelText: '', animate: animateEdges } as any,
            }
            const allNodes = [...nodes, newNode]
            const styledEdges = styleEdges([...edges, newEdge])
            const { nodes: laidNodes, edges: laidEdges } = await applyElkLayout(allNodes, styledEdges)
            setNodes(laidNodes)
            setEdges(laidEdges)
            layoutSigRef.current = computeTopologySignature(laidNodes, laidEdges)
            setEditingNodeId(newStepId)
            // Maintain filtered view if a parent is selected in URL
            if (parentFromUrl) {
                queueMicrotask(() => showChildrenOf(parentFromUrl))
            }
        } catch (e: any) {
            setError(e.message || 'Failed to create connected node')
        }
    }, [selectedOrgId, nodes, edges, applyElkLayout, styleEdges, animateEdges, searchParams, showChildrenOf])

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
                // Remove from local graph and mark for deletion on Save
                setNodes((ns) => {
                    const filtered = ns.filter((n) => n.id !== nodeId)
                    // Refresh sidebar tree from filtered nodes
                    queueMicrotask(() => rebuildTreeFromNodes(filtered))
                    return filtered
                })
                // Collect connected edges and remove them locally, mark for deletion
                const connected = edges.filter((e) => e.source === nodeId || e.target === nodeId).map((e) => String(e.id))
                setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId))
                setPendingNodeDeletes((prev) => ({ ...prev, [nodeId]: true }))
                if (connected.length) {
                    setPendingEdgeDeletes((prev) => connected.reduce((acc, id) => ({ ...acc, [id]: true }), { ...prev }))
                    // Clear any pending label edits for removed edges
                    setEdgeDirtyEdits((prev) => {
                        const next = { ...prev }
                        connected.forEach((id) => { delete (next as any)[id] })
                        return next
                    })
                }
                // Clear any dirty edits for this node
                setDirtyEdits((prev) => { const next = { ...prev }; delete (next as any)[nodeId]; return next })
                if (editingNodeId === nodeId) setEditingNodeId(null)
            } else if (contextMenu.kind === 'edge') {
                const flowId = contextMenu.targetId
                setEdges((eds) => eds.filter((e) => String(e.id) !== String(flowId)))
                setPendingEdgeDeletes((prev) => ({ ...prev, [flowId]: true }))
                setEdgeDirtyEdits((prev) => { const next = { ...prev }; delete (next as any)[flowId]; return next })
            }
        } catch (e: any) {
            setError(e.message || 'Failed to delete')
        } finally {
            closeMenu()
        }
    }, [contextMenu, edges, closeMenu, editingNodeId, rebuildTreeFromNodes, setNodes, setEdges])

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
                        disabled={!selectedOrgId || isSaving || (
                            Object.keys(dirtyEdits).length === 0 &&
                            Object.keys(edgeDirtyEdits).length === 0 &&
                            Object.keys(pendingNodeDeletes).length === 0 &&
                            Object.keys(pendingEdgeDeletes).length === 0
                        )}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed bg-gray-800 hover:bg-gray-700 text-yellow-400 border border-gray-700"
                        aria-label="Save changes"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M19 21H5a2 2 0 0 1-2-2V7l4-4h10l4 4v12a2 2 0 0 1-2 2z" />
                            <path d="M17 21v-8H7v8M7 3v4h10V3" />
                        </svg>
                        {isSaving ? 'Saving…' : 'Save'}
                        {(Object.keys(pendingNodeDeletes).length + Object.keys(pendingEdgeDeletes).length) > 0 && (
                            <span className="ml-1 inline-flex items-center justify-center rounded bg-red-500/20 text-red-300 text-[11px] px-1.5 py-0.5">
                                {Object.keys(pendingNodeDeletes).length + Object.keys(pendingEdgeDeletes).length}
                            </span>
                        )}
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
                        onClick={() => setAnimateEdges((v) => !v)}
                        className="inline-flex items-center gap-2 px-2 py-1 rounded-md text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700"
                        aria-label="Toggle edge animation"
                        title="Toggle edge animation"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12l5 5L20 7" />
                        </svg>
                        {animateEdges ? 'Animate: On' : 'Animate: Off'}
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
                <div className="h-[calc(100vh-64px)] flex">
                    {/* Sidebar: hierarchical index */}
                    <div className={`${sidebarOpen ? 'w-72' : 'w-8'} h-full border-r border-gray-800 bg-gray-900/60 backdrop-blur-sm transition-[width] duration-200 overflow-hidden relative`}>
                        {/* Always-visible sidebar toggle */}
                        <button
                            className="absolute top-1 right-1 z-20 p-1 rounded hover:bg-gray-800 text-gray-300"
                            aria-label={sidebarOpen ? 'Collapse' : 'Expand'}
                            title={sidebarOpen ? 'Collapse' : 'Expand'}
                            onClick={() => setSidebarOpen((v) => !v)}
                        >
                            {sidebarOpen ? (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M12.78 15.28a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 0-1.06l4.5-4.5a.75.75 0 1 1 1.06 1.06L8.56 10l4.22 4.22a.75.75 0 0 1 0 1.06Z" clipRule="evenodd" /></svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M7.22 4.72a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 1 1-1.06-1.06L11.44 10 7.22 5.78a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
                            )}
                        </button>
                        <div className="h-9 flex items-center justify-between px-2 border-b border-gray-800">
                            <div className={`text-xs font-semibold text-gray-300 ${sidebarOpen ? 'block' : 'hidden'}`}>Index</div>
                            <button
                                className="p-1 rounded hover:bg-gray-800 text-gray-300"
                                aria-label={sidebarOpen ? 'Collapse' : 'Expand'}
                                title={sidebarOpen ? 'Collapse' : 'Expand'}
                                onClick={() => setSidebarOpen((v) => !v)}
                            >
                                {sidebarOpen ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M12.78 15.28a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 0-1.06l4.5-4.5a.75.75 0 1 1 1.06 1.06L8.56 10l4.22 4.22a.75.75 0 0 1 0 1.06Z" clipRule="evenodd" /></svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M7.22 4.72a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 1 1-1.06-1.06L11.44 10 7.22 5.78a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
                                )}
                            </button>
                        </div>
                        {sidebarOpen && (
                            <div className="h-[calc(100%-36px)] overflow-auto py-2">
                                {/* Company name as first item */}
                                <div className="px-2 mb-1">
                                    <button
                                        type="button"
                                        onClick={() => { showRootNodesOnly(); setParentQuery(null) }}
                                        className="w-full text-left truncate text-xs text-yellow-300 font-semibold hover:text-yellow-200"
                                        title={(orgs.find(o => o.id === selectedOrgId)?.name || 'Organisation') + ' — show top-level nodes'}
                                    >
                                        {orgs.find(o => o.id === selectedOrgId)?.name || 'Organisation'}
                                    </button>
                                </div>
                                <SidebarTree
                                    roots={tree}
                                    expanded={expanded}
                                    onToggle={(id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))}
                                    selectedId={searchParams?.get('parent') || null}
                                    onSelect={async (id) => {
                                        // Keep current dataset; filter view to children of selected node
                                        setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })))
                                        setParentQuery(id)
                                        showChildrenOf(id)
                                    }}
                                />
                            </div>
                        )}
                    </div>
                    {/* Main canvas area */}
                    <div className="flex-1 relative">
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
                            edgeTypes={{ electron: ElectronEdge }}
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
                </div>
            )}
        </div>
    )
}

// Sidebar tree components
function SidebarTree({ roots, expanded, onToggle, onSelect, selectedId }: { roots: TreeItem[]; expanded: Record<string, boolean>; onToggle: (id: string) => void; onSelect: (id: string) => void; selectedId?: string | null }) {
    return (
        <div className="px-2">
            {roots.length === 0 ? (
                <div className="text-xs text-gray-500 px-2 py-2">No steps</div>
            ) : (
                roots.map((r, i) => (
                    <TreeRow key={r.id} item={r} level={0} index={i + 1} prefix="" expanded={expanded} onToggle={onToggle} onSelect={onSelect} selectedId={selectedId || undefined} />
                ))
            )}
        </div>
    )
}

function TreeRow({ item, level, index, prefix, expanded, onToggle, onSelect, selectedId }: { item: TreeItem; level: number; index: number; prefix: string; expanded: Record<string, boolean>; onToggle: (id: string) => void; onSelect: (id: string) => void; selectedId?: string }) {
    const hasChildren = item.children.length > 0
    const isOpen = expanded[item.id]
    const numberLabel = prefix ? `${prefix}.${index}` : `${index}`
    const isSelected = selectedId === item.id
    return (
        <div className="select-none">
            <div className="flex items-center gap-1 py-1"
                style={{ paddingLeft: 8 + level * 12 }}
            >
                {hasChildren ? (
                    <button
                        type="button"
                        className="p-0.5 rounded hover:bg-gray-800 text-gray-300"
                        onClick={(e) => { e.stopPropagation(); onToggle(item.id) }}
                        aria-label={isOpen ? 'Collapse' : 'Expand'}
                        aria-expanded={isOpen}
                    >
                        {isOpen ? (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5"><path fillRule="evenodd" d="M5.22 7.22a.75.75 0 0 1 1.06 0L10 10.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5"><path fillRule="evenodd" d="M7.22 5.22a.75.75 0 0 1 1.06 0l3.72 3.72-3.72 3.72a.75.75 0 1 1-1.06-1.06L9.94 10 7.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
                        )}
                    </button>
                ) : (
                    // Spacer to align with chevron width
                    <span className="inline-block w-3.5" />
                )}
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation()
                        if (hasChildren) onToggle(item.id)
                        else onSelect(item.id)
                    }}
                    onDoubleClick={(e) => { e.stopPropagation(); onSelect(item.id) }}
                    className={`truncate text-left text-xs hover:text-yellow-300 ${isSelected ? 'text-yellow-300 font-semibold' : 'text-gray-200'}`}
                    title={`${numberLabel} ${item.name}`}
                    role={hasChildren ? 'treeitem' : undefined}
                    aria-expanded={hasChildren ? isOpen : undefined}
                >
                    <span className={`mr-1 ${isSelected ? 'text-yellow-400' : 'text-gray-400'}`}>{numberLabel}.</span> {item.name}
                </button>
            </div>
            {hasChildren && isOpen && (
                <div>
                    {item.children.map((c, idx) => (
                        <TreeRow key={c.id} item={c} level={level + 1} index={idx + 1} prefix={numberLabel} expanded={expanded} onToggle={onToggle} onSelect={onSelect} selectedId={selectedId} />
                    ))}
                </div>
            )}
        </div>
    )
}
