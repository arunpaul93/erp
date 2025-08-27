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
    getBezierPath,
    getSmoothStepPath,
} from 'reactflow'
import 'reactflow/dist/style.css'

export type WfNode = { id: string; x: number; y: number; label: string }
export type WfEdge = { id: string; from: string; to: string }
export type WorkflowGraph = { nodes: WfNode[]; edges: WfEdge[] }

const GRID_SIZE = 16
const NODE_REPEL_GAP = 60 // minimum px gap between node rectangles
const EDGE_REPEL_GAP = 20 // edge clearance from non-endpoint nodes and exempt length at endpoints

// Constants for backward edge routing
const EDGE_PADDING_BOTTOM = 130 // vertical padding downwards
const EDGE_PADDING_X = 40 // horizontal offset to avoid overlapping
const EDGE_BORDER_RADIUS = 16 // bend radius for rounded corners
const HANDLE_SIZE = 20 // handle fudge factor

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

export default function OperationalFlowEditor({
    value,
    onChange,
    height = 480,
    onSave,
    saving = false,
    businessPlanId
}: {
    value?: WorkflowGraph | null,
    onChange?: (g: WorkflowGraph) => void,
    height?: number,
    onSave?: (workflow: WorkflowGraph) => Promise<void>,
    saving?: boolean,
    businessPlanId?: string
}) {
    const initial = React.useMemo(() => toRF(value), [value])

    const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
    const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
    const [open, setOpen] = React.useState(false)
    const showPreview = false
    const rfRef = React.useRef<any | null>(null)
    const containerRef = React.useRef<HTMLDivElement | null>(null)
    // menu/context actions removed for a simpler, reliable rename UX

    const lastFromPropsRef = React.useRef<string | null>(null)
    const lastEmittedRef = React.useRef<string | null>(null)

    const HLEdge = React.useCallback((props: EdgeProps) => {
        const selected = (props as any).selected || (props as any).data?.selected
        const color = selected ? '#22c55e' : '#94a3b8'
        const width = selected ? 4 : 2

        const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props

        // Determine if this is a backward connection (source is to the right of target)
        const isBackward = sourceX > targetX

        let path: string
        let labelX: number
        let labelY: number

        if (isBackward) {
            // Backward connection: generate from both ends with smooth curves and proper segments
            const minSegmentLength = 40 // Minimum 40px between bends
            const nodeWidth = 200 // Estimated node width
            const curveRadius = 20 // Radius for smooth curves instead of 90-degree bends

            // Calculate safe exit and entry points
            const sourceExitX = sourceX + Math.max(minSegmentLength, EDGE_PADDING_X)
            const sourceExitY = sourceY

            // Ensure target entry point is well outside the target node bounds
            const targetLeftEdge = targetX - (nodeWidth / 2) // Approximate left edge of target node
            const safeApproachDistance = Math.max(minSegmentLength, EDGE_PADDING_X + 20) // Extra clearance
            const targetEntryX = Math.min(targetLeftEdge - safeApproachDistance, sourceExitX - minSegmentLength)
            const targetEntryY = targetY

            // Create smooth path with curves instead of sharp 90-degree bends
            let pathCommands: string[] = []

            // Start at source handle
            pathCommands.push(`M ${sourceX} ${sourceY}`)

            if (sourceY === targetY) {
                // Same Y level: create path that goes below the nodes with rounded corners
                const curveHeight = 60 // How far the path extends vertically
                const cornerRadius = 8 // Radius for rounded corners
                const midX = (sourceExitX + targetEntryX) / 2

                // Create a path with rounded corners
                pathCommands.push(`L ${sourceExitX - cornerRadius} ${sourceY}`)

                // Rounded corner down-right
                pathCommands.push(`Q ${sourceExitX} ${sourceY} ${sourceExitX} ${sourceY + cornerRadius}`)

                // Straight line down
                pathCommands.push(`L ${sourceExitX} ${sourceY + curveHeight - cornerRadius}`)

                // Rounded corner down-left 
                pathCommands.push(`Q ${sourceExitX} ${sourceY + curveHeight} ${sourceExitX - cornerRadius} ${sourceY + curveHeight}`)

                // Horizontal bridge at the bottom
                pathCommands.push(`L ${targetEntryX + cornerRadius} ${sourceY + curveHeight}`)

                // Rounded corner up-left
                pathCommands.push(`Q ${targetEntryX} ${sourceY + curveHeight} ${targetEntryX} ${sourceY + curveHeight - cornerRadius}`)

                // Straight line back up
                pathCommands.push(`L ${targetEntryX} ${sourceY + cornerRadius}`)

                // Rounded corner up-right
                pathCommands.push(`Q ${targetEntryX} ${sourceY} ${targetEntryX + cornerRadius} ${sourceY}`)

                // Final approach to target
                pathCommands.push(`L ${targetX} ${targetY}`)

                labelX = midX
                labelY = sourceY + curveHeight / 2
            } else {
                // Different Y levels: use vertical routing with rounded corners
                const verticalOffset = Math.max(EDGE_PADDING_BOTTOM, Math.abs(targetY - sourceY) + 50)
                const middleY = sourceY + (sourceY < targetY ? verticalOffset : -verticalOffset)
                const cornerRadius = 8 // Radius for rounded corners
                const middleX = (sourceExitX + targetEntryX) / 2

                // Source side: horizontal exit
                pathCommands.push(`L ${sourceExitX - cornerRadius} ${sourceExitY}`)

                // Rounded corner for vertical transition
                if (sourceY < targetY) {
                    // Going down
                    pathCommands.push(`Q ${sourceExitX} ${sourceExitY} ${sourceExitX} ${sourceExitY + cornerRadius}`)
                    pathCommands.push(`L ${sourceExitX} ${middleY - cornerRadius}`)
                    pathCommands.push(`Q ${sourceExitX} ${middleY} ${sourceExitX - cornerRadius} ${middleY}`)
                } else {
                    // Going up
                    pathCommands.push(`Q ${sourceExitX} ${sourceExitY} ${sourceExitX} ${sourceExitY - cornerRadius}`)
                    pathCommands.push(`L ${sourceExitX} ${middleY + cornerRadius}`)
                    pathCommands.push(`Q ${sourceExitX} ${middleY} ${sourceExitX - cornerRadius} ${middleY}`)
                }

                // Middle horizontal bridge with minimum segment length
                if (Math.abs(sourceExitX - targetEntryX) >= minSegmentLength) {
                    pathCommands.push(`L ${targetEntryX + cornerRadius} ${middleY}`)
                }

                // Rounded corner for target side vertical transition
                if (sourceY < targetY) {
                    // Coming from below
                    pathCommands.push(`Q ${targetEntryX} ${middleY} ${targetEntryX} ${middleY - cornerRadius}`)
                    pathCommands.push(`L ${targetEntryX} ${targetY + cornerRadius}`)
                    pathCommands.push(`Q ${targetEntryX} ${targetY} ${targetEntryX + cornerRadius} ${targetY}`)
                } else {
                    // Coming from above
                    pathCommands.push(`Q ${targetEntryX} ${middleY} ${targetEntryX} ${middleY + cornerRadius}`)
                    pathCommands.push(`L ${targetEntryX} ${targetY - cornerRadius}`)
                    pathCommands.push(`Q ${targetEntryX} ${targetY} ${targetEntryX + cornerRadius} ${targetY}`)
                }

                // Final approach to target handle
                pathCommands.push(`L ${targetX} ${targetY}`)

                labelX = middleX
                labelY = middleY
            }

            path = pathCommands.join(' ')
        } else {
            // Forward connection: use Bezier curve
            const [bezierPath, labelPosX, labelPosY] = getBezierPath({
                sourceX,
                sourceY,
                sourcePosition,
                targetX,
                targetY,
                targetPosition,
            })

            path = bezierPath
            labelX = labelPosX
            labelY = labelPosY
        }

        return (
            <BaseEdge
                id={(props as any).id}
                path={path}
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
    // delete a node by id (and its edges) with history, used by the context menu
    const deleteNodeById = React.useCallback((id: string) => {
        const prev = fromRF(nodes as any, edges as any)
        historyRef.current.push(prev)
        futureRef.current = []
        setHistoryLen(historyRef.current.length)
        setFutureLen(0)
        setNodes((prevNodes: RFNode[]) => prevNodes.filter(n => n.id !== id))
        setEdges((prevEdges: RFEdge[]) => prevEdges.filter(e => (e as any).source !== id && (e as any).target !== id))
    }, [nodes, edges, setNodes, setEdges])

    // toggle a node's editing state (UI only; no history entry)
    const setNodeEditing = React.useCallback((id: string, editing: boolean) => {
        setNodes((prevNodes: RFNode[]) => prevNodes.map(n => n.id === id ? { ...n, data: { ...(n.data as any), editing } } : n))
    }, [setNodes])

    // custom node with fresh, minimal inline label editor and left/right handles
    const EditableNode = React.useCallback((props: NodeProps) => {
        const label = (props.data as any)?.label ?? ''
        const editing: boolean = !!(props.data as any)?.editing
        const [draft, setDraft] = React.useState(label)
        const inputRef = React.useRef<HTMLInputElement | null>(null)
        const prevEditingRef = React.useRef(editing)

        // Sync draft when entering edit mode
        React.useEffect(() => {
            if (!prevEditingRef.current && editing) setDraft(label)
            prevEditingRef.current = editing
        }, [editing, label])

        // Autofocus and move caret to end
        React.useEffect(() => {
            if (!editing) return
            const t = setTimeout(() => {
                const el = inputRef.current
                if (!el) return
                el.focus()
                const len = el.value?.length ?? 0
                try { el.setSelectionRange(len, len) } catch { }
            }, 0)
            return () => clearTimeout(t)
        }, [editing])

        const commit = () => {
            setNodeEditing(props.id, false)
            if (draft !== label) setNodeLabel(props.id, draft)
        }
        const cancel = () => {
            setNodeEditing(props.id, false)
            setDraft(label)
        }



        return (
            <div
                onDoubleClick={(e) => {
                    e.stopPropagation();
                    setNodeEditing(props.id, true);
                }}
                onClick={(e) => {
                    e.stopPropagation();
                }}
                style={{
                    background: 'white',
                    border: '2px solid #e2e8f0',
                    borderRadius: 8,
                    minWidth: 200,
                    minHeight: 60,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '10px 16px'
                }}
            >
                <Handle type="target" position={Position.Left} style={{ width: 10, height: 10, background: '#94a3b8', left: 0, top: '50%', transform: 'translate(-50%, -50%)' }} />
                <Handle type="source" position={Position.Right} style={{ width: 10, height: 10, background: '#94a3b8', right: 0, top: '50%', transform: 'translate(50%, -50%)' }} />
                {editing ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                        <input
                            ref={inputRef}
                            id={`node-label-${props.id}`}
                            name={`node-label-${props.id}`}
                            type="text"
                            autoFocus
                            autoComplete="off"
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={commit}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    commit();
                                } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    cancel();
                                }
                            }}
                            onKeyUp={(e) => e.stopPropagation()}
                            onKeyPress={(e) => e.stopPropagation()}
                            onInput={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                            onFocus={(e) => e.stopPropagation()}
                            className="bg-transparent outline-none text-sm text-gray-900 caret-green-500"
                            style={{ flex: 1, border: 'none', background: 'transparent', textAlign: 'center' }}
                        />
                        <button
                            onClick={(e) => { e.stopPropagation(); commit(); }}
                            className="text-xs px-2 py-1 bg-green-500 text-white rounded"
                        >
                            ✓
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); cancel(); }}
                            className="text-xs px-2 py-1 bg-red-500 text-white rounded"
                        >
                            ✕
                        </button>
                    </div>
                ) : (
                    <span className="text-sm text-gray-900 select-none text-center">{label}</span>
                )}
            </div>
        )
    }, [])

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
        setNodes((prev) => [...prev, { id, type: 'editable', position: repelled, data: { label: `Step ${prev.length + 1}` } }])
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
            const isEditing = !!((n.data as any)?.editing)
            // Minimal styling - let the EditableNode component handle all visual styling
            const style = selected
                ? {
                    ...n.style,
                    // Add selection glow effect around the entire node
                    filter: 'drop-shadow(0 0 0 3px #22c55e) drop-shadow(0 0 6px rgba(34,197,94,0.6))',
                }
                : { ...n.style }
            return { ...n, style, draggable: !isEditing, connectable: !isEditing }
        })
    }, [nodes])

    // derive styled edges: arrowhead color follows selection
    const styledEdges = React.useMemo(() => {
        return (edges as RFEdge[]).map((e) => {
            const selected = (e as any).selected
            const markerEnd = { type: MarkerType.ArrowClosed, color: selected ? '#22c55e' : '#94a3b8' } as any
            // no obstacles passed -> no line repulsion
            return { ...e, markerEnd }
        })
    }, [edges])

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

    // Save workflow directly to backend
    const saveWorkflow = React.useCallback(async () => {
        if (!onSave || !businessPlanId) return
        const currentWorkflow = fromRF(nodes as any, edges as any)
        await onSave(currentWorkflow)
    }, [onSave, businessPlanId, nodes, edges])

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
                            <button
                                type="button"
                                className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 px-3 py-1 rounded"
                                onClick={() => {
                                    const sel = (nodes as any[]).find(n => n.selected)
                                    if (sel) setNodeEditing(sel.id, true)
                                }}
                                disabled={!((nodes as any[]).filter(n => n.selected).length === 1)}
                                title="Rename selected"
                            >Rename</button>
                            <button type="button" disabled={historyLen === 0} className={`px-3 py-1 rounded border ${historyLen === 0 ? 'text-gray-500 border-gray-800' : 'text-gray-200 bg-gray-800 hover:bg-gray-700 border-gray-700'}`} onClick={undo}>Undo</button>
                            <button type="button" disabled={futureLen === 0} className={`px-3 py-1 rounded border ${futureLen === 0 ? 'text-gray-500 border-gray-800' : 'text-gray-200 bg-gray-800 hover:bg-gray-700 border-gray-700'}`} onClick={redo}>Redo</button>
                            <button type="button" className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 px-3 py-1 rounded" onClick={() => rfRef.current?.fitView?.({ padding: 0.2, maxZoom: 1 })}>Fit</button>
                            {onSave && businessPlanId && (
                                <button
                                    type="button"
                                    onClick={saveWorkflow}
                                    disabled={saving}
                                    className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white border border-green-600 px-3 py-1 rounded"
                                >
                                    {saving ? 'Saving...' : 'Save Workflow'}
                                </button>
                            )}
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
