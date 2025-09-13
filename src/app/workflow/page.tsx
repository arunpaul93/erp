'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
    Background,
    Controls,
    Edge,
    type Connection,
    Node,
    ReactFlowProvider,
    Handle,
    Position,
    addEdge,
    type OnConnect,
    type OnConnectEnd,
    type OnConnectStart,
    type NodeProps,
    useReactFlow,
    useEdgesState,
    useNodesState,
    SelectionMode,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { hierarchy, tree } from 'd3-hierarchy'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import EditableLabelEdge from '@/components/flow/EditableLabelEdge'

type D3Node = { id: string; children?: D3Node[] }
type LayoutCfg = {
    baseX: number
    baseY: number
    colGap: number
    rowPadding: number // vertical padding between nodes within a column
}

// Custom node with side handles (left target, right source) and inline edit on double click
function SideNode(props: NodeProps<{ label?: string }>) {
    const { id, data, selected } = props
    const [isEditing, setIsEditing] = useState(false)
    const [value, setValue] = useState<string>(data?.label ?? 'Step')
    const taRef = useRef<HTMLTextAreaElement | null>(null)
    const [editWidth, setEditWidth] = useState<number>(160)

    const measureTextWidth = useCallback((text: string) => {
        // approximate measurement using canvas 2D context to match text-sm
        const canvas = (measureTextWidth as any)._c || document.createElement('canvas')
        ;(measureTextWidth as any)._c = canvas
        const ctx = canvas.getContext('2d')
        if (!ctx) return Math.max(128, text.length * 8)
        // Tailwind text-sm ~ 0.875rem (~14px). Use a common sans-serif stack
        ctx.font = '14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Noto Sans", "Liberation Sans", sans-serif'
        const lines = (text || '').split('\n')
        let max = 0
        for (const line of lines) {
            const width = ctx.measureText(line.length ? line : ' ').width
            if (width > max) max = width
        }
        // add inner padding to match px-1 and container px-3
        const padding = 8 /* textarea px-1 left+right ~ 8px */ + 24 /* container px-3 ~ 24px */
        // clamp to reasonable bounds
        return Math.min(Math.max(128, Math.ceil(max + padding)), 640)
    }, [])

    useEffect(() => {
        if (!isEditing) return
        setEditWidth(measureTextWidth(value))
    }, [isEditing, value, measureTextWidth])

    const startEdit = useCallback(() => {
        setValue(data?.label ?? 'Step')
        setIsEditing(true)
    }, [data?.label])

    const commit = useCallback((next: string) => {
        const event = new CustomEvent('updateNodeLabel', { detail: { nodeId: id, newLabel: next } })
        window.dispatchEvent(event)
        setIsEditing(false)
    }, [id])

    const cancel = useCallback(() => setIsEditing(false), [])

    // Ask the graph to enter edit mode for this node (so auto-layout pauses)
    const requestEdit = useCallback(() => {
        const evt = new CustomEvent('startNodeEdit', { detail: { nodeId: id } })
        window.dispatchEvent(evt)
    }, [id])

    // Listen for external edit trigger
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { nodeId: string }
            console.log('Edit event received for node:', detail?.nodeId, 'current node:', id)
            if (detail?.nodeId === id) {
                console.log('Starting edit for node:', id)
                startEdit()
            }
        }
        window.addEventListener('startNodeEdit', handler as any)
        return () => window.removeEventListener('startNodeEdit', handler as any)
    }, [id, startEdit])

    return (
        <div
            onDoubleClick={requestEdit}
            className={
                'rounded-md border bg-white text-gray-900 px-3 py-2 shadow-sm min-w-32 ' +
                (selected ? 'border-blue-400' : 'border-gray-300')
            }
        >
            <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-slate-400" />
            {isEditing ? (
                <textarea
                    ref={taRef}
                    className="text-sm bg-white text-gray-900 outline-none border border-gray-300 rounded px-1 py-1 resize-none"
                    autoFocus
                    rows={1}
                    value={value}
                    onChange={(e) => {
                        setValue(e.target.value)
                        const el = taRef.current
                        if (el) {
                            el.style.height = 'auto'
                            el.style.height = `${el.scrollHeight}px`
                        }
                        setEditWidth(measureTextWidth(e.target.value))
                    }}
                    onFocus={() => {
                        const el = taRef.current
                        if (el) {
                            el.style.height = 'auto'
                            el.style.height = `${el.scrollHeight}px`
                        }
                        setEditWidth(measureTextWidth(value))
                    }}
                    onBlur={() => commit(value)}
                    onKeyDown={(e) => {
                        // Enter inserts newline by default; Ctrl/Cmd+Enter commits
                        if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
                            e.preventDefault()
                            commit(value)
                        }
                        if (e.key === 'Escape') {
                            e.preventDefault()
                            cancel()
                        }
                    }}
                    style={{ width: `${editWidth}px` }}
                />
            ) : (
                <div
                    className="text-sm whitespace-pre-wrap leading-snug cursor-pointer"
                    onDoubleClick={requestEdit}
                >
                    {data?.label ?? 'Step'}
                </div>
            )}
            <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-sky-400" />
        </div>
    )
}

// Register node types as a static object to avoid hook usage in conditional render paths
const nodeTypes = { side: SideNode }
const edgeTypes = { editableLabel: EditableLabelEdge }

function computeLevels(nodes: Node[], edges: Edge[]) {
    // Nodes with no incoming edges are sources; assign level 0, then BFS forward
    const incomingCount = new Map<string, number>()
    nodes.forEach((n) => incomingCount.set(n.id, 0))
    edges.forEach((e) => incomingCount.set(e.target, (incomingCount.get(e.target) || 0) + 1))
    const queue: string[] = []
    const level: Record<string, number> = {}
    nodes.forEach((n) => {
        if ((incomingCount.get(n.id) || 0) === 0) {
            level[n.id] = 0
            queue.push(n.id)
        }
    })
    if (queue.length === 0 && nodes.length) {
        // fallback for cycles
        level[nodes[0].id] = 0
        queue.push(nodes[0].id)
    }
    while (queue.length) {
        const u = queue.shift()!
        const next = (level[u] || 0) + 1
        edges
            .filter((e) => e.source === u)
            .forEach((e) => {
                if (!(e.target in level)) {
                    level[e.target] = next
                    queue.push(e.target)
                }
            })
    }
    return level
}

function orderWithinLevels(levels: Record<string, number>, nodes: Node[], edges: Edge[]) {
    // Build children map by following edges that increase level by 1
    const childrenMap = new Map<string, string[]>()
    nodes.forEach((n) => childrenMap.set(n.id, []))
    edges.forEach((e) => {
        if ((levels[e.source] ?? 0) + 1 === (levels[e.target] ?? 0)) {
            childrenMap.get(e.source)!.push(e.target)
        }
    })

    // Roots = min level nodes
    const minLevel = Math.min(...Object.values(levels))
    const roots = nodes.filter((n) => (levels[n.id] ?? 0) === minLevel).map((n) => n.id)
    const visited = new Set<string>()
    const build = (id: string): D3Node => {
        if (visited.has(id)) return { id, children: [] }
        visited.add(id)
        const children = (childrenMap.get(id) || []).map(build)
        return { id, children }
    }
    const forest: D3Node[] = roots.map(build)
    const superRoot: D3Node = { id: '__root__', children: forest }
    const root = hierarchy<D3Node>(superRoot, (d) => d.children || [])
    const layoutTree = tree<D3Node>().separation((a, b) => (a.parent === b.parent ? 1 : 2))
    const laid = layoutTree(root)
    const xById = new Map<string, number>()
    laid
        .descendants()
        .forEach((d) => {
            const nid = d.data.id
            if (nid && nid !== '__root__') xById.set(nid, d.x || 0)
        })

    // Group by level and sort by x
    const nodesByLevel = new Map<number, Node[]>()
    nodes.forEach((n) => {
        const L = levels[n.id] || 0
        if (!nodesByLevel.has(L)) nodesByLevel.set(L, [])
        nodesByLevel.get(L)!.push(n)
    })
    nodesByLevel.forEach((arr) => arr.sort((a, b) => (xById.get(a.id) ?? 0) - (xById.get(b.id) ?? 0)))
    return nodesByLevel
}

// Estimate node width if measured width isn't available yet
function estimateNodeWidth(n: Node) {
    const measured = (n as any).width as number | undefined
    if (measured && measured > 0) return measured
    const label = ((n.data as any)?.label as string) ?? ''
    const longestLine = label.split('\n').reduce((m, s) => Math.max(m, s.length), 0)
    const charW = 7.5 // approx for text-sm
    const padding = 24 // px-3 on both sides ~ 12*2
    const minW = 128 // Tailwind min-w-32
    return Math.max(minW, Math.ceil(longestLine * charW + padding))
}

function estimateNodeHeight(n: Node) {
    const measured = (n as any).height as number | undefined
    if (measured && measured > 0) return measured
    const label = ((n.data as any)?.label as string) ?? ''
    const lines = Math.max(1, label.split('\n').length)
    const lineH = 18 // ~1.125rem line-height for text-sm
    const paddingY = 16 // py-2 container + textarea differences
    const minH = 40
    return Math.max(minH, lines * lineH + paddingY)
}

function layout(nodesIn: Node[], edges: Edge[], cfg: LayoutCfg = { baseX: 120, baseY: 120, colGap: 80, rowPadding: 32 }) {
    const levels = computeLevels(nodesIn, edges)
    const byLevel = orderWithinLevels(levels, nodesIn, edges)
    const sortedLevels = Array.from(byLevel.keys()).sort((a, b) => a - b)

    // Determine max width per column
    const colMaxWidth: Record<number, number> = {}
    sortedLevels.forEach((L) => {
        const arr = byLevel.get(L) || []
        colMaxWidth[L] = Math.max(1, ...arr.map((n) => estimateNodeWidth(n)))
    })

    // Compute x positions cumulatively using each column's max width
    const colX: Record<number, number> = {}
    let runningX = cfg.baseX
    sortedLevels.forEach((L, idx) => {
        if (idx === 0) {
            colX[L] = runningX
        } else {
            const prevL = sortedLevels[idx - 1]
            runningX = (colX[prevL] || cfg.baseX) + (colMaxWidth[prevL] || 0) + cfg.colGap
            colX[L] = runningX
        }
    })

    // For each column, stack nodes centered vertically using measured heights; center nodes within column width
    const positioned = nodesIn.map((n) => ({ ...n }))
    const nodeIndex = new Map<string, number>()
    sortedLevels.forEach((L) => {
        const arr = byLevel.get(L) || []
        const heights = arr.map((n) => estimateNodeHeight(n))
        const totalHeight = heights.reduce((a, b) => a + b, 0) + Math.max(0, arr.length - 1) * cfg.rowPadding
        let cursorY = cfg.baseY - totalHeight / 2
        const colW = colMaxWidth[L] || 0
        arr.forEach((n, i) => {
            nodeIndex.set(n.id, i)
            const estimatedW = estimateNodeWidth(n)
            const left = (colX[L] || cfg.baseX) + Math.max(0, (colW - estimatedW) / 2)
            const y = cursorY
            cursorY += heights[i] + cfg.rowPadding
            const idx = positioned.findIndex((p) => p.id === n.id)
            if (idx >= 0) positioned[idx] = { ...positioned[idx], position: { x: left, y } }
        })
    })
    return { nodes: positioned, levels, nodeIndex }
}

function WorkflowInner() {
    const { selectedOrgId } = useOrg()
    const [nodes, setNodes, onNodesChange] = useNodesState([])
    const [edges, setEdges, onEdgesChange] = useEdgesState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const rf = useReactFlow()

    // Track connection state to decide whether to create a new node on free drop
    const [connectingFromId, setConnectingFromId] = useState<string | null>(null)
    const [didConnect, setDidConnect] = useState(false)
    const [saving, setSaving] = useState(false)
    const [saveMsg, setSaveMsg] = useState<string | null>(null)
    const [isEditingEdge, setIsEditingEdge] = useState<boolean>(false)
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
    const [layoutConfig, setLayoutConfig] = useState<LayoutCfg>({ baseX: 120, baseY: 120, colGap: 80, rowPadding: 32 })
    const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
    const [menuTarget, setMenuTarget] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null)
    const [configOpen, setConfigOpen] = useState(false)
    // Re-enable auto-layout; it will pause while editing
    const AUTO_LAYOUT = true

    // ID helpers (UUID v4)
    const generateUuid = () =>
        (globalThis as any).crypto?.randomUUID?.() ||
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0
            const v = c === 'x' ? r : (r & 0x3) | 0x8
            return v.toString(16)
        })
    const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)

    // Snapshot of last loaded/saved state to compute diffs
    const snapshotRef = useRef<{ nodeName: Record<string, string>; edgeLabel: Record<string, string> }>(
        { nodeName: {}, edgeLabel: {} }
    )
    // Track deletions to persist
    const deletedNodeIdsRef = useRef<Set<string>>(new Set())
    const deletedEdgeIdsRef = useRef<Set<string>>(new Set())

    const load = useCallback(async () => {
        if (!selectedOrgId) return
        setLoading(true)
        setError(null)
        try {
            const { data: steps, error: sErr } = await supabase
                .from('process_step')
                .select('id, name, description, metadata, parent_step_id')
                .eq('organisation_id', selectedOrgId)
            if (sErr) throw sErr
            const { data: flows, error: fErr } = await supabase
                .from('process_flow_edge')
                .select('id, from_step_id, to_step_id, label, metadata')
                .eq('organisation_id', selectedOrgId)
            if (fErr) throw fErr

            const rfNodes: Node[] = (steps || []).map((s: any) => ({
                id: String(s.id),
                data: { label: s.name || 'Step' },
                position: { x: 0, y: 0 },
                type: 'side',
            }))
            const rfEdges: Edge[] = (flows || []).map((e: any) => ({
                id: String(e.id),
                source: String(e.from_step_id),
                target: String(e.to_step_id),
                type: 'editableLabel',
                data: { label: e.label || '' },
            }))

            const { nodes: laid } = layout(rfNodes, rfEdges, layoutConfig)
            setNodes(laid)
            setEdges(rfEdges)
            // refresh snapshot
            const nodeName: Record<string, string> = {}
            laid.forEach((n) => (nodeName[n.id] = (n.data as any)?.label ?? ''))
            const edgeLabel: Record<string, string> = {}
            rfEdges.forEach((e) => (edgeLabel[e.id] = ((e as any).data?.label as string) ?? ''))
            snapshotRef.current = { nodeName, edgeLabel }
        } catch (err: any) {
            setError(err?.message || 'Failed to load processes')
            setNodes([])
            setEdges([])
        } finally {
            setLoading(false)
        }
    }, [selectedOrgId, setNodes, setEdges])

    useEffect(() => {
        void load()
    }, [load])

    // Auto-layout: whenever the graph structure (node ids or edge pairs) changes
    const structureKey = useMemo(() => {
        const n = [...nodes.map((x) => x.id)].sort()
        const e = [...edges.map((x) => `${x.source}->${x.target}`)].sort()
        return JSON.stringify({ n, e })
    }, [nodes, edges])

    // When nodes get measured widths after first render, recompute layout to use true widths
    const widthKey = useMemo(() => nodes.map((n) => (n as any).width || 0).join(','), [nodes])
    const heightKey = useMemo(() => nodes.map((n) => (n as any).height || 0).join(','), [nodes])

    useEffect(() => {
        // compute layout only when structure changes AND nothing is being edited
        if (!AUTO_LAYOUT) return
        if (editingNodeId || isEditingEdge) return // skip layout while editing
        const { nodes: laid } = layout(nodes, edges, layoutConfig)
        setNodes(laid)
        // do not setEdges here to avoid changing edge objects needlessly
    }, [structureKey, editingNodeId, isEditingEdge, layoutConfig])

    useEffect(() => {
        // Re-run layout once widths are known
        if (!AUTO_LAYOUT) return
        if (editingNodeId || isEditingEdge) return
        const { nodes: laid } = layout(nodes, edges, layoutConfig)
        setNodes(laid)
    }, [widthKey, editingNodeId, isEditingEdge, layoutConfig])

    useEffect(() => {
        if (!AUTO_LAYOUT) return
        if (editingNodeId || isEditingEdge) return
        const { nodes: laid } = layout(nodes, edges, layoutConfig)
        setNodes(laid)
    }, [heightKey, editingNodeId, isEditingEdge, layoutConfig])

    // Listen for inline node label update events from custom nodes
    useEffect(() => {
        const handleUpdate = (e: Event) => {
            const detail = (e as CustomEvent).detail as { nodeId: string; newLabel: string }
            if (!detail?.nodeId) return
            setNodes((nds) => nds.map((n) => (n.id === detail.nodeId ? { ...n, data: { ...(n.data as any), label: detail.newLabel } } : n)))
            setEditingNodeId(null) // clear editing state when update completes
        }
        
        const handleStartEdit = (e: Event) => {
            const detail = (e as CustomEvent).detail as { nodeId: string }
            if (!detail?.nodeId) return
            setEditingNodeId(detail.nodeId) // track which node is being edited
        }
        
        window.addEventListener('updateNodeLabel', handleUpdate as any)
        window.addEventListener('startNodeEdit', handleStartEdit as any)
        return () => {
            window.removeEventListener('updateNodeLabel', handleUpdate as any)
            window.removeEventListener('startNodeEdit', handleStartEdit as any)
        }
    }, [setNodes])

    // Double click node to trigger inline editing
    const onNodeDoubleClick = useCallback((_: any, node: Node) => {
        console.log('Node double clicked:', node.id)
        // Dispatch event to trigger editing mode in the node
        const event = new CustomEvent('startNodeEdit', { detail: { nodeId: node.id } })
        window.dispatchEvent(event)
    }, [])

    // Provide commit + editing callbacks to edge data at render time
    const onEdgeLabelCommit = useCallback((edgeId: string, value: string) => {
        setEdges((eds) => eds.map((e) => (e.id === edgeId ? { ...e, data: { ...(e.data as any), label: value } } : e)))
    }, [setEdges])

    const onEdgeEditingChange = useCallback((_edgeId: string, editing: boolean) => {
        setIsEditingEdge(editing)
    }, [])

    const onOpenEdgeMenu = useCallback((edgeId: string, x: number, y: number) => {
        setMenuTarget({ kind: 'edge', id: edgeId })
        setMenuPos({ x, y })
    }, [])

    const viewEdges = useMemo(() => {
        return edges.map((e) => ({
            ...e,
            type: 'editableLabel',
        data: { ...(e as any).data, label: (e as any).data?.label ?? (e as any).label ?? '', onLabelCommit: onEdgeLabelCommit, onEditingChange: onEdgeEditingChange, onOpenContextMenu: onOpenEdgeMenu },
        })) as Edge[]
    }, [edges, onEdgeLabelCommit, onEdgeEditingChange, onOpenEdgeMenu])

        // Handle delete key for selected nodes/edges
        useEffect(() => {
            const onKey = (e: KeyboardEvent) => {
                if (e.key !== 'Delete' && e.key !== 'Backspace') return
                const toDeleteNodes = nodes.filter((n) => n.selected).map((n) => n.id)
                const toDeleteEdges = edges.filter((ed) => ed.selected).map((ed) => ed.id)
                if (toDeleteNodes.length === 0 && toDeleteEdges.length === 0) return
                // Remove selected edges first
                if (toDeleteEdges.length) {
                    setEdges((eds) => eds.filter((e) => !toDeleteEdges.includes(e.id)))
                    toDeleteEdges.forEach((id) => deletedEdgeIdsRef.current.add(id))
                }
                // Remove selected nodes and any incident edges
                if (toDeleteNodes.length) {
                    // mark incident edges for deletion
                    const incidentEdgeIds = edges.filter((e) => toDeleteNodes.includes(e.source) || toDeleteNodes.includes(e.target)).map((e) => e.id)
                    incidentEdgeIds.forEach((id) => deletedEdgeIdsRef.current.add(id))
                    setNodes((nds) => nds.filter((n) => !toDeleteNodes.includes(n.id)))
                    setEdges((eds) => eds.filter((e) => !toDeleteNodes.includes(e.source) && !toDeleteNodes.includes(e.target)))
                    toDeleteNodes.forEach((id) => deletedNodeIdsRef.current.add(id))
                }
            }
            window.addEventListener('keydown', onKey)
            return () => window.removeEventListener('keydown', onKey)
        }, [nodes, edges, setNodes, setEdges])

    // Start connecting from a source handle (right handle)
    const onConnectStart = useCallback<OnConnectStart>((event, params) => {
        if (params?.handleType === 'source' && params.nodeId) {
            setConnectingFromId(params.nodeId)
            setDidConnect(false)
        }
    }, [])

    // If a valid connection was made, add it and mark didConnect
    const onConnect = useCallback<OnConnect>(
        (connection) => {
            // Prevent backward connections (target must be at a higher level than source)
            if (connection.source && connection.target) {
                const levels = computeLevels(nodes, edges)
                const srcL = levels[connection.source] ?? 0
                const tgtL = levels[connection.target] ?? 0
                if (tgtL <= srcL) {
                    setSaveMsg('Backward connections are not allowed')
                    setTimeout(() => setSaveMsg(null), 2000)
                    return
                }
            }
            setEdges((eds) => {
                const edgeId = generateUuid()
                return addEdge({ id: edgeId, ...connection, type: 'editableLabel', data: { label: '' } } as any, eds)
            })
            setDidConnect(true)
        },
        [setEdges, nodes, edges]
    )

    // If connection ended on empty pane, create a new node and connect to it
    const onConnectEnd = useCallback<OnConnectEnd>(
        (event) => {
            if (!connectingFromId) return
            // If we already connected to a node/handle, skip creating a new node
            if (didConnect) {
                setConnectingFromId(null)
                setDidConnect(false)
                return
            }
            const target = event.target as HTMLElement | null
            const isPane = !!target && target.classList.contains('react-flow__pane')
            if (!isPane) return
            // support mouse and touch
            const isTouch = 'changedTouches' in (event as any) && (event as any).changedTouches?.length > 0
            const clientX = isTouch ? (event as any).changedTouches[0].clientX : (event as any).clientX
            const clientY = isTouch ? (event as any).changedTouches[0].clientY : (event as any).clientY
            const pos = rf.screenToFlowPosition({ x: clientX, y: clientY })
            const newId = generateUuid()
            const newNode: Node = {
                id: newId,
                type: 'side',
                data: { label: 'New Step' },
                position: pos,
            }
            const newEdge: Edge = { id: generateUuid(), source: connectingFromId, target: newId, type: 'editableLabel', data: { label: '' } } as any
            setNodes((nds) => nds.concat(newNode))
            setEdges((eds) => eds.concat(newEdge))
            setConnectingFromId(null)
            setDidConnect(false)
        },
        [connectingFromId, didConnect, rf, setNodes, setEdges]
    )

    // Node context menu handler
    const onNodeContextMenu = useCallback((event: any, node: Node) => {
        event?.preventDefault?.()
        setMenuTarget({ kind: 'node', id: node.id })
        const x = (event?.clientX as number) ?? 0
        const y = (event?.clientY as number) ?? 0
        setMenuPos({ x, y })
    }, [])

    // Close menu on click elsewhere
    useEffect(() => {
        const close = () => setMenuPos(null)
        window.addEventListener('click', close)
        return () => {
            window.removeEventListener('click', close)
        }
    }, [])

    const deleteMenuTarget = useCallback(() => {
        if (!menuTarget) return
        if (menuTarget.kind === 'node') {
            const id = menuTarget.id
            setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id })))
        // mark incident edges for deletion and remove
        const incidentEdgeIds = edges.filter((e) => e.source === id || e.target === id).map((e) => e.id)
        incidentEdgeIds.forEach((eid) => deletedEdgeIdsRef.current.add(eid))
        setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
            deletedNodeIdsRef.current.add(id)
            setNodes((nds) => nds.filter((n) => n.id !== id))
        } else {
            const id = menuTarget.id
            setEdges((eds) => eds.map((e) => ({ ...e, selected: e.id === id })))
            setEdges((eds) => eds.filter((e) => e.id !== id))
            deletedEdgeIdsRef.current.add(id)
        }
        setMenuPos(null)
    }, [menuTarget, setNodes, setEdges, edges])

    // Normalize any temporary IDs to UUIDs (for prior sessions) and update state
    const normalizeIdsIfNeeded = useCallback(() => {
        const idMap: Record<string, string> = {}
        let changed = false
        const fixedNodes = nodes.map((n) => {
            if (!isUuid(n.id)) {
                const newId = generateUuid()
                idMap[n.id] = newId
                changed = true
                return { ...n, id: newId }
            }
            return n
        })
        const fixedEdges = edges.map((e) => {
            let id = e.id
            if (!isUuid(id)) {
                id = generateUuid()
                changed = true
            }
            const source = idMap[e.source] || e.source
            const target = idMap[e.target] || e.target
            if (id !== e.id || source !== e.source || target !== e.target) {
                changed = true
                return { ...e, id, source, target }
            }
            return e
        })
        if (changed) {
            setNodes(fixedNodes)
            setEdges(fixedEdges)
        }
        return { changed, idMap }
    }, [nodes, edges, setNodes, setEdges])

    const saveChanges = useCallback(async () => {
        if (!selectedOrgId) return
        setSaving(true)
        setSaveMsg(null)
        try {
            // Ensure ids are UUIDs
            const { changed } = normalizeIdsIfNeeded()
            // If we changed IDs, wait a tick so state updates before diffing
            if (changed) await new Promise((r) => setTimeout(r, 0))

            const snap = snapshotRef.current
            // Persist deletions first, edges then nodes to satisfy FKs
            if (deletedEdgeIdsRef.current.size || deletedNodeIdsRef.current.size) {
                // Delete edges explicitly selected
                if (deletedEdgeIdsRef.current.size) {
                    const ids = Array.from(deletedEdgeIdsRef.current)
                    const { error: delE } = await supabase.from('process_flow_edge').delete().in('id', ids)
                    if (delE) throw delE
                    // Remove from snapshot so upsert doesn't resurrect
                    ids.forEach((id) => delete snap.edgeLabel[id])
                    deletedEdgeIdsRef.current.clear()
                }
                // Also delete edges incident to nodes queued for deletion (safety against FK violations)
                if (deletedNodeIdsRef.current.size) {
                    const nodeIds = Array.from(deletedNodeIdsRef.current)
                    // delete edges where from_step_id IN nodeIds OR to_step_id IN nodeIds
                    // Supabase JS: use .or with comma-separated filters
                    const orFilter = `from_step_id.in.(${nodeIds.join(',')}),to_step_id.in.(${nodeIds.join(',')})`
                    const { error: delE2 } = await supabase.from('process_flow_edge').delete().or(orFilter)
                    if (delE2) throw delE2
                }
                // Now delete nodes
                if (deletedNodeIdsRef.current.size) {
                    const ids = Array.from(deletedNodeIdsRef.current)
                    const { error: delN } = await supabase.from('process_step').delete().in('id', ids)
                    if (delN) throw delN
                    ids.forEach((id) => delete snap.nodeName[id])
                    deletedNodeIdsRef.current.clear()
                }
            }

                        // New/updated nodes
            const nodeRows: { id: string; organisation_id: string; name: string }[] = nodes.map((n: any) => ({
                id: n.id,
                organisation_id: selectedOrgId,
                name: (n.data?.label as string) ?? '',
            }))
            const newNodes = nodeRows.filter((r) => snap.nodeName[r.id] === undefined)
            const changedNodes = nodeRows.filter((r) => snap.nodeName[r.id] !== undefined && snap.nodeName[r.id] !== r.name)

            if (newNodes.length || changedNodes.length) {
                const upsertNodes = [...newNodes, ...changedNodes]
                const { error: nErr } = await supabase.from('process_step').upsert(upsertNodes, { onConflict: 'id' })
                if (nErr) throw nErr
            }

            // New/updated edges
        const edgeRows: { id: string; organisation_id: string; from_step_id: string; to_step_id: string; label: string }[] = edges.map(
                (e: any) => ({
                    id: e.id,
                    organisation_id: selectedOrgId,
                    from_step_id: e.source,
                    to_step_id: e.target,
            label: (e.data?.label as string) ?? (e.label as string) ?? '',
                })
            )
            const newEdges = edgeRows.filter((r) => snap.edgeLabel[r.id] === undefined)
            const changedEdges = edgeRows.filter((r) => snap.edgeLabel[r.id] !== undefined && snap.edgeLabel[r.id] !== r.label)

            if (newEdges.length || changedEdges.length) {
                const upsertEdges = [...newEdges, ...changedEdges]
                const { error: eErr } = await supabase.from('process_flow_edge').upsert(upsertEdges, { onConflict: 'id' })
                if (eErr) throw eErr
            }

            // Update snapshot to current state
            const nodeName: Record<string, string> = {}
            nodes.forEach((n: any) => (nodeName[n.id] = (n.data?.label as string) ?? ''))
            const edgeLabel: Record<string, string> = {}
            edges.forEach((e: any) => (edgeLabel[e.id] = (e.data?.label as string) ?? (e.label as string) ?? ''))
            snapshotRef.current = { nodeName, edgeLabel }

            setSaveMsg('Saved')
        } catch (err: any) {
            setSaveMsg(err?.message || 'Save failed')
        } finally {
            setSaving(false)
            setTimeout(() => setSaveMsg(null), 2500)
        }
    }, [edges, nodes, normalizeIdsIfNeeded, selectedOrgId])

    // Validate new connections to avoid backwards links
    const isValidConnection = useCallback((conn: Connection) => {
        if (!conn.source || !conn.target) return true
        const levels = computeLevels(nodes, edges)
        return (levels[conn.target] ?? 0) > (levels[conn.source] ?? 0)
    }, [nodes, edges])

    return (
        <div className="h-screen w-screen bg-gray-950">
            <div className="absolute inset-x-0 top-0 z-10 h-12 border-b border-gray-800 bg-gray-900/80 backdrop-blur flex items-center justify-between px-4">
                <div className="text-yellow-400 font-medium">Workflow Designer</div>
                <div className="flex items-center gap-2">
                    <button onClick={load} className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded">
                        Reload
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); setConfigOpen((v) => !v) }}
                        className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded"
                        title="Layout configuration"
                    >
                        Config
                    </button>
                    <button
                        onClick={saveChanges}
                        disabled={!selectedOrgId || saving}
                        className="px-3 py-1.5 text-sm rounded text-white disabled:opacity-60 disabled:cursor-not-allowed bg-emerald-600 hover:bg-emerald-500"
                    >
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>
            {configOpen && (
                <div className="absolute top-12 right-4 z-20 w-72 rounded border border-gray-800 bg-gray-900/95 backdrop-blur p-3 shadow-lg" onClick={(e) => e.stopPropagation()}>
                    <div className="text-xs text-gray-300 mb-2">Layout config</div>
                    <div className="flex flex-col gap-2 text-xs text-gray-200">
                        <label
                            className="flex items-center justify-between gap-2"
                            title="Horizontal space between columns in pixels. The widest node per level sets the column width; this adds extra space between columns."
                        >
                            <span>Col gap</span>
                            <input
                                type="number"
                                className="w-24 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-right"
                                value={layoutConfig.colGap}
                                onChange={(e) => setLayoutConfig((c) => ({ ...c, colGap: Number(e.target.value) }))}
                            />
                        </label>
                        <label
                            className="flex items-center justify-between gap-2"
                            title="Vertical space between nodes within the same column (pixels). Rows are sized by actual node heights; this adds padding between them."
                        >
                            <span>Row pad</span>
                            <input
                                type="number"
                                className="w-24 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-right"
                                value={layoutConfig.rowPadding}
                                onChange={(e) => setLayoutConfig((c) => ({ ...c, rowPadding: Number(e.target.value) }))}
                            />
                        </label>
                    </div>
                </div>
            )}
            <div className="pt-12 h-full">
                {error ? (
                    <div className="text-red-400 p-3">{error}</div>
                ) : loading ? (
                    <div className="text-gray-400 p-3">Loading…</div>
        ) : (
            <>
                    <ReactFlow
                        nodes={nodes}
                        edges={viewEdges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onNodeDoubleClick={onNodeDoubleClick}
                        onNodeContextMenu={onNodeContextMenu}
                        onConnectStart={onConnectStart}
                        onConnectEnd={onConnectEnd}
                        onConnect={onConnect}
                        isValidConnection={isValidConnection}
                        nodeTypes={nodeTypes}
                        edgeTypes={edgeTypes}
                                     nodesDraggable
                                     elementsSelectable
                                     selectionOnDrag
                        panOnDrag={false}
                        selectionMode={SelectionMode.Partial}
                        multiSelectionKeyCode="Shift"
                        fitView
                    >
                        <Background />
                        <Controls />
                    </ReactFlow>
                    {menuPos && menuTarget && (
                        <div
                className="fixed z-50 bg-gray-800 text-gray-100 border border-gray-700 rounded shadow-md"
                            style={{ left: menuPos.x, top: menuPos.y }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button
                                className="px-3 py-1.5 text-sm w-full text-left hover:bg-gray-700"
                                onClick={deleteMenuTarget}
                            >
                                Delete {menuTarget.kind === 'node' ? 'node' : 'edge'}
                            </button>
                        </div>
                    )}
            </>
                )}
                {saveMsg && (
                    <div className="absolute top-14 right-4 text-xs px-2 py-1 rounded bg-gray-800 text-gray-100 border border-gray-700">
                        {saveMsg}
                    </div>
                )}
            </div>
        </div>
    )
}

export default function WorkflowPage() {
    return (
        <ReactFlowProvider>
            <WorkflowInner />
        </ReactFlowProvider>
    )
}
