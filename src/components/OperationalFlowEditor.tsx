'use client'

import React from 'react'
import ReactFlow, {
    Controls,
    MiniMap,
    Connection,
    Edge as RFEdge,
    EdgeProps,
    MarkerType,
    Node as RFNode,
    NodeProps,
    BaseEdge,
    ConnectionLineType,
    addEdge,
    useEdgesState,
    useNodesState,
    Handle,
    Position,
} from 'reactflow'
import 'reactflow/dist/style.css'

export type WfNode = { id: string; x: number; y: number; label: string }
export type WfEdge = { id: string; from: string; to: string }
export type WorkflowGraph = { nodes: WfNode[]; edges: WfEdge[] }

const GRID_SIZE = 16
const NODE_REPEL_GAP = 60 // minimum px gap between node rectangles
const EDGE_REPEL_GAP = 20 // edge clearance from non-endpoint nodes and exempt length at endpoints

function toRF(value?: WorkflowGraph | null): { nodes: RFNode[]; edges: RFEdge[] } {
    const nodes: RFNode[] = (value?.nodes ?? []).map(n => ({
        id: n.id,
        position: { x: n.x, y: n.y },
        data: { label: n.label },
        type: 'editable',
    }))
    const edges: RFEdge[] = (value?.edges ?? []).map(e => ({
        id: e.id,
        source: e.from,
        target: e.to,
        type: 'hl',
        markerEnd: { type: MarkerType.ArrowClosed },
        // interactionWidth is provided via defaultEdgeOptions
        selectable: true,
    }))
    return { nodes, edges }
}

function fromRF(nodes: RFNode[], edges: RFEdge[]): WorkflowGraph {
    const outNodes: WfNode[] = nodes.map(n => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        label: (n.data as any)?.label ?? '',
    }))
    const outEdges: WfEdge[] = edges.map(e => ({
        id: e.id,
        from: e.source,
        to: e.target,
    }))
    return { nodes: outNodes, edges: outEdges }
}

const norm = (g: WorkflowGraph) => JSON.stringify({
    nodes: [...(g.nodes || [])].map(n => ({ id: n.id, x: Math.round(n.x), y: Math.round(n.y), label: n.label })).sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...(g.edges || [])].map(e => ({ id: e.id, from: e.from, to: e.to })).sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)))
})

export default function OperationalFlowEditor({ value, onChange, height = 480 }: { value?: WorkflowGraph | null, onChange?: (g: WorkflowGraph) => void, height?: number }) {
    const initial = React.useMemo(() => toRF(value), [value])

    const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
    const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
    const [open, setOpen] = React.useState(false)
    const showPreview = false
    const rfRef = React.useRef<any | null>(null)
    const containerRef = React.useRef<HTMLDivElement | null>(null)

    const lastFromPropsRef = React.useRef<string | null>(null)
    const lastEmittedRef = React.useRef<string | null>(null)

    // helpers for obstacle-avoiding Bezier routing
    type Rect = { id: string; x: number; y: number; w: number; h: number }
    type Pt = { x: number; y: number }

    const pointInRect = (p: Pt, r: Rect): boolean => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
    const nearestPointOnRect = (p: Pt, r: Rect): Pt => ({ x: clamp(p.x, r.x, r.x + r.w), y: clamp(p.y, r.y, r.y + r.h) })
    const cubicPoint = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt => {
        const u = 1 - t
        const tt = t * t
        const uu = u * u
        const uuu = uu * u
        const ttt = tt * t
        return {
            x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
            y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
        }
    }

    const approxBezierLength = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, steps = 48): number => {
        let len = 0
        let prev = p0
        for (let i = 1; i <= steps; i++) {
            const t = i / steps
            const pt = cubicPoint(p0, p1, p2, p3, t)
            len += Math.hypot(pt.x - prev.x, pt.y - prev.y)
            prev = pt
        }
        return len
    }

    const findTForDistanceFromStart = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, distance: number, steps = 48): number => {
        let acc = 0
        let prev = p0
        for (let i = 1; i <= steps; i++) {
            const t = i / steps
            const pt = cubicPoint(p0, p1, p2, p3, t)
            acc += Math.hypot(pt.x - prev.x, pt.y - prev.y)
            if (acc >= distance) return t
            prev = pt
        }
        return 1
    }

    const findTForDistanceFromEnd = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, distance: number, steps = 48): number => {
        let acc = 0
        let prev = p3
        for (let i = 1; i <= steps; i++) {
            const t = 1 - i / steps
            const pt = cubicPoint(p0, p1, p2, p3, t)
            acc += Math.hypot(pt.x - prev.x, pt.y - prev.y)
            if (acc >= distance) return t
            prev = pt
        }
        return 0
    }

    const HLEdge = React.useCallback((props: EdgeProps) => {
        const selected = (props as any).selected || (props as any).data?.selected
        const color = selected ? '#22c55e' : '#94a3b8'
        const width = selected ? 4 : 2
        const obstacles: Rect[] = (((props as any).data?.obstacles as Rect[]) || [])
        // create inflated obstacles by EDGE_REPEL_GAP
        const inflated = obstacles.map(r => ({ id: r.id, x: r.x - EDGE_REPEL_GAP, y: r.y - EDGE_REPEL_GAP, w: r.w + EDGE_REPEL_GAP * 2, h: r.h + EDGE_REPEL_GAP * 2 }))

        const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props
        const dirFromPos = (pos: any): Pt => {
            switch (pos) {
                case Position.Left: return { x: -1, y: 0 }
                case Position.Right: return { x: 1, y: 0 }
                case Position.Top: return { x: 0, y: -1 }
                case Position.Bottom: return { x: 0, y: 1 }
                default: return { x: 0, y: 0 }
            }
        }
        const sdir = dirFromPos(sourcePosition)
        const tdir = dirFromPos(targetPosition)
        // Endpoints stay at the handles; exemption zones are applied during control nudging only
        const start: Pt = { x: sourceX, y: sourceY }
        const end: Pt = { x: targetX, y: targetY }

        // initial control points along handle directions
        const dist = Math.hypot(end.x - start.x, end.y - start.y)
        const base = clamp(dist * 0.4, 60, 240)
        let c1: Pt = { x: start.x + sdir.x * base, y: start.y + sdir.y * base }
        let c2: Pt = { x: end.x + tdir.x * base, y: end.y + tdir.y * base }

        // nudge controls away from obstacles by sampling points on the curve,
        // skipping the first/last EDGE_REPEL_GAP px along the curve length
        // compute provisional t-range that corresponds to the first/last EDGE_REPEL_GAP px
        const tStart = findTForDistanceFromStart(start, c1, c2, end, EDGE_REPEL_GAP)
        const tEnd = findTForDistanceFromEnd(start, c1, c2, end, EDGE_REPEL_GAP)
        const a = clamp(tStart, 0, 0.9)
        const b = clamp(tEnd, 0.1, 1)
        const lo = Math.min(a, 0.95)
        const hi = Math.max(b, 0.05)
        const range = Math.max(0, hi - lo)
        const sampleCount = range > 0.5 ? 7 : range > 0.25 ? 5 : range > 0.1 ? 3 : 2
        const samples: number[] = []
        for (let i = 0; i < sampleCount; i++) {
            const t = lo + (i / (sampleCount - 1)) * (hi - lo)
            samples.push(clamp(t, 0.05, 0.95))
        }
        const maxIter = 8
        for (let iter = 0; iter < maxIter; iter++) {
            let adjusted = false
            for (const t of samples) {
                const p = cubicPoint(start, c1, c2, end, t)
                // accumulate pushes from all intersecting obstacles for smoother avoidance
                let offX = 0
                let offY = 0
                for (const r of inflated) {
                    if (!pointInRect(p, r)) continue
                    // reference point = nearest point on rectangle boundary to p
                    const nearest = nearestPointOnRect(p, r)
                    let vx = p.x - nearest.x
                    let vy = p.y - nearest.y
                    let vlen = Math.hypot(vx, vy)
                    if (vlen < 0.0001) {
                        // if exactly on boundary center, fallback to outward normal of closest side
                        const dl = Math.abs(p.x - r.x)
                        const dr = Math.abs((r.x + r.w) - p.x)
                        const dt = Math.abs(p.y - r.y)
                        const db = Math.abs((r.y + r.h) - p.y)
                        const m = Math.min(dl, dr, dt, db)
                        if (m === dl) { vx = -1; vy = 0 }
                        else if (m === dr) { vx = 1; vy = 0 }
                        else if (m === dt) { vx = 0; vy = -1 }
                        else { vx = 0; vy = 1 }
                        vlen = 1
                    }
                    const push = (EDGE_REPEL_GAP + 12)
                    offX += (vx / vlen) * push
                    offY += (vy / vlen) * push
                }
                if (offX !== 0 || offY !== 0) {
                    if (t <= 0.5) c1 = { x: c1.x + offX, y: c1.y + offY }
                    else c2 = { x: c2.x + offX, y: c2.y + offY }
                    adjusted = true
                }
            }
            if (!adjusted) break
        }

        const d = `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`

        return (
            <BaseEdge
                id={(props as any).id}
                path={d}
                markerEnd={(props as any).markerEnd}
                style={{
                    ...(props.style || {}),
                    stroke: color,
                    strokeWidth: width,
                    filter: selected ? 'drop-shadow(0 0 3px #22c55e)' : undefined,
                    pointerEvents: 'stroke',
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                }}
            />
        )
    }, [])
    const edgeTypes = React.useMemo(() => ({ hl: HLEdge }), [HLEdge])

    // helper to update a node label and record history
    const setNodeLabel = React.useCallback((id: string, nextLabel: string) => {
        const prev = fromRF(nodes as any, edges as any)
        historyRef.current.push(prev)
        futureRef.current = []
        setHistoryLen(historyRef.current.length)
        setFutureLen(0)
        setNodes((prevNodes: RFNode[]) => prevNodes.map(n => n.id === id ? { ...n, data: { ...(n.data as any), label: nextLabel } } : n))
    }, [nodes, edges, setNodes])

    // custom node with inline label editor and left/right handles
    const EditableNode = React.useCallback((props: NodeProps) => {
        const label = (props.data as any)?.label ?? ''
        const [editing, setEditing] = React.useState(false)
        const [draft, setDraft] = React.useState(label)
        React.useEffect(() => { setDraft(label) }, [label])

        const commit = () => {
            setEditing(false)
            if (draft !== label) setNodeLabel(props.id, draft)
        }

        return (
            <div onDoubleClick={(e) => { e.stopPropagation(); setEditing(true) }}>
                <Handle type="target" position={Position.Left} style={{ width: 10, height: 10, background: '#94a3b8' }} />
                <Handle type="source" position={Position.Right} style={{ width: 10, height: 10, background: '#94a3b8' }} />
                {editing ? (
                    <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commit}
                        onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') { setEditing(false); setDraft(label) } }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="bg-transparent outline-none text-sm text-gray-900"
                        style={{ width: 160 }}
                    />
                ) : (
                    <div className="text-sm text-gray-900 select-none" style={{ padding: '2px 0' }}>{label}</div>
                )}
            </div>
        )
    }, [setNodeLabel])

    const nodeTypes = React.useMemo(() => ({ editable: EditableNode }), [EditableNode])

    // helper: get node dims (fallback to styled min sizes)
    const getNodeDims = React.useCallback((n: RFNode) => {
        const w = (n.width as number | undefined) ?? 120
        const h = (n.height as number | undefined) ?? 44
        return { w, h }
    }, [])

    // compute a repelled position for a moving node to maintain REPEL_GAP from others
    const resolveRepelledPosition = React.useCallback((movingId: string, proposed: { x: number; y: number }, all: RFNode[]) => {
        let nx = proposed.x
        let ny = proposed.y
        const moving = all.find(n => n.id === movingId)
        const { w: nw, h: nh } = moving ? getNodeDims(moving) : { w: 120, h: 44 }
        const maxIter = 8
        for (let iter = 0; iter < maxIter; iter++) {
            let adjusted = false
            for (const other of all) {
                if (other.id === movingId) continue
                const { w: ow, h: oh } = getNodeDims(other)
                const oL = other.position.x - NODE_REPEL_GAP
                const oT = other.position.y - NODE_REPEL_GAP
                const oR = other.position.x + ow + NODE_REPEL_GAP
                const oB = other.position.y + oh + NODE_REPEL_GAP
                const pL = nx
                const pT = ny
                const pR = nx + nw
                const pB = ny + nh
                const intersects = pL < oR && pR > oL && pT < oB && pB > oT
                if (intersects) {
                    const moveLeft = pR - oL // amount to move left to clear
                    const moveRight = oR - pL // amount to move right to clear
                    const moveUp = pB - oT // amount to move up to clear
                    const moveDown = oB - pT // amount to move down to clear
                    const minX = Math.min(moveLeft, moveRight)
                    const minY = Math.min(moveUp, moveDown)
                    if (minX < minY) {
                        if (moveLeft < moveRight) nx -= moveLeft
                        else nx += moveRight
                    } else {
                        if (moveUp < moveDown) ny -= moveUp
                        else ny += moveDown
                    }
                    adjusted = true
                }
            }
            if (!adjusted) break
        }
        // snap to ints; React Flow grid snapping will handle final alignment
        return { x: Math.round(nx), y: Math.round(ny) }
    }, [getNodeDims])

    // history for undo/redo
    const historyRef = React.useRef<WorkflowGraph[]>([])
    const futureRef = React.useRef<WorkflowGraph[]>([])
    const [historyLen, setHistoryLen] = React.useState(0)
    const [futureLen, setFutureLen] = React.useState(0)
    const isRestoringRef = React.useRef(false)

    // hydrate only when prop actually changes
    React.useEffect(() => {
        const incoming = toRF(value)
        const g = fromRF(incoming.nodes as any, incoming.edges as any)
        const incStr = norm(g)
        if (lastFromPropsRef.current !== incStr && lastEmittedRef.current !== incStr) {
            lastFromPropsRef.current = incStr
            setNodes(incoming.nodes)
            setEdges(incoming.edges)
            // reset history on external hydrate
            historyRef.current = [g]
            futureRef.current = []
            setHistoryLen(historyRef.current.length)
            setFutureLen(0)
        }
    }, [value, setNodes, setEdges])

    const onConnect = React.useCallback(
        (params: Connection) => {
            // record state before connect
            const prev = fromRF(nodes as any, edges as any)
            historyRef.current.push(prev)
            futureRef.current = []
            setHistoryLen(historyRef.current.length)
            setFutureLen(0)
            setEdges((eds: RFEdge[]) =>
                addEdge({ ...params, markerEnd: { type: MarkerType.ArrowClosed }, type: 'hl' }, eds),
            )
        },
        [nodes, edges, setEdges],
    )

    const addNode = React.useCallback(() => {
        // record state before add
        const prev = fromRF(nodes as any, edges as any)
        historyRef.current.push(prev)
        futureRef.current = []
        setHistoryLen(historyRef.current.length)
        setFutureLen(0)
        const id = Math.random().toString(36).slice(2, 9)
        // Place near viewport center if possible
        let position = { x: 0, y: 0 }
        const rect = containerRef.current?.getBoundingClientRect()
        if (rfRef.current && rect) {
            const local = { x: rect.width / 2, y: rect.height / 2 }
            const p = rfRef.current.project(local)
            position = { x: Math.round(p.x), y: Math.round(p.y) }
        } else {
            // fallback layout cascade
            position = { x: (nodes.length % 6) * 200, y: Math.floor(nodes.length / 6) * 120 }
        }
        // apply repulsion against current nodes for initial placement
        const repelled = resolveRepelledPosition(id, position, nodes as RFNode[])
        setNodes((prev) => [...prev, { id, position: repelled, data: { label: `Step ${prev.length + 1}` } }])
    }, [nodes, edges, setNodes, resolveRepelledPosition])

    // click on an edge: select only that edge; click again: de-select
    const onEdgeClick = React.useCallback((evt: React.MouseEvent, edge: RFEdge) => {
        const isSelected = (edges as RFEdge[]).some(e => e.id === edge.id && (e as any).selected)
        if (isSelected) {
            // toggle off when clicking an already-selected edge
            evt.preventDefault()
            evt.stopPropagation()
            setEdges((prev: RFEdge[]) => prev.map(e => (e.id === edge.id ? { ...e, selected: false } as any : e)))
            return
        }
        // otherwise let React Flow select it; clear any node selection
        setNodes((prev: any[]) => prev.map(n => (n.selected ? { ...n, selected: false } : n)))
    }, [edges, setEdges, setNodes])

    // click on a node: select only that node; click again: de-select
    const onNodeClick = React.useCallback((evt: React.MouseEvent, node: RFNode) => {
        evt.stopPropagation()
        setEdges((prev: RFEdge[]) => prev.map(e => (e.selected ? { ...e, selected: false } : e)))
        setNodes((prev: RFNode[]) => {
            // Always select the clicked node; keep it selected until clicking elsewhere
            return prev.map(n => ({ ...n, selected: n.id === node.id }))
        })
    }, [setNodes, setEdges])

    // derive styled nodes (selected => bright border/background)
    const styledNodes = React.useMemo(() => {
        return (nodes as RFNode[]).map((n) => {
            const selected = (n as any).selected
            const base: React.CSSProperties = {
                // rounded rectangle shape (not a full pill)
                borderRadius: 12,
                background: '#ffffff',
                color: '#111827',
                padding: '10px 16px',
                fontSize: 14,
                minWidth: 120,
                minHeight: 44,
            }
            const style = selected
                ? {
                    ...base,
                    ...n.style,
                    // match edge highlight intensity (thicker border + glow)
                    border: '3px solid #22c55e',
                    boxShadow: '0 0 0 2px rgba(34,197,94,0.35), 0 0 6px rgba(34,197,94,0.6)',
                }
                : { ...base, ...n.style, border: '1px solid #cbd5e1' }
            return { ...n, style }
        })
    }, [nodes])

    // derive styled edges: arrowhead color follows selection
    const styledEdges = React.useMemo(() => {
        const rects: { [id: string]: { x: number; y: number; w: number; h: number } } = {}
        for (const n of nodes as RFNode[]) {
            const dims = getNodeDims(n)
            rects[n.id] = { x: n.position.x, y: n.position.y, w: dims.w, h: dims.h }
        }
        return (edges as RFEdge[]).map((e) => {
            const selected = (e as any).selected
            const markerEnd = { type: MarkerType.ArrowClosed, color: selected ? '#22c55e' : '#94a3b8' } as any
            // pass obstacle rects for all nodes except the ones connected by this edge
            const obstacles: Rect[] = (nodes as RFNode[])
                .filter(n => n.id !== (e as any).source && n.id !== (e as any).target)
                .map(n => ({ id: n.id, ...(rects[n.id]) }))
            return { ...e, markerEnd, data: { ...(e as any).data, obstacles } }
        })
    }, [edges, nodes, getNodeDims])

    // wrapped change handlers to capture history for removes/adds/position updates
    const onNodesChangeWithHistory = React.useCallback((changes: any[]) => {
        // decide if this set of changes should be added to history
        const shouldRecord = Array.isArray(changes) && changes.some((c: any) => (
            c?.type === 'add' || c?.type === 'remove' || (c?.type === 'position' && c?.dragging === false) || c?.type === 'dimensions'
        ))
        if (shouldRecord) {
            const prev = fromRF(nodes as any, edges as any)
            historyRef.current.push(prev)
            futureRef.current = []
            setHistoryLen(historyRef.current.length)
            setFutureLen(0)
        }
        onNodesChange(changes as any)
    }, [nodes, edges, onNodesChange])

    const onEdgesChangeWithHistory = React.useCallback((changes: any[]) => {
        const shouldRecord = Array.isArray(changes) && changes.some((c: any) => (
            c?.type === 'add' || c?.type === 'remove'
        ))
        if (shouldRecord) {
            const prev = fromRF(nodes as any, edges as any)
            historyRef.current.push(prev)
            futureRef.current = []
            setHistoryLen(historyRef.current.length)
            setFutureLen(0)
        }
        onEdgesChange(changes as any)
    }, [nodes, edges, onEdgesChange])

    const deleteSelected = React.useCallback(() => {
        const selectedNodeIds = new Set((nodes as any[]).filter(n => n.selected).map(n => n.id))
        const selectedEdgeIds = new Set((edges as any[]).filter(e => e.selected).map(e => e.id))
        if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return
        const prev = fromRF(nodes as any, edges as any)
        historyRef.current.push(prev)
        futureRef.current = []
        setHistoryLen(historyRef.current.length)
        setFutureLen(0)
        setNodes((prevNodes: any[]) => prevNodes.filter(n => !selectedNodeIds.has(n.id)))
        setEdges((prevEdges: any[]) => prevEdges.filter(e => !selectedEdgeIds.has(e.id) && !selectedNodeIds.has((e as any).source) && !selectedNodeIds.has((e as any).target)))
    }, [nodes, edges, setNodes, setEdges])

    const undo = React.useCallback(() => {
        if (historyRef.current.length === 0) return
        const current = fromRF(nodes as any, edges as any)
        const previous = historyRef.current.pop() as WorkflowGraph
        futureRef.current.push(current)
        isRestoringRef.current = true
        const rf = toRF(previous)
        setNodes(rf.nodes)
        setEdges(rf.edges)
        isRestoringRef.current = false
        setHistoryLen(historyRef.current.length)
        setFutureLen(futureRef.current.length)
    }, [nodes, edges, setNodes, setEdges])

    const redo = React.useCallback(() => {
        if (futureRef.current.length === 0) return
        const current = fromRF(nodes as any, edges as any)
        const next = futureRef.current.pop() as WorkflowGraph
        historyRef.current.push(current)
        isRestoringRef.current = true
        const rf = toRF(next)
        setNodes(rf.nodes)
        setEdges(rf.edges)
        isRestoringRef.current = false
        setHistoryLen(historyRef.current.length)
        setFutureLen(futureRef.current.length)
    }, [nodes, edges, setNodes, setEdges])

    // keyboard support in modal
    React.useEffect(() => {
        if (!open) return
        const handler = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null
            const tag = (el?.tagName || '').toLowerCase()
            const isTyping = tag === 'input' || tag === 'textarea' || (el?.getAttribute('contenteditable') === 'true')
            if (isTyping) return
            if ((e.key === 'Backspace' || e.key === 'Delete')) {
                e.preventDefault()
                deleteSelected()
            } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
                e.preventDefault()
                undo()
            } else if ((e.ctrlKey && e.key.toLowerCase() === 'y') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')) {
                e.preventDefault()
                redo()
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [open, deleteSelected, undo, redo])

    // propagate back to parent
    React.useEffect(() => {
        const out = fromRF(nodes as any, edges as any)
        const outStr = norm(out)
        if (lastFromPropsRef.current === outStr) return
        if (lastEmittedRef.current === outStr) return
        lastEmittedRef.current = outStr
        onChange?.(out)
    }, [nodes, edges, onChange])

    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-3">
            <div className="flex items-center justify-between">
                <div>
                    <div className="text-sm text-gray-300">Visual workflow (React Flow)</div>
                    <div className="text-xs text-gray-400">{nodes.length} nodes, {edges.length} edges</div>
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" className="text-yellow-400 border border-yellow-500/40 px-3 py-1 rounded" onClick={() => setOpen(true)}>Open editor</button>
                </div>
            </div>

            {/* Inline preview removed per request; guarded by showPreview */}
            {showPreview && (
                <div className="mt-3 rounded-lg border border-gray-800 overflow-hidden bg-gray-900" style={{ height }} />
            )}

            {open && (
                <div className="fixed inset-0 z-50">
                    <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
                    <div className="absolute inset-0 p-4 flex flex-col">
                        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 flex items-center gap-2">
                            <button type="button" className="text-yellow-400 border border-yellow-500/40 px-3 py-1 rounded" onClick={addNode}>Add node</button>
                            <button type="button" className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 px-3 py-1 rounded" onClick={deleteSelected}>Delete selected</button>
                            <button type="button" disabled={historyLen === 0} className={`px-3 py-1 rounded border ${historyLen === 0 ? 'text-gray-500 border-gray-800' : 'text-gray-200 bg-gray-800 hover:bg-gray-700 border-gray-700'}`} onClick={undo}>Undo</button>
                            <button type="button" disabled={futureLen === 0} className={`px-3 py-1 rounded border ${futureLen === 0 ? 'text-gray-500 border-gray-800' : 'text-gray-200 bg-gray-800 hover:bg-gray-700 border-gray-700'}`} onClick={redo}>Redo</button>
                            <button type="button" className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 px-3 py-1 rounded" onClick={() => rfRef.current?.fitView?.({ padding: 0.2, maxZoom: 1 })}>Fit</button>
                            <div className="ml-auto flex items-center gap-2">
                                <button type="button" className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 px-3 py-1 rounded" onClick={() => setOpen(false)}>Close</button>
                            </div>
                        </div>
                        <div ref={containerRef} className="relative flex-1 mt-3 rounded-lg border border-gray-800 overflow-hidden bg-gray-900">
                            <ReactFlow
                                className="bg-gray-900"
                                nodes={styledNodes}
                                edges={styledEdges}
                                nodeTypes={nodeTypes}
                                onNodesChange={onNodesChangeWithHistory}
                                onEdgesChange={onEdgesChangeWithHistory}
                                onConnect={onConnect}
                                onEdgeClick={onEdgeClick}
                                onNodeClick={onNodeClick}
                                onNodeDrag={(_, node) => {
                                    // while dragging, adjust the moving node to keep at least REPEL_GAP from others
                                    setNodes(prev => {
                                        const next = resolveRepelledPosition(node.id, node.position, prev as RFNode[])
                                        if (next.x === node.position.x && next.y === node.position.y) return prev
                                        return (prev as RFNode[]).map(n => n.id === node.id ? { ...n, position: next } : n) as unknown as RFNode[]
                                    })
                                }}
                                edgeTypes={edgeTypes}
                                connectionLineType={ConnectionLineType.Bezier}
                                onPaneClick={() => {
                                    setNodes(prev => prev.map(n => (n as any).selected ? { ...n, selected: false } : n))
                                    setEdges(prev => prev.map(e => (e as any).selected ? { ...e, selected: false } : e))
                                }}
                                onInit={(inst) => { rfRef.current = inst; setTimeout(() => inst.fitView?.({ padding: 0.2, maxZoom: 1 }), 0) }}
                                fitView
                                fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                                minZoom={0}
                                maxZoom={4}
                                snapToGrid
                                snapGrid={[GRID_SIZE, GRID_SIZE]}
                                panOnScroll
                                panOnDrag
                                zoomOnPinch
                                elementsSelectable
                                nodesDraggable
                                nodesConnectable
                                elevateEdgesOnSelect
                                deleteKeyCode={["Delete", "Backspace"]}
                                defaultEdgeOptions={{ type: 'hl', markerEnd: { type: MarkerType.ArrowClosed }, interactionWidth: 40 }}
                            >
                                <MiniMap pannable zoomable />
                                <Controls position="bottom-left" />
                            </ReactFlow>
                            <div className="absolute bottom-2 left-2 text-xs text-gray-400">
                                Tip: Drag to move nodes. Pan with mouse wheel or drag background. Snap to 16px grid. Connect nodes by dragging between handles. Del/Backspace deletes selected. Ctrl+Z/Ctrl+Y undo/redo.
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
