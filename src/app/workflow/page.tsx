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
function SideNode(
    props: NodeProps<{
        label?: string
        containerW?: number
        containerH?: number
        hasChildren?: boolean
        expanded?: boolean
        onToggleExpand?: () => void
    }>
)
{
    const { id, data, selected } = props
    const [isEditing, setIsEditing] = useState(false)
    const [value, setValue] = useState<string>(data?.label ?? 'Step')
    const taRef = useRef<HTMLTextAreaElement | null>(null)
    const [editWidth, setEditWidth] = useState<number>(160)

    const measureTextWidth = useCallback((text: string) => {
        // approximate measurement using canvas 2D context to match text-sm
        const canvas = (measureTextWidth as any)._c || document.createElement('canvas')
            ; (measureTextWidth as any)._c = canvas
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
        // signal edit end so outer graph can resume auto-layout
        const endEvt = new CustomEvent('endNodeEdit', { detail: { nodeId: id } })
        window.dispatchEvent(endEvt)
        setIsEditing(false)
    }, [id])

    const cancel = useCallback(() => {
        // signal edit end on cancel as well
        const endEvt = new CustomEvent('endNodeEdit', { detail: { nodeId: id } })
        window.dispatchEvent(endEvt)
        setIsEditing(false)
    }, [id])

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

    const contW = (data as any)?.containerW as number | undefined
    const contH = (data as any)?.containerH as number | undefined
    const headerH = 22

    return (
        <div
            onDoubleClick={requestEdit}
            className={
                'relative rounded-md border ' +
                ((data as any)?.expanded ? 'bg-transparent' : 'bg-white') +
                ' text-gray-900 shadow-sm min-w-32 ' +
                (selected ? 'border-blue-400' : 'border-gray-300')
            }
            style={{
                // Only apply explicit sizing when expanded so the node acts as a container immediately
                width: (data as any)?.expanded && contW ? contW : undefined,
                height: (data as any)?.expanded && contH ? contH : undefined,
            }}
    >
            <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-slate-400" />
            {/* expand/collapse removed */}
            {/* Header/title (always non-transparent) */}
            <div className="relative z-10 flex flex-nowrap items-center gap-2 border-b border-gray-200 px-3 bg-white" style={{ paddingTop: 4, paddingBottom: 4 }}>
                <div className="min-w-0 flex-1">
                    {isEditing ? (
                        <textarea
                            ref={taRef}
                            className="w-full text-sm bg-white text-gray-900 outline-none border border-gray-300 rounded px-1 py-1 resize-none"
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
                                if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
                                    e.preventDefault()
                                    commit(value)
                                }
                                if (e.key === 'Escape') {
                                    e.preventDefault()
                                    cancel()
                                }
                            }}
                            style={{ width: `${editWidth}px`, maxWidth: '100%' }}
                        />
                    ) : (
                        <div className="text-sm whitespace-nowrap overflow-hidden text-ellipsis leading-snug cursor-pointer" onDoubleClick={requestEdit}>
                            {data?.label ?? 'Step'}
                        </div>
                    )}
                </div>
                {/* Expand button only for nodes with children */}
                {(data as any)?.hasChildren ? (
                    <button
                        type="button"
                        className="flex-none ml-2 text-xs px-1.5 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
                        title={(data as any)?.expanded ? 'Collapse' : 'Expand'}
                        onClick={(e) => { e.stopPropagation(); (data as any)?.onToggleExpand?.() }}
                    >
                        {(data as any)?.expanded ? '▾' : '▸'}
                    </button>
                ) : null}
            </div>
            {/* Body area is implicit; children are absolutely positioned within this parent when expanded.
                React Flow renders children nodes separately; they sit above this container due to default z-ordering.
            */}
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
    const nodeSet = new Set(nodes.map((n) => n.id))
    edges.forEach((e) => {
        if (nodeSet.has(e.source) && nodeSet.has(e.target)) {
            incomingCount.set(e.target, (incomingCount.get(e.target) || 0) + 1)
        }
    })
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
            .filter((e) => e.source === u && nodeSet.has(e.target))
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
    const nodeSet = new Set(nodes.map((n) => n.id))
    edges.forEach((e) => {
        if (!nodeSet.has(e.source) || !nodeSet.has(e.target)) return
        if ((levels[e.source] ?? 0) + 1 === (levels[e.target] ?? 0)) {
            const arr = childrenMap.get(e.source)
            if (arr) arr.push(e.target)
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
    const containerW = (n.data as any)?.containerW as number | undefined
    if (measured && measured > 0) return containerW && containerW > measured ? containerW : measured
    if (containerW && containerW > 0) return containerW
    const label = ((n.data as any)?.label as string) ?? ''
    const longestLine = label.split('\n').reduce((m, s) => Math.max(m, s.length), 0)
    const charW = 7.5 // approx for text-sm
    const padding = 24 // px-3 on both sides ~ 12*2
    const minW = 128 // Tailwind min-w-32
    return Math.max(minW, Math.ceil(longestLine * charW + padding))
}

function estimateNodeHeight(n: Node) {
    const measured = (n as any).height as number | undefined
    const containerH = (n.data as any)?.containerH as number | undefined
    if (measured && measured > 0) return containerH && containerH > measured ? containerH : measured
    if (containerH && containerH > 0) return containerH
    const label = ((n.data as any)?.label as string) ?? ''
    const lines = Math.max(1, label.split('\n').length)
    const lineH = 18 // ~1.125rem line-height for text-sm
    const paddingY = 16 // py-2 container + textarea differences
    const minH = 40
    return Math.max(minH, lines * lineH + paddingY)
}

function layout(
    nodesIn: Node[],
    edges: Edge[],
    cfg: LayoutCfg = { baseX: 120, baseY: 120, colGap: 80, rowPadding: 32 },
    expanded: Set<string> = new Set()
) {
    // Helpers: for collapsed nodes, ignore stale measured container sizes
    const collapsedWidth = (n: Node) => {
        const label = ((n.data as any)?.label as string) ?? ''
        const longestLine = label.split('\n').reduce((m, s) => Math.max(m, s.length), 0)
        const charW = 7.5
        const padding = 24
        const minW = 128
        return Math.max(minW, Math.ceil(longestLine * charW + padding))
    }
    const collapsedHeight = (n: Node) => {
        const label = ((n.data as any)?.label as string) ?? ''
        const lines = Math.max(1, label.split('\n').length)
        const lineH = 18
        const paddingY = 16
        const minH = 40
        return Math.max(minH, lines * lineH + paddingY)
    }
    const widthOf = (n: Node) => (expanded.has(n.id) ? estimateNodeWidth(n) : collapsedWidth(n))
    const heightOf = (n: Node) => (expanded.has(n.id) ? estimateNodeHeight(n) : collapsedHeight(n))
    // Use only edges whose endpoints exist in nodesIn to avoid referencing hidden nodes
    const nodeSet = new Set(nodesIn.map((n) => n.id))
    const safeEdges = edges.filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target))
    const levels = computeLevels(nodesIn, safeEdges)
    const byLevel = orderWithinLevels(levels, nodesIn, safeEdges)
    const sortedLevels = Array.from(byLevel.keys()).sort((a, b) => a - b)

    // Build children mapping using nodes' data.parentId (DB parent_step_id)
    const childrenByParent = new Map<string, Node[]>()
    nodesIn.forEach((n) => childrenByParent.set(n.id, []))
    nodesIn.forEach((n) => {
        const pid = (n.data as any)?.parentId as string | null | undefined
        if (pid && childrenByParent.has(pid)) {
            childrenByParent.get(pid)!.push(n)
        }
    })

    // Pre-compute container sizes and child relative positions for expanded parents
    type Cont = { w: number; h: number; childPos: Map<string, { x: number; y: number }>; childIds: Set<string> }
    const container: Map<string, Cont> = new Map()
    const innerPadX = 16, innerPadY = 12, headerH = 22
    const rowGapInside = cfg.rowPadding
    const innerColGap = cfg.colGap
    for (const n of nodesIn) {
        if (!expanded.has(n.id)) continue
        const kids = childrenByParent.get(n.id) || []
        const kidSet = new Set(kids.map((k) => k.id))
        const kidEdges = safeEdges.filter((e) => kidSet.has(e.source) && kidSet.has(e.target))
        const sizes = kids.map((k) => ({ id: k.id, w: estimateNodeWidth(k), h: estimateNodeHeight(k) }))

        let contW: number
        let contH: number
        const childPos = new Map<string, { x: number; y: number }>()

        if (kids.length === 0) {
            // No children: shrink container to its own node size (header only)
            contW = estimateNodeWidth(n)
            contH = estimateNodeHeight(n)
        } else if (kidEdges.length > 0) {
            // Hierarchical layout inside the container using internal edges only
            const levelsKids = computeLevels(kids, kidEdges)
            const byLevelKids = orderWithinLevels(levelsKids, kids, kidEdges)
            const levelKeys = Array.from(byLevelKids.keys()).sort((a, b) => a - b)
            const columnsKids: Node[] [] = levelKeys.map((L) => byLevelKids.get(L) || [])
            const colW = columnsKids.map((arr) => Math.max(1, ...arr.map((x) => sizes.find((s) => s.id === x.id)!.w)))
            const colH = columnsKids.map((arr) => arr.reduce((a, x) => a + sizes.find((s) => s.id === x.id)!.h, 0) + Math.max(0, arr.length - 1) * rowGapInside)
            const innerW = (colW.reduce((a, b) => a + b, 0)) + Math.max(0, columnsKids.length - 1) * innerColGap
            const innerH = Math.max(0, ...colH)
            contW = Math.max(estimateNodeWidth(n), innerPadX * 2 + innerW)
            // add a rowPadding gap under the header as requested
            contH = Math.max(estimateNodeHeight(n), headerH + cfg.rowPadding + innerH + innerPadY)

            // Compute x origin per column, centered within available inner width
            const availableInnerW = Math.max(0, contW - innerPadX * 2)
            const leftPad = innerPadX + Math.max(0, (availableInnerW - innerW) / 2)
            const colX: number[] = []
            let runX = leftPad
            for (let i = 0; i < columnsKids.length; i++) {
                colX[i] = runX
                runX += colW[i] + innerColGap
            }
            // Place nodes within columns, vertically centered inside content area
            for (let i = 0; i < columnsKids.length; i++) {
                const arr = columnsKids[i]
                const startY = headerH + cfg.rowPadding + Math.max(0, (innerH - colH[i]) / 2)
                let y = startY
                for (const node of arr) {
                    const s = sizes.find((x) => x.id === node.id)!
                    const x = colX[i] + Math.max(0, (colW[i] - s.w) / 2)
                    childPos.set(node.id, { x, y })
                    y += s.h + rowGapInside
                }
            }
        } else {
            // Fallback: simple vertical stack centered
            const maxChildW = Math.max(...sizes.map((s) => s.w))
            const childrenTotalH = sizes.reduce((a, s) => a + s.h, 0) + Math.max(0, sizes.length - 1) * rowGapInside
            contW = Math.max(estimateNodeWidth(n), maxChildW + innerPadX * 2)
            // add a rowPadding gap under the header for the fallback too
            contH = Math.max(estimateNodeHeight(n), headerH + cfg.rowPadding + childrenTotalH + innerPadY)
            let cy = headerH + cfg.rowPadding
            for (const s of sizes) {
                const cx = innerPadX + Math.max(0, (contW - 2 * innerPadX - s.w) / 2)
                childPos.set(s.id, { x: cx, y: cy })
                cy += s.h + rowGapInside
            }
    }
    container.set(n.id, { w: contW, h: contH, childPos, childIds: new Set(kids.map((k) => k.id)) })
    }

    // Build columns from level ordering, then remove any contained children of expanded parents from whatever column they appear in
    const columns: Node[][] = Array.from(byLevel.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, arr]) => [...arr])
    if (expanded.size) {
        const childrenIds = new Set<string>()
        nodesIn.forEach((n) => {
            if (!expanded.has(n.id)) return
            const kids = childrenByParent.get(n.id) || []
            kids.forEach((k) => childrenIds.add(k.id))
        })
        if (childrenIds.size) {
            for (let i = 0; i < columns.length; i++) {
                columns[i] = columns[i].filter((n) => !childrenIds.has(n.id))
            }
        }
    }

    // Determine max width per produced column
    const colMaxWidth: number[] = columns.map((arr) => Math.max(1, ...arr.map((n) => {
        const cont = container.get(n.id)
        return cont ? Math.max(widthOf(n), cont.w) : widthOf(n)
    })))
    // Compute x positions cumulatively
    const colX: number[] = []
    let runningX = cfg.baseX
    for (let i = 0; i < columns.length; i++) {
        colX[i] = runningX
        runningX = runningX + (colMaxWidth[i] || 0) + cfg.colGap
    }

    // For each column, stack nodes centered vertically; center nodes within column width
    const positioned = nodesIn.map((n) => ({ ...n }))
    const nodeIndex = new Map<string, number>()
    columns.forEach((arr, colIdx) => {
        const heights = arr.map((n) => heightOf(n))
        const totalHeight = heights.reduce((a, b) => a + b, 0) + Math.max(0, arr.length - 1) * cfg.rowPadding
        let cursorY = cfg.baseY - totalHeight / 2
        const colW = colMaxWidth[colIdx] || 0
        arr.forEach((n, i) => {
            nodeIndex.set(n.id, i)
            const cont = container.get(n.id)
            const estimatedW = cont ? Math.max(widthOf(n), cont.w) : widthOf(n)
            const left = (colX[colIdx] || cfg.baseX) + Math.max(0, (colW - estimatedW) / 2)
            const y = cursorY
            const h = cont ? Math.max(heightOf(n), cont.h) : heights[i]
            cursorY += h + cfg.rowPadding
            const idx = positioned.findIndex((p) => p.id === n.id)
            if (idx >= 0) {
                // apply container sizes when expanded
                const data = cont ? { ...(positioned[idx].data as any), containerW: cont.w, containerH: cont.h } : positioned[idx].data
                positioned[idx] = { ...positioned[idx], position: { x: left, y }, data }
                // If this node is a container, assign child relative positions and parentNode to children
                if (cont) {
                    cont.childPos.forEach((pos, childId) => {
                        const cidx = positioned.findIndex((p) => p.id === childId)
                        if (cidx >= 0) positioned[cidx] = { ...positioned[cidx], position: { x: pos.x, y: pos.y }, parentNode: n.id, extent: 'parent' as any }
                    })
                }
            }
        })
    })
    // Clear parentNode for nodes that are not inside any container
    const allContained = new Set<string>()
    container.forEach((c) => c.childIds.forEach((id) => allContained.add(id)))
    for (let i = 0; i < positioned.length; i++) {
        const p = positioned[i] as any
        // If a node is already marked as a contained child (extent='parent'), keep it contained
        if (p?.parentNode && p?.extent === 'parent') continue
        if (!allContained.has(p.id) && p?.parentNode) {
            const { parentNode, extent, ...rest } = p
            positioned[i] = rest
        }
    }
    return { nodes: positioned, levels, nodeIndex }
}

// Compute which nodes are visible based on expand/collapse state.
// Rule: roots (no parents) are always visible; a node becomes visible if it is reachable from a visible node
// through a chain of edges where each source node along the path is expanded. This supports multi-parents:
// a node is visible if there exists at least one expanded path to it.
function computeVisibleNodeIds(nodes: Node[], expanded: Set<string>): Set<string> {
    // Build parent/children maps from nodes' data.parentId (process_step.parent_step_id)
    const parentByChild = new Map<string, string | null>()
    const childrenByParent = new Map<string, string[]>()
    nodes.forEach((n) => {
        const pid = (n.data as any)?.parentId as string | null | undefined
        parentByChild.set(n.id, pid ?? null)
        if (!childrenByParent.has(n.id)) childrenByParent.set(n.id, [])
    })
    nodes.forEach((n) => {
        const pid = (n.data as any)?.parentId as string | null | undefined
        if (pid) {
            if (!childrenByParent.has(pid)) childrenByParent.set(pid, [])
            childrenByParent.get(pid)!.push(n.id)
        }
    })

    const roots = nodes.filter((n) => !parentByChild.get(n.id)).map((n) => n.id)
    const visible = new Set<string>(roots)
    const q: string[] = [...roots]
    while (q.length) {
        const p = q.shift()!
        const kids = childrenByParent.get(p) || []
        // Only propagate visibility through expanded parents
        if (!expanded.has(p)) continue
        for (const c of kids) {
            if (!visible.has(c)) {
                visible.add(c)
                q.push(c)
            }
        }
    }
    return visible
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
    // Track expanded container nodes
    const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set())
    const [configOpen, setConfigOpen] = useState(false)
    // Re-enable auto-layout; it will pause while editing
    const AUTO_LAYOUT = true

    // Restore expanded containers from localStorage (so expansions persist until collapsed)
    useEffect(() => {
        try {
            const raw = localStorage.getItem('workflow.expanded')
            if (raw) {
                const arr: string[] = JSON.parse(raw)
                if (Array.isArray(arr)) setExpandedNodeIds(new Set(arr))
            }
        } catch {}
    }, [])

    // Persist expanded containers
    useEffect(() => {
        try {
            localStorage.setItem('workflow.expanded', JSON.stringify(Array.from(expandedNodeIds)))
        } catch {}
    }, [expandedNodeIds])

    // Centralized relayout using current state
    const relayoutNow = useCallback(() => {
        if (!AUTO_LAYOUT) return
        if (editingNodeId || isEditingEdge) return
        const visible = computeVisibleNodeIds(nodes, expandedNodeIds)
        const useNodes = nodes.filter((n) => visible.has(n.id))
        const useEdges = edges.filter((e) => visible.has(e.source) && visible.has(e.target))
        const { nodes: laid } = layout(useNodes, useEdges, layoutConfig, expandedNodeIds)
        const laidMap = new Map(laid.map((n) => [n.id, n]))
        setNodes((prev) => prev.map((n) => {
            const laidN = laidMap.get(n.id)
            const isVisible = visible.has(n.id)
            // For non-expanded nodes, strip any stale container sizing so width estimates are correct
            const isExpanded = expandedNodeIds.has(n.id)
            let nextData: any = (laidN?.data ?? n.data) as any
            if (!isExpanded && nextData) {
                const { containerW, containerH, ...rest } = nextData
                nextData = rest
            }
            if (isVisible) {
                return { ...n, ...(laidN || {}), data: nextData, hidden: false }
            }
            return { ...n, hidden: true, parentNode: undefined, extent: undefined as any, data: nextData }
        }))
        setEdges((prev) => prev.map((e) => ({ ...e, hidden: !(visible.has(e.source) && visible.has(e.target)) })))
    }, [AUTO_LAYOUT, nodes, edges, layoutConfig, expandedNodeIds, editingNodeId, isEditingEdge, setNodes, setEdges])

    // Track nodes under JS-driven tween to disable CSS transitions
    const animatingIdsRef = useRef<Set<string>>(new Set())

    // Animate nodes to new layout positions so edges move together during interpolation
    const animateToLayout = useCallback((laid: Node[], duration = 300) => {
        const idToTarget = new Map<string, { x: number; y: number }>()
        laid.forEach((n) => idToTarget.set(n.id, { x: n.position.x, y: n.position.y }))
        const idToStart = new Map<string, { x: number; y: number }>()
        nodes.forEach((n) => {
            const t = idToTarget.get(n.id)
            if (t) idToStart.set(n.id, { x: n.position.x, y: n.position.y })
        })
        // Figure which nodes actually move
        const moving = new Set<string>()
        idToStart.forEach((s, id) => {
            const t = idToTarget.get(id)!
            const dx = t.x - s.x, dy = t.y - s.y
            if (Math.hypot(dx, dy) > 0.5) moving.add(id)
        })
        if (moving.size === 0) {
            // Nothing moves; just commit final
            const laidMap = new Map(laid.map((n) => [n.id, n]))
            setNodes((prev) => prev.map((n) => ({ ...n, ...(laidMap.get(n.id) || {}), hidden: false })))
            return
        }
        animatingIdsRef.current = moving
        // Add no-transition class to animated nodes
        setNodes((prev) => prev.map((n) => (
            moving.has(n.id)
                ? { ...n, className: [n.className, 'no-transition'].filter(Boolean).join(' ') }
                : n
        )))
        const easeOut = (t: number) => 1 - (1 - t) * (1 - t)
        const start = performance.now()
        const step = (now: number) => {
            const p = Math.min(1, (now - start) / duration)
            const e = easeOut(p)
            setNodes((prev) => prev.map((n) => {
                const s = idToStart.get(n.id)
                const t = idToTarget.get(n.id)
                if (!s || !t) return n
                const nx = s.x + (t.x - s.x) * e
                const ny = s.y + (t.y - s.y) * e
                return { ...n, position: { x: nx, y: ny }, hidden: false }
            }))
            if (p < 1) requestAnimationFrame(step)
            else {
                // Commit the full laid nodes (includes container sizing, parentNode, etc.) and remove no-transition
                const laidMap = new Map(laid.map((n) => [n.id, n]))
                setNodes((prev) => prev.map((n) => {
                    const l = laidMap.get(n.id)
                    if (!l) return n
                    const cls = (n.className || '').split(' ').filter((c) => c && c !== 'no-transition').join(' ')
                    return { ...n, ...l, className: cls, hidden: false }
                }))
                animatingIdsRef.current = new Set()
            }
        }
        requestAnimationFrame(step)
    }, [nodes, setNodes])

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
    const snapshotRef = useRef<{ nodeName: Record<string, string>; nodeParentId: Record<string, string | null>; edgeLabel: Record<string, string> }>(
        { nodeName: {}, nodeParentId: {}, edgeLabel: {} }
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
                .is('parent_step_id', null)
            if (sErr) throw sErr
            const { data: flows, error: fErr } = await supabase
                .from('process_flow_edge')
                .select('id, from_step_id, to_step_id, label, metadata')
                .eq('organisation_id', selectedOrgId)
            if (fErr) throw fErr

            const rfNodes: Node[] = (steps || []).map((s: any) => ({
                id: String(s.id),
                data: { label: s.name || 'Step', parentId: s.parent_step_id ? String(s.parent_step_id) : null },
                position: { x: 0, y: 0 },
                type: 'side',
            }))
            // Determine which fetched nodes have children
            const rootIds = rfNodes.map((n) => n.id)
            if (rootIds.length) {
                const { data: childRows, error: cErr } = await supabase
                    .from('process_step')
                    .select('parent_step_id')
                    .eq('organisation_id', selectedOrgId)
                    .in('parent_step_id', rootIds)
                if (cErr) throw cErr
                const hasChildSet = new Set<string>((childRows || []).map((r: any) => String(r.parent_step_id)))
                rfNodes.forEach((n) => {
                    (n.data as any).hasChildren = hasChildSet.has(n.id)
                })
            }
            const rfEdgesAll: Edge[] = (flows || []).map((e: any) => ({
                id: String(e.id),
                source: String(e.from_step_id),
                target: String(e.to_step_id),
                type: 'editableLabel',
                data: { label: e.label || '' },
            }))
            // Only keep edges whose endpoints are present in the fetched nodes
            const nodeIdSet = new Set(rfNodes.map((n) => n.id))
            const rfEdges: Edge[] = rfEdgesAll.filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
            // Layout only visible nodes (respect expanded containers) and hide others
            const visible = computeVisibleNodeIds(rfNodes, expandedNodeIds)
            const rfNodesForLayout = rfNodes.filter((n) => visible.has(n.id))
            const rfEdgesForLayout = rfEdges.filter((e) => visible.has(e.source) && visible.has(e.target))
            const { nodes: laid } = layout(rfNodesForLayout, rfEdgesForLayout, layoutConfig, expandedNodeIds)
            const laidMap = new Map(laid.map((n) => [n.id, n]))
            const nextNodes = rfNodes.map((n) => {
                if (!visible.has(n.id)) return { ...n, hidden: true, parentNode: undefined, extent: undefined as any }
                return { ...n, ...(laidMap.get(n.id) || {}), hidden: false }
            })
            const nextEdges = rfEdges.map((e) => ({ ...e, hidden: !(visible.has(e.source) && visible.has(e.target)) }))
            setNodes(nextNodes)
            setEdges(nextEdges)
            // refresh snapshot
            const nodeName: Record<string, string> = {}
            const nodeParentId: Record<string, string | null> = {}
            nextNodes.forEach((n) => {
                nodeName[n.id] = (n.data as any)?.label ?? ''
                nodeParentId[n.id] = ((n.data as any)?.parentId as string | null | undefined) ?? null
            })
            const edgeLabel: Record<string, string> = {}
            nextEdges.forEach((e) => (edgeLabel[e.id] = ((e as any).data?.label as string) ?? ''))
            snapshotRef.current = { nodeName, nodeParentId, edgeLabel }
        } catch (err: any) {
            setError(err?.message || 'Failed to load processes')
            setNodes([])
            setEdges([])
        } finally {
            setLoading(false)
        }
    }, [selectedOrgId])

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
        const visible = computeVisibleNodeIds(nodes, expandedNodeIds)
        const useNodes = nodes.filter((n) => visible.has(n.id))
        const useEdges = edges.filter((e) => visible.has(e.source) && visible.has(e.target))
        const { nodes: laid } = layout(useNodes, useEdges, layoutConfig, expandedNodeIds)
        const laidMap = new Map(laid.map((n) => [n.id, n]))
        setNodes((prev) => prev.map((n) => {
            const laidN = laidMap.get(n.id)
            const isVisible = visible.has(n.id)
            const isExpanded = expandedNodeIds.has(n.id)
            let nextData: any = (laidN?.data ?? n.data) as any
            if (!isExpanded && nextData) {
                const { containerW, containerH, ...rest } = nextData
                nextData = rest
            }
            if (isVisible) return { ...n, ...(laidN || {}), data: nextData, hidden: false }
            return { ...n, hidden: true, parentNode: undefined, extent: undefined as any, data: nextData }
        }))
        setEdges((prev) => prev.map((e) => ({ ...e, hidden: !(visible.has(e.source) && visible.has(e.target)) })))
    }, [structureKey, editingNodeId, isEditingEdge, layoutConfig, expandedNodeIds])

    useEffect(() => {
        // Re-run layout once widths are known
        if (!AUTO_LAYOUT) return
        if (editingNodeId || isEditingEdge) return
        const visible = computeVisibleNodeIds(nodes, expandedNodeIds)
        const useNodes = nodes.filter((n) => visible.has(n.id))
        const useEdges = edges.filter((e) => visible.has(e.source) && visible.has(e.target))
        const { nodes: laid } = layout(useNodes, useEdges, layoutConfig, expandedNodeIds)
        const laidMap = new Map(laid.map((n) => [n.id, n]))
        setNodes((prev) => prev.map((n) => {
            const laidN = laidMap.get(n.id)
            const isVisible = visible.has(n.id)
            const isExpanded = expandedNodeIds.has(n.id)
            let nextData: any = (laidN?.data ?? n.data) as any
            if (!isExpanded && nextData) {
                const { containerW, containerH, ...rest } = nextData
                nextData = rest
            }
            if (isVisible) return { ...n, ...(laidN || {}), data: nextData, hidden: false }
            return { ...n, hidden: true, parentNode: undefined, extent: undefined as any, data: nextData }
        }))
        setEdges((prev) => prev.map((e) => ({ ...e, hidden: !(visible.has(e.source) && visible.has(e.target)) })))
    }, [widthKey, editingNodeId, isEditingEdge, layoutConfig, expandedNodeIds])

    useEffect(() => {
        if (!AUTO_LAYOUT) return
        if (editingNodeId || isEditingEdge) return
        const visible = computeVisibleNodeIds(nodes, expandedNodeIds)
        const useNodes = nodes.filter((n) => visible.has(n.id))
        const useEdges = edges.filter((e) => visible.has(e.source) && visible.has(e.target))
        const { nodes: laid } = layout(useNodes, useEdges, layoutConfig, expandedNodeIds)
        const laidMap = new Map(laid.map((n) => [n.id, n]))
        setNodes((prev) => prev.map((n) => {
            const laidN = laidMap.get(n.id)
            const isVisible = visible.has(n.id)
            const isExpanded = expandedNodeIds.has(n.id)
            let nextData: any = (laidN?.data ?? n.data) as any
            if (!isExpanded && nextData) {
                const { containerW, containerH, ...rest } = nextData
                nextData = rest
            }
            if (isVisible) return { ...n, ...(laidN || {}), data: nextData, hidden: false }
            return { ...n, hidden: true, parentNode: undefined, extent: undefined as any, data: nextData }
        }))
        setEdges((prev) => prev.map((e) => ({ ...e, hidden: !(visible.has(e.source) && visible.has(e.target)) })))
    }, [heightKey, editingNodeId, isEditingEdge, layoutConfig, expandedNodeIds])

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

        const handleEndEdit = (e: Event) => {
            const detail = (e as CustomEvent).detail as { nodeId: string }
            if (!detail?.nodeId) return
            if (editingNodeId === detail.nodeId) setEditingNodeId(null)
        }

        window.addEventListener('updateNodeLabel', handleUpdate as any)
        window.addEventListener('startNodeEdit', handleStartEdit as any)
        window.addEventListener('endNodeEdit', handleEndEdit as any)
        return () => {
            window.removeEventListener('updateNodeLabel', handleUpdate as any)
            window.removeEventListener('startNodeEdit', handleStartEdit as any)
            window.removeEventListener('endNodeEdit', handleEndEdit as any)
        }
    }, [setNodes, editingNodeId])

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
        // Determine if a container is selected; if so, hide all edges except:
        // 1) edges connected directly to the selected container
        // 2) edges fully internal to that container (between its children)
        const selectedContainerId = nodes.find((n) => n.selected && expandedNodeIds.has(n.id))?.id || null
        const insideSelected = new Set<string>()
        if (selectedContainerId) {
            nodes.forEach((n) => {
                const pid = (n.data as any)?.parentId as string | null | undefined
                if (pid === selectedContainerId || n.id === selectedContainerId) insideSelected.add(n.id)
            })
        }
        return edges.map((e) => {
            const base: Edge = {
                ...e,
                type: 'editableLabel',
                data: { ...(e as any).data, label: (e as any).data?.label ?? (e as any).label ?? '', onLabelCommit: onEdgeLabelCommit, onEditingChange: onEdgeEditingChange, onOpenContextMenu: onOpenEdgeMenu },
            }
            if (!selectedContainerId) return base
            const sIn = insideSelected.has(e.source)
            const tIn = insideSelected.has(e.target)
            const isConnectedToContainer = e.source === selectedContainerId || e.target === selectedContainerId
            const isInternal = sIn && tIn
            const visible = isConnectedToContainer || isInternal
            return { ...base, hidden: !visible }
        }) as Edge[]
    }, [edges, nodes, expandedNodeIds, onEdgeLabelCommit, onEdgeEditingChange, onOpenEdgeMenu])

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
                const next = addEdge({ id: edgeId, ...connection, type: 'editableLabel', data: { label: '' } } as any, eds)
                return next
            })
            setDidConnect(true)
            // animate to new layout shortly after to reflect new edge
            setTimeout(() => {
                const visible = computeVisibleNodeIds(nodes, expandedNodeIds)
                const useNodes = nodes.filter((n) => visible.has(n.id))
                const useEdges = edges.filter((e) => visible.has(e.source) && visible.has(e.target))
                const { nodes: laid } = layout(useNodes, useEdges, layoutConfig, expandedNodeIds)
                animateToLayout(laid, 220)
            }, 0)
        },
        [setEdges, nodes, edges, layoutConfig, expandedNodeIds, animateToLayout]
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
            // Determine the parent process for the new subprocess: if the source is inside a container,
            // use its parent process; otherwise use the source itself (creating a child of a root)
            const srcNode = connectingFromId ? rf.getNode(connectingFromId) : null
            const parentPid = (srcNode?.data as any)?.parentId ?? srcNode?.id ?? connectingFromId
            const newId = generateUuid()
            const newNode: Node = {
                id: newId,
                type: 'side',
                // Make this a child subprocess of the parent process
                data: { label: 'New Step', parentId: parentPid },
                position: pos,
            }
            const newEdge: Edge = { id: generateUuid(), source: connectingFromId, target: newId, type: 'editableLabel', data: { label: '' } } as any
            setNodes((nds) => nds.concat(newNode))
            setEdges((eds) => eds.concat(newEdge))
            // Fit the view to the parent group's region
            setTimeout(() => {
                try {
                    const all = rf.getNodes()
                    const group = all.filter((n) => n.id === parentPid || (n.data as any)?.parentId === parentPid)
                    if (group.length) rf.fitView({ nodes: group, padding: 0.15, duration: 300 })
                } catch {}
                const { nodes: laid } = layout(rf.getNodes(), rf.getEdges(), layoutConfig, expandedNodeIds)
                animateToLayout(laid, 260)
            }, 0)
            setConnectingFromId(null)
            setDidConnect(false)
        },
        [connectingFromId, didConnect, rf, setNodes, setEdges, layoutConfig, expandedNodeIds, animateToLayout]
    )

    // removed addChild function per request

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
                    ids.forEach((id) => { delete snap.nodeName[id]; delete snap.nodeParentId[id] })
                    deletedNodeIdsRef.current.clear()
                }
            }

            // New/updated nodes
            const nodeRows: { id: string; organisation_id: string; name: string; parent_step_id: string | null }[] = nodes.map((n: any) => ({
                id: n.id,
                organisation_id: selectedOrgId,
                name: (n.data?.label as string) ?? '',
                parent_step_id: (n.data?.parentId as string | null | undefined) ?? null,
            }))
            const newNodes = nodeRows.filter((r) => snap.nodeName[r.id] === undefined)
            const changedNodes = nodeRows.filter((r) => {
                if (snap.nodeName[r.id] === undefined) return false
                const nameChanged = snap.nodeName[r.id] !== r.name
                const parentChanged = (snap.nodeParentId[r.id] ?? null) !== (r.parent_step_id ?? null)
                return nameChanged || parentChanged
            })

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
            const nodeParentId: Record<string, string | null> = {}
            nodes.forEach((n: any) => {
                nodeName[n.id] = (n.data?.label as string) ?? ''
                nodeParentId[n.id] = (n.data?.parentId as string | null | undefined) ?? null
            })
            const edgeLabel: Record<string, string> = {}
            edges.forEach((e: any) => (edgeLabel[e.id] = (e.data?.label as string) ?? (e.label as string) ?? ''))
            snapshotRef.current = { nodeName, nodeParentId, edgeLabel }

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

    // Toggle expand and lazy-load children for that parent
    const toggleExpand = useCallback(async (nodeId: string) => {
        // Determine if this action is a collapse or expand
        const wasExpanded = expandedNodeIds.has(nodeId)
        const nextExpanded = new Set(expandedNodeIds)
        if (wasExpanded) nextExpanded.delete(nodeId)
        else nextExpanded.add(nodeId)
        setExpandedNodeIds(nextExpanded)

        // If collapsing: strip container sizing immediately and animate to new layout
        if (wasExpanded) {
            // Remove containerW/H so parent shrinks back to its intrinsic size
            setNodes((nds) => nds.map((n) => {
                if (n.id !== nodeId) return n
                const d: any = n.data || {}
                const { containerW, containerH, ...rest } = d
                return { ...n, data: rest }
            }))
            // Compute visibility and animate to new layout using the next expanded set.
            // Important: sanitize nodes for layout so collapsed nodes do not keep stale container sizes.
            const sanitized = nodes.map((n) => {
                if (nextExpanded.has(n.id)) return n
                const d: any = n.data || {}
                const { containerW, containerH, ...rest } = d
                return { ...n, data: rest }
            })
            const visible = computeVisibleNodeIds(sanitized, nextExpanded)
            const useNodes = sanitized.filter((n) => visible.has(n.id))
            const useEdges = edges.filter((e) => visible.has(e.source) && visible.has(e.target))
            const { nodes: laid } = layout(useNodes, useEdges, layoutConfig, nextExpanded)
            animateToLayout(laid, 260)
            return
        }

        // If expanding and children are not in state yet, fetch direct children and any edges among them
        const parentInState = nodes.find((n) => n.id === nodeId)
        if (!parentInState) return
        const alreadyHasChildren = nodes.some((n) => (n.data as any)?.parentId === nodeId)
        if (alreadyHasChildren) return

        try {
            const { data: childSteps, error: cErr } = await supabase
                .from('process_step')
                .select('id, name, description, metadata, parent_step_id')
                .eq('organisation_id', selectedOrgId as string)
                .eq('parent_step_id', nodeId)
            if (cErr) throw cErr

            const childNodesRaw: Node[] = (childSteps || []).map((s: any) => ({
                id: String(s.id),
                data: { label: s.name || 'Step', parentId: s.parent_step_id ? String(s.parent_step_id) : null },
                // positions will be set after sizing computation
                position: { x: 0, y: 0 },
                type: 'side',
            }))

            // Annotate each child with hasChildren flag
            if (childNodesRaw.length) {
                const { data: grandRows, error: gErr } = await supabase
                    .from('process_step')
                    .select('parent_step_id')
                    .eq('organisation_id', selectedOrgId as string)
                    .in('parent_step_id', childNodesRaw.map((n) => n.id))
                if (gErr) throw gErr
                const hasChildSet = new Set<string>((grandRows || []).map((r: any) => String(r.parent_step_id)))
                childNodesRaw.forEach((n) => ((n.data as any).hasChildren = hasChildSet.has(n.id)))
            }

            // Fetch edges whose endpoints are in the union of existing nodes + new child nodes (for rendering)
            const currentIds = new Set(nodes.map((n) => n.id))
            const allIds = [...new Set([...Array.from(currentIds), ...childNodesRaw.map((n) => n.id)])]
            let newEdges: Edge[] = []
            if (allIds.length) {
                const { data: edgeRows, error: eErr } = await supabase
                    .from('process_flow_edge')
                    .select('id, from_step_id, to_step_id, label, metadata')
                    .eq('organisation_id', selectedOrgId as string)
                    .in('from_step_id', allIds)
                    .in('to_step_id', allIds)
                if (eErr) throw eErr
                newEdges = (edgeRows || []).map((e: any) => ({
                    id: String(e.id),
                    source: String(e.from_step_id),
                    target: String(e.to_step_id),
                    type: 'editableLabel',
                    data: { label: e.label || '' },
                }))
            }

            // Compute immediate container sizing and child positions using internal edges (if any) to reduce jumps
            const parentNode = nodes.find((n) => n.id === nodeId)
            const innerPadX = 16, innerPadY = 12, headerH = 22
            const rowGapInside = layoutConfig.rowPadding
            const innerColGap = layoutConfig.colGap
            const sizes = childNodesRaw.map((k) => ({ id: k.id, w: estimateNodeWidth(k), h: estimateNodeHeight(k) }))
            const childIdSet = new Set(childNodesRaw.map((n) => n.id))
            const internalEdges = newEdges.filter((e) => childIdSet.has(e.source) && childIdSet.has(e.target))

            let contW = parentNode ? estimateNodeWidth(parentNode) : 160
            let contH = parentNode ? estimateNodeHeight(parentNode) : 48
            let childNodes: Node[] = []

            if (internalEdges.length > 0) {
                // Hierarchical inside container
                const levelsKids = computeLevels(childNodesRaw, internalEdges)
                const byLevelKids = orderWithinLevels(levelsKids, childNodesRaw, internalEdges)
                const levelKeys = Array.from(byLevelKids.keys()).sort((a, b) => a - b)
                const columnsKids: Node[][] = levelKeys.map((L) => byLevelKids.get(L) || [])
                const colW = columnsKids.map((arr) => Math.max(1, ...arr.map((x) => sizes.find((s) => s.id === x.id)!.w)))
                const colH = columnsKids.map((arr) => arr.reduce((a, x) => a + sizes.find((s) => s.id === x.id)!.h, 0) + Math.max(0, arr.length - 1) * rowGapInside)
                const innerW = (colW.reduce((a, b) => a + b, 0)) + Math.max(0, columnsKids.length - 1) * innerColGap
                const innerH = Math.max(0, ...colH)
                contW = Math.max(contW, innerPadX * 2 + innerW)
                // Add rowPadding gap under the header during expand pre-sizing
                contH = Math.max(contH, headerH + layoutConfig.rowPadding + innerH + innerPadY)
                // x per column
                const colX: number[] = []
                let runX = innerPadX
                for (let i = 0; i < columnsKids.length; i++) { colX[i] = runX; runX += colW[i] + innerColGap }
                // place nodes
                const childPos = new Map<string, { x: number; y: number }>()
                for (let i = 0; i < columnsKids.length; i++) {
                    const arr = columnsKids[i]
                    let y = headerH + layoutConfig.rowPadding
                    for (const node of arr) {
                        const s = sizes.find((x) => x.id === node.id)!
                        const x = colX[i] + Math.max(0, (colW[i] - s.w) / 2)
                        childPos.set(node.id, { x, y })
                        y += s.h + rowGapInside
                    }
                }
                childNodes = childNodesRaw.map((c) => ({ ...c, position: childPos.get(c.id)!, parentNode: nodeId, extent: 'parent' as any }))
            } else {
                // Vertical fallback
                const maxChildW = sizes.length ? Math.max(...sizes.map((s) => s.w)) : 0
                const childrenTotalH = sizes.reduce((a, s) => a + s.h, 0) + Math.max(0, sizes.length - 1) * rowGapInside
                contW = Math.max(contW, maxChildW + innerPadX * 2)
                contH = Math.max(contH, headerH + layoutConfig.rowPadding + childrenTotalH + innerPadY)
                let cy = headerH + layoutConfig.rowPadding
                childNodes = childNodesRaw.map((c) => {
                    const s = sizes.find((x) => x.id === c.id)!
                    const cx = innerPadX + Math.max(0, (contW - 2 * innerPadX - s.w) / 2)
                    const node: Node = { ...c, position: { x: cx, y: cy }, parentNode: nodeId, extent: 'parent' as any }
                    cy += s.h + rowGapInside
                    return node
                })
            }

            // 1) Set parent size first so React Flow measures container correctly
            setNodes((nds) => nds.map((n) => (
                n.id === nodeId ? { ...n, data: { ...(n.data as any), containerW: contW, containerH: contH } } : n
            )))
            // Wait one frame to allow measurement
            await new Promise((r) => requestAnimationFrame(() => r(null)))
            // 2) Insert children (already positioned relative) and edges
            setNodes((nds) => {
                const exist = new Set(nds.map((n) => n.id))
                return nds.concat(childNodes.filter((n) => !exist.has(n.id)))
            })
            setEdges((eds) => {
                const exist = new Set(eds.map((e) => e.id))
                // Only add fetched edges; no virtual edges are generated
                return eds.concat(newEdges.filter((e) => !exist.has(e.id)))
            })
            // Fit view to the group (parent + its children)
            try {
                const all = rf.getNodes()
                const group = all.filter((n) => n.id === nodeId || (n.data as any)?.parentId === nodeId)
                if (group.length) rf.fitView({ nodes: group, padding: 0.15, duration: 300 })
            } catch {}
            // Animate to final layout after insertion (expand). Use up-to-date expanded set.
            {
                // Sanitize for layout: only expanded nodes should have container sizes considered.
                const current = rf.getNodes().map((n) => {
                    if (nextExpanded.has(n.id)) return n
                    const d: any = n.data || {}
                    const { containerW, containerH, ...rest } = d
                    return { ...n, data: rest }
                })
                const visible = computeVisibleNodeIds(current, nextExpanded)
                const useNodes = current.filter((n) => visible.has(n.id))
                const useEdges = rf.getEdges().filter((e) => visible.has(e.source) && visible.has(e.target))
                const { nodes: laid } = layout(useNodes, useEdges, layoutConfig, nextExpanded)
                animateToLayout(laid, 260)
            }
        } catch (err) {
            console.error('Expand load failed', err)
        }
    }, [nodes, edges, selectedOrgId, setNodes, setEdges, rf, layoutConfig, expandedNodeIds, animateToLayout])

    const viewNodes = useMemo(() => {
        const visible = computeVisibleNodeIds(nodes, expandedNodeIds)
        const expanded = expandedNodeIds
        // Build quick lookup of parent->children
        const childrenByParent = new Map<string, string[]>()
        nodes.forEach((n) => {
            const pid = (n.data as any)?.parentId as string | null | undefined
            if (!pid) return
            if (!childrenByParent.has(pid)) childrenByParent.set(pid, [])
            childrenByParent.get(pid)!.push(n.id)
        })
        const contained = new Set<string>()
        expanded.forEach((pid) => (childrenByParent.get(pid) || []).forEach((id) => contained.add(id)))
        return nodes.map((n) => {
            const isContainer = expanded.has(n.id)
            const isChildOfExpanded = contained.has(n.id)
            const common = {
                hidden: !visible.has(n.id),
            }
            if (!visible.has(n.id)) {
                return {
                    ...n,
                    ...common,
                    parentNode: undefined,
                    extent: undefined as any,
                    data: { ...(n.data as any), expanded: isContainer, onToggleExpand: () => toggleExpand(n.id) },
                }
            }
            return {
                ...n,
                ...common,
                parentNode: isChildOfExpanded ? (n.data as any)?.parentId : n.parentNode,
                extent: isChildOfExpanded ? ('parent' as any) : n.extent,
                data: { ...(n.data as any), expanded: isContainer, onToggleExpand: () => toggleExpand(n.id) },
            }
        })
    }, [nodes, expandedNodeIds, toggleExpand])

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
                            nodes={viewNodes}
                            edges={viewEdges}
                            onNodesChange={(changes) => {
                                onNodesChange(changes)
                                if (changes.some((c: any) => c.type === 'position' && c.dragging === false)) {
                                    setTimeout(() => {
                                        const visible = computeVisibleNodeIds(nodes, expandedNodeIds)
                                        const useNodes = nodes.filter((n) => visible.has(n.id))
                                        const useEdges = edges.filter((e) => visible.has(e.source) && visible.has(e.target))
                                        const { nodes: laid } = layout(useNodes, useEdges, layoutConfig, expandedNodeIds)
                                        animateToLayout(laid, 280)
                                    }, 0)
                                }
                            }}
                            onEdgesChange={(changes) => {
                                onEdgesChange(changes)
                                if (changes.length) {
                                    const visible = computeVisibleNodeIds(nodes, expandedNodeIds)
                                    const useNodes = nodes.filter((n) => visible.has(n.id))
                                    const useEdges = edges.filter((e) => visible.has(e.source) && visible.has(e.target))
                                    const { nodes: laid } = layout(useNodes, useEdges, layoutConfig, expandedNodeIds)
                                    animateToLayout(laid, 220)
                                }
                            }}
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
                                {/* removed Add child action */}
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
