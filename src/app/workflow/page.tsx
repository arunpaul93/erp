'use client'

import { useCallback, useState, useEffect, useRef } from 'react'
import {
    ReactFlow,
    Controls,
    Background,
    BackgroundVariant,
    useNodesState,
    useEdgesState,
    addEdge,
    Connection,
    Edge,
    Node,
    Handle,
    Position,
    useReactFlow,
    ReactFlowProvider,
    OnConnectStart,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { hierarchy, tree, HierarchyNode } from 'd3-hierarchy'

type D3Node = { id: string; children?: D3Node[] }

// Custom node components with side handles
function CustomNode({ id, data, isConnectable }: { id: string; data: any; isConnectable: boolean }) {
    const [isEditing, setIsEditing] = useState(false)
    const [editText, setEditText] = useState(data.label || 'Node')

    const handleDoubleClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        setIsEditing(true)
        setEditText(data.label || 'Node')
    }

    const handleSave = () => {
        // Update the node data through React Flow's node update mechanism
        const event = new CustomEvent('updateNodeLabel', {
            detail: { nodeId: id, newLabel: editText }
        })
        window.dispatchEvent(event)
        setIsEditing(false)
    }
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setEditText(data.label || 'Node')
            setIsEditing(false)
        }
        // Don't handle Enter - let it create new lines naturally
    }

    // Auto-resize function for textarea
    const handleTextareaResize = (textarea: HTMLTextAreaElement) => {
        textarea.style.height = 'auto'
        textarea.style.height = textarea.scrollHeight + 'px'
    }

    return (
        <div className="px-4 py-2 shadow-md rounded-md bg-white border-2 border-stone-400 min-w-[120px]">
            <Handle
                type="target"
                position={Position.Left}
                style={{ background: '#555' }}
                isConnectable={isConnectable}
            />
            <div className="text-center text-sm font-medium text-gray-700">
                {isEditing ? (
                    <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onBlur={handleSave}
                        onKeyDown={handleKeyDown}
                        className="w-full text-center bg-transparent border-none outline-none text-sm font-medium text-gray-700 resize-none overflow-hidden min-h-[1.2em]"
                        autoFocus
                        ref={(textarea) => {
                            if (textarea) {
                                // Don't select all text, just position cursor at end
                                setTimeout(() => {
                                    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
                                    handleTextareaResize(textarea)
                                }, 0)
                            }
                        }}
                        rows={1}
                        style={{
                            height: 'auto',
                            minHeight: '1.2em',
                            lineHeight: '1.2em'
                        }}
                        onInput={(e) => {
                            // Auto-resize textarea to fit content
                            const target = e.target as HTMLTextAreaElement
                            handleTextareaResize(target)
                        }}
                    />
                ) : (
                    <div
                        onDoubleClick={handleDoubleClick}
                        className="cursor-pointer whitespace-pre-wrap"
                        style={{ lineHeight: '1.2em' }}
                    >
                        {data.label}
                    </div>
                )}
            </div>
            <Handle
                type="source"
                position={Position.Right}
                style={{ background: '#555' }}
                isConnectable={isConnectable}
            />
        </div>
    )
}

const nodeTypes = {
    custom: CustomNode,
    input: CustomNode,
    output: CustomNode,
}

const initialNodes: Node[] = [
    {
        id: '1',
        type: 'custom',
        data: { label: 'Start' },
        position: { x: 50, y: 100 },
    },
    {
        id: '2',
        type: 'custom',
        data: { label: 'Process Step' },
        position: { x: 250, y: 100 },
    },
    {
        id: '3',
        type: 'custom',
        data: { label: 'Decision Point' },
        position: { x: 450, y: 100 },
    },
    {
        id: '4',
        type: 'custom',
        data: { label: 'End' },
        position: { x: 650, y: 100 },
    },
]

const initialEdges: Edge[] = [
    { id: 'e1-2', source: '1', target: '2', type: 'pulseBezier' as any },
    { id: 'e2-3', source: '2', target: '3', type: 'pulseBezier' as any },
    { id: 'e3-4', source: '3', target: '4', type: 'pulseBezier' as any },
]

// Legacy orthogonal edge removed. We now exclusively use Bezier edges.

// Smooth bezier edge with fiber-optic animation, using only endpoints; no wiring channels
function PulseBezierEdge({ id, sourceX, sourceY, targetX, targetY, style = {}, markerEnd, data }: any) {
    const isBackwards: boolean = !!data?.isBackwards
    const isForwardOverrun: boolean = !!data?.isForwardOverrun
    const arcY: number | undefined = data?.arcY
    const arcXMid: number | undefined = data?.arcXMid

    // Compute cubic bezier control points based on horizontal distance
    const dx = targetX - sourceX
    const dy = targetY - sourceY
    const absDx = Math.abs(dx)
    const base = Math.max(40, absDx * 0.25)
    let path: string
    if (arcY != null && arcXMid != null && dx >= 0) {
        // Two-segment cubic with an explicit apex above skipped columns
        const c1x = sourceX + base
        const c1y = arcY
        const c2x = arcXMid - base
        const c2y = arcY
        const c3x = arcXMid + base
        const c3y = arcY
        const c4x = targetX - base
        const c4y = arcY
        path = `M ${sourceX} ${sourceY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${arcXMid} ${arcY}` +
            ` C ${c3x} ${c3y}, ${c4x} ${arcY}, ${targetX} ${targetY}`
    } else {
        // Single cubic default
        const c1x = sourceX + (dx >= 0 ? base : -base)
        const c1y = arcY != null ? arcY : sourceY
        const c2x = targetX - (dx >= 0 ? base : -base)
        const c2y = arcY != null ? arcY : targetY
        path = `M ${sourceX} ${sourceY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${targetX} ${targetY}`
    }

    return (
        <g id={id}>
            <path
                className="react-flow__edge-path edge-fiber"
                d={path}
                markerEnd={markerEnd}
                fill="none"
                style={style}
            />
            <path
                className={`react-flow__edge-path edge-pulse${isForwardOverrun ? ' edge-pulse--overrun' : ''}${isBackwards ? ' edge-pulse-backward' : ''}`}
                d={path}
                markerEnd={markerEnd}
                fill="none"
                style={style}
            />
        </g>
    )
}

const edgeTypes = {
    pulseBezier: PulseBezierEdge,
}

// Main workflow component that needs React Flow context
function WorkflowContent() {
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
    const [showConfig, setShowConfig] = useState(false)
    const [nodePadding, setNodePadding] = useState(50)
    // Relative spacing: spacing to next column = nextColumnNetHeight * spacingFactor
    const [spacingFactor, setSpacingFactor] = useState(0.3)
    const [columnPadding, setColumnPadding] = useState(40)
    const [lockNodes, setLockNodes] = useState(true)
    // Connector padding removed entirely (no target-side fan-out)
    const autoLayoutRef = useRef<(() => void) | null>(null)
    const connectingNodeIdRef = useRef<string | null>(null)
    const connectionMadeRef = useRef<boolean>(false)
    // Persisted levels so nodes never move to an earlier column (non-decreasing levels)
    const stableLevelsRef = useRef<Record<string, number>>({})

    // Get React Flow instance for viewport access and node measurements
    const { getViewport, getNode, screenToFlowPosition } = useReactFlow()

    // Handle node label updates
    useEffect(() => {
        const handleUpdateNodeLabel = (event: any) => {
            const { nodeId, newLabel } = event.detail
            setNodes((nds) =>
                nds.map((node) =>
                    node.id === nodeId
                        ? { ...node, data: { ...node.data, label: newLabel } }
                        : node
                )
            )
            // self-organize after label size change
            setTimeout(() => autoLayoutRef.current?.(), 0)
        }

        window.addEventListener('updateNodeLabel', handleUpdateNodeLabel)
        return () => window.removeEventListener('updateNodeLabel', handleUpdateNodeLabel)
    }, [setNodes])

    // Helper function to calculate node width consistently
    const calculateNodeWidth = useCallback((nodeText: string) => {
        let nodeWidth = 120 // min-w-[120px] from CSS
        if (typeof nodeText === 'string') {
            const lines = nodeText.split('\n')
            const longestLine = lines.reduce((longest, line) =>
                line.length > longest.length ? line : longest, '')
            // More accurate calculation: text-sm (14px) * 0.6 char width + px-4 padding (32px total)
            const estimatedTextWidth = longestLine.length * 8.4 // Slightly more accurate than 8px
            const totalWidth = estimatedTextWidth + 32 // Add px-4 padding (16px left + 16px right)
            nodeWidth = Math.max(120, totalWidth) // Respect min-w-[120px]
        }
        return nodeWidth
    }, [])

    // Helper function to get node width for any node - used by getLayoutData
    const getNodeWidthFromNode = useCallback((node: Node) => {
        const label = node.data?.label || 'Node'
        return calculateNodeWidth(typeof label === 'string' ? label : 'Node')
    }, [calculateNodeWidth])

    // Fallback height estimator based on text
    const estimateNodeHeight = useCallback((nodeText: string) => {
        const lineCount = typeof nodeText === 'string' ? nodeText.split('\n').length : 1
        return Math.max(40, lineCount * 20 + 20)
    }, [])

    // Get measured node size from React Flow if available; otherwise fall back to estimates
    const getNodeSize = useCallback((n: Node) => {
        const rfNode: any = getNode?.(n.id)
        const label = n.data?.label ?? 'Node'
        const width = rfNode?.measured?.width ?? rfNode?.width ?? (n as any)?.width ?? getNodeWidthFromNode(n)
        const height = rfNode?.measured?.height ?? rfNode?.height ?? (n as any)?.height ?? estimateNodeHeight(label as string)
        return { width, height }
    }, [getNode, getNodeWidthFromNode, estimateNodeHeight])

    // Ensure unique edges helper
    const dedupeEdges = useCallback((eds: Edge[]) => {
        const seen = new Set<string>()
        const result: Edge[] = []
        for (const e of eds) {
            const key = `${e.source}->${e.target}`
            if (!seen.has(key)) {
                seen.add(key)
                // force bezier type
                result.push({ ...e, type: 'pulseBezier' as any })
            }
        }
        return result
    }, [])

    const onConnect = useCallback(
        (params: Connection) => {
            // Mark that a valid connection was completed during this drag
            connectionMadeRef.current = true
            // Block backward connections (target column earlier than source)
            const levels = (() => {
                // minimal BFS levels based on current nodes/edges
                let sourceNodeIds = nodes
                    .filter(node => !edges.some(edge => edge.target === node.id))
                    .map(node => node.id)
                if (sourceNodeIds.length === 0 && nodes.length > 0) {
                    sourceNodeIds = [nodes[0].id]
                }
                const lv: Record<string, number> = {}
                const queue: { id: string; level: number }[] = []
                sourceNodeIds.forEach(id => { lv[id] = 0; queue.push({ id, level: 0 }) })
                while (queue.length > 0) {
                    const { id, level } = queue.shift()!
                    const outgoing = edges.filter(e => e.source === id)
                    outgoing.forEach(e => {
                        const proposed = level + 1
                        if (!(e.target in lv)) { lv[e.target] = proposed; queue.push({ id: e.target, level: proposed }) }
                    })
                }
                return lv
            })()
            const s = params.source
            const t = params.target
            if (s && t && (levels[t] ?? 0) < (levels[s] ?? 0)) {
                // Disallow creating backward edge
                return
            }
            setEdges((eds) => {
                // prevent duplicates
                if (eds.some(e => e.source === params.source && e.target === params.target)) return eds
                const next = addEdge({ ...params, type: 'pulseBezier' as any }, eds)
                return dedupeEdges(next)
            })
            // self-organize after new connection
            setTimeout(() => autoLayoutRef.current?.(), 0)
        },
        [setEdges, dedupeEdges, nodes, edges],
    )

    // Start a connection from a node's source handle (right)
    const onConnectStart = useCallback<OnConnectStart>((_, params) => {
        // Reset connection state at the start of a drag
        connectionMadeRef.current = false
        if (params?.handleType === 'source' && params?.nodeId) {
            connectingNodeIdRef.current = params.nodeId
        } else {
            connectingNodeIdRef.current = null
        }
    }, [])

    // If dropped on empty pane, create a new node at drop position and connect
    const onConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
        const srcId = connectingNodeIdRef.current
        // Reset immediately to avoid stale state
        connectingNodeIdRef.current = null

        const targetEl = event.target as Element | null
        const droppedOnPane = !!(targetEl && (targetEl.classList?.contains('react-flow__pane') || targetEl.closest?.('.react-flow__pane')))
        // If we successfully connected to another node, do not create a new node
        if (connectionMadeRef.current) {
            return
        }
        if (!droppedOnPane || !srcId) return

        // Get cursor screen position
        let clientX = 0, clientY = 0
        if ('changedTouches' in event && event.changedTouches?.length) {
            clientX = event.changedTouches[0].clientX
            clientY = event.changedTouches[0].clientY
        } else if ('clientX' in event) {
            clientX = (event as MouseEvent).clientX
            clientY = (event as MouseEvent).clientY
        }

        const position = screenToFlowPosition({ x: clientX, y: clientY })
        const newId = `node-${Date.now()}`
        const newNode: Node = { id: newId, type: 'custom', position, data: { label: 'New node' } }
        // Seed the new node level to next column relative to the source to avoid same/previous level placement
        const currentLevels = (() => {
            let sourceNodeIds = nodes
                .filter(node => !edges.some(edge => edge.target === node.id))
                .map(node => node.id)
            if (sourceNodeIds.length === 0 && nodes.length > 0) {
                sourceNodeIds = [nodes[0].id]
            }
            const lv: Record<string, number> = {}
            const queue: { id: string; level: number }[] = []
            sourceNodeIds.forEach(id => { lv[id] = 0; queue.push({ id, level: 0 }) })
            while (queue.length > 0) {
                const { id, level } = queue.shift()!
                const outgoing = edges.filter(e => e.source === id)
                outgoing.forEach(e => {
                    const proposed = level + 1
                    if (!(e.target in lv)) { lv[e.target] = proposed; queue.push({ id: e.target, level: proposed }) }
                })
            }
            return lv
        })()
        const srcLevel = currentLevels[srcId] ?? 0
        stableLevelsRef.current = { ...stableLevelsRef.current, [newId]: srcLevel + 1 }
        setNodes((nds) => nds.concat(newNode))
        setEdges((eds) => dedupeEdges(addEdge({ id: `e-${srcId}-${newId}-${Date.now()}` as any, source: srcId, target: newId, type: 'pulseBezier' as any } as any, eds)))

        // Self-organize after creating new node and edge
        setTimeout(() => autoLayoutRef.current?.(), 0)
    }, [screenToFlowPosition, setNodes, setEdges, dedupeEdges])

    // sanitize duplicates if any appear (e.g., after external changes) without causing loops
    useEffect(() => {
        setEdges((eds) => {
            const seen = new Set<string>()
            let changed = false
            const result: Edge[] = []
            for (const e of eds) {
                const key = `${e.source}->${e.target}`
                if (seen.has(key)) {
                    changed = true
                    continue
                }
                seen.add(key)
                if (e.type !== ('bezier' as any)) {
                    changed = true
                    result.push({ ...e, type: 'bezier' as any })
                } else {
                    result.push(e)
                }
            }
            return changed ? result : eds
        })
    }, [setEdges])

    // Remove backward edges from state (defense-in-depth) without causing loops
    useEffect(() => {
        // inline BFS to compute minimal levels
        let sourceNodeIds = nodes
            .filter(node => !edges.some(edge => edge.target === node.id))
            .map(node => node.id)
        if (sourceNodeIds.length === 0 && nodes.length > 0) {
            sourceNodeIds = [nodes[0].id]
        }
        const levels: Record<string, number> = {}
        const queue: { id: string; level: number }[] = []
        sourceNodeIds.forEach(id => { levels[id] = 0; queue.push({ id, level: 0 }) })
        while (queue.length > 0) {
            const { id, level } = queue.shift()!
            const outgoing = edges.filter(e => e.source === id)
            outgoing.forEach(e => {
                const proposed = level + 1
                if (!(e.target in levels)) { levels[e.target] = proposed; queue.push({ id: e.target, level: proposed }) }
            })
        }
        let hasBackward = false
        for (const e of edges) {
            if ((levels[e.target] ?? 0) < (levels[e.source] ?? 0)) { hasBackward = true; break }
        }
        if (hasBackward) {
            setEdges((eds) => eds.filter(e => (levels[e.target] ?? 0) >= (levels[e.source] ?? 0)))
        }
    }, [nodes, edges, setEdges])

    const addNode = useCallback(() => {
        const newNode: Node = {
            id: `node-${Date.now()}`,
            type: 'custom',
            position: {
                x: Math.random() * 400 + 100,
                y: Math.random() * 300 + 100
            },
            data: { label: `New node` },
        }
        setNodes((nds) => nds.concat(newNode))
        // self-organize after add
        setTimeout(() => autoLayoutRef.current?.(), 0)
    }, [setNodes])

    // Initial layout on mount
    useEffect(() => {
        autoLayout()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Helper: compute levels with BFS then merge with stableLevels (non-decreasing)
    const computeLevels = useCallback(() => {
        // Find source nodes (nodes with no incoming edges). If none (cycle), pick first as fallback.
        let sourceNodeIds = nodes
            .filter(node => !edges.some(edge => edge.target === node.id))
            .map(node => node.id)
        if (sourceNodeIds.length === 0 && nodes.length > 0) {
            sourceNodeIds = [nodes[0].id]
        }

        const levels: Record<string, number> = {}
        const queue: { id: string; level: number }[] = []
        sourceNodeIds.forEach(id => {
            levels[id] = 0
            queue.push({ id, level: 0 })
        })
        while (queue.length > 0) {
            const { id, level } = queue.shift()!
            const outgoingEdges = edges.filter(edge => edge.source === id)
            outgoingEdges.forEach(edge => {
                const proposed = level + 1
                // Assign if not assigned yet (first pass); do not lower later
                if (!(edge.target in levels)) {
                    levels[edge.target] = proposed
                    queue.push({ id: edge.target, level: proposed })
                }
            })
        }

        // Merge with stable levels to avoid decreasing a node's column
        const merged: Record<string, number> = {}
        nodes.forEach(n => {
            const computed = levels[n.id] ?? 0
            const prev = stableLevelsRef.current[n.id]
            const finalLevel = prev != null ? Math.max(prev, computed) : computed
            merged[n.id] = finalLevel
        })
        stableLevelsRef.current = { ...stableLevelsRef.current, ...merged }
        return merged
    }, [nodes, edges])

    // Calculate current layout data for grid display using BFS levels and d3-hierarchy ordering per level
    // Also assign centered row indices per column so sparse columns are vertically centered.
    const getLayoutData = useCallback(() => {
        const levels = computeLevels()

        // Group nodes by level preliminarily
        const nodesByLevel: { [level: number]: Node[] } = {}
        nodes.forEach(node => {
            const level = levels[node.id] ?? 0
            if (!nodesByLevel[level]) nodesByLevel[level] = []
            nodesByLevel[level].push(node)
        })

        // Use d3-hierarchy to compute a tidy order within levels to reduce crossings
        try {
            // Build children map from edges
            const childrenMap = new Map<string, Set<string>>()
            nodes.forEach(n => childrenMap.set(n.id, new Set<string>()))
            edges.forEach(e => {
                if (childrenMap.has(e.source)) childrenMap.get(e.source)!.add(e.target)
            })

            // Build forest roots
            // Roots are the minimum-level nodes
            const minLevel = Math.min(...Object.values(levels))
            const roots = nodes.filter(n => (levels[n.id] ?? 0) === minLevel).map(n => n.id)
            const visited = new Set<string>()

            const buildTree = (id: string): any => {
                if (visited.has(id)) return { id, children: [] }
                visited.add(id)
                const children = Array.from(childrenMap.get(id) || [])
                    .filter(cid => levels[cid] === (levels[id] ?? 0) + 1)
                    .map(cid => buildTree(cid))
                return { id, children }
            }

            const forestChildren: D3Node[] = roots.map(r => buildTree(r))
            const superRoot: D3Node = { id: '__root__', children: forestChildren }
            const root = hierarchy<D3Node>(superRoot, d => d.children || [])
            const layoutTree = tree<D3Node>().separation((a, b) => (a.parent === b.parent ? 1 : 2))
            const laidOut = layoutTree(root)
            const xById = new Map<string, number>()
            laidOut.descendants().forEach((d: HierarchyNode<D3Node>) => {
                const nid = d.data.id
                if (nid && nid !== '__root__') {
                    xById.set(nid, d.x ?? 0)
                }
            })

            // Reorder nodes in each level by x
            Object.keys(nodesByLevel).forEach(lvlStr => {
                const lvl = Number(lvlStr)
                nodesByLevel[lvl].sort((a, b) => {
                    const xa = xById.get(a.id)
                    const xb = xById.get(b.id)
                    if (xa == null && xb == null) return a.id.localeCompare(b.id)
                    if (xa == null) return 1
                    if (xb == null) return -1
                    return xa - xb
                })
            })
        } catch (e) {
            // If anything fails, keep original order
            // no-op
        }

        // Calculate max rows across all columns
        const maxRows = Math.max(...Object.values(nodesByLevel).map(nodes => nodes.length), 1)

        // Center nodes within each column by assigning row indices with an offset
        const rowIndexByNode: Record<string, number> = {}
        Object.keys(nodesByLevel).forEach((lvlStr) => {
            const lvl = Number(lvlStr)
            const colNodes = nodesByLevel[lvl]
            const count = colNodes.length
            const offset = Math.floor((maxRows - count) / 2)
            colNodes.forEach((n, idx) => {
                rowIndexByNode[n.id] = offset + idx
            })
        })

        // Precompute per-level net height: sum of node heights in that column + vertical padding between them
        const levelNetHeights: Record<number, number> = {}
        Object.keys(nodesByLevel).map(Number).forEach(level => {
            const nodesInLevel = nodesByLevel[level]
            if (!nodesInLevel || nodesInLevel.length === 0) {
                levelNetHeights[level] = 0
                return
            }
            const heights = nodesInLevel.map(n => getNodeSize(n).height)
            const sumHeights = heights.reduce((a, b) => a + b, 0)
            const gaps = Math.max(0, nodesInLevel.length - 1) * nodePadding
            levelNetHeights[level] = sumHeights + gaps
        })

        // Calculate column positions and widths with dynamic spacing relative to next column's net height
        const columnData: { [level: number]: { x: number; width: number } } = {}
        let currentX = 50 // Starting X position

        const sortedLevels = Object.keys(nodesByLevel).map(Number).sort((a, b) => a - b)
        sortedLevels.forEach((level, idx) => {
            const nodesInLevel = nodesByLevel[level]
            const nodeWidths = nodesInLevel.map(node => getNodeSize(node).width)
            const maxNodeWidth = Math.max(...nodeWidths, 120)
            const columnWidth = maxNodeWidth + columnPadding

            columnData[level] = { x: currentX, width: columnWidth }

            // Spacing to next column depends on the larger of current/next column net heights scaled by spacingFactor
            const nextLevel = sortedLevels[idx + 1]
            const nextNet = nextLevel != null ? (levelNetHeights[nextLevel] ?? 0) : 0
            const curNet = levelNetHeights[level] ?? 0
            const dynamicSpacing = Math.round(Math.max(curNet, nextNet) * spacingFactor)
            currentX += columnWidth + (nextLevel != null ? dynamicSpacing : 0)
        })

        return { columnData, nodesByLevel, maxNodesInAnyLevel: Math.max(...Object.values(nodesByLevel).map(nodes => nodes.length)), rowIndexByNode }
    }, [nodes, edges, nodePadding, columnPadding, spacingFactor, getNodeSize, computeLevels])

    // Calculate row heights based on tallest node in each row
    const getRowHeights = useCallback(() => {
        const { nodesByLevel } = getLayoutData()
        const maxRows = Math.max(...Object.values(nodesByLevel).map(nodes => nodes.length))
        const rowHeights: number[] = []

        for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
            let tallestInRow = 40 // Minimum height

            // Check all columns for this row index
            Object.values(nodesByLevel).forEach(levelNodes => {
                const n = levelNodes[rowIndex]
                if (n) {
                    const { height } = getNodeSize(n)
                    tallestInRow = Math.max(tallestInRow, height)
                }
            })

            rowHeights[rowIndex] = tallestInRow
        }

        return rowHeights
    }, [getLayoutData, getNodeSize])

    const autoLayout = useCallback(() => {
        const levels = computeLevels()

        // Reuse layout data (which uses measured sizes and d3 ordering)
        const { columnData, rowIndexByNode } = getLayoutData()

        // Position nodes
        setNodes((nds) =>
            nds.map(node => {
                const level = levels[node.id] ?? 0
                // Use centered row index assigned by getLayoutData so sparse columns are vertically centered
                const nodeIndex = rowIndexByNode[node.id] ?? 0
                const column = columnData[level]

                // Prefer measured node size for exact centering
                const { width: nodeWidth, height: nodeHeight } = getNodeSize(node)

                // Get row heights data
                const rowHeights = getRowHeights()
                const tallestHeightInRow = rowHeights[nodeIndex] || nodeHeight

                // Calculate Y position: sum of all previous row heights + current row center
                const baseY = 100
                let cumulativeY = baseY
                for (let i = 0; i < nodeIndex; i++) {
                    cumulativeY += (rowHeights[i] || 40) + nodePadding
                }

                const rowCenterY = cumulativeY + tallestHeightInRow / 2 // Center of the current row
                const centerY = rowCenterY - nodeHeight / 2 // Position node so its center aligns with row center

                // Calculate X position: center the node within the column width
                // React Flow positions by top-left corner, so offset by half node width to center it
                const columnCenterX = column ? column.x + column.width / 2 : 50
                const centerX = columnCenterX - nodeWidth / 2 // Offset by half node width to center the node

                return {
                    ...node,
                    position: {
                        x: centerX,
                        y: centerY
                    }
                }
            })
        )
    }, [nodes, edges, setNodes, nodePadding, columnPadding, getLayoutData, getRowHeights, getNodeSize, computeLevels])

    // keep ref updated
    useEffect(() => {
        autoLayoutRef.current = autoLayout
    }, [autoLayout])

    // Initial layout on mount
    useEffect(() => {
        setTimeout(() => autoLayoutRef.current?.(), 0)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
        <div className="min-h-screen bg-gray-950">
            <style>{`
        /* Fiber optic base: soft neon blue with outer glow */
        .edge-fiber {
          stroke: #3b82f6; /* blue-500 */
          stroke-width: 2.5;
          stroke-linejoin: round;
          stroke-linecap: round;
          filter: drop-shadow(0 0 2px rgba(59,130,246,0.8)) drop-shadow(0 0 6px rgba(59,130,246,0.5));
        }

        /* Animated bright pulse traveling along the fiber */
        .edge-pulse {
          stroke: #93c5fd; /* blue-300 */
          stroke-width: 3.5;
          stroke-linecap: round;
          stroke-linejoin: round;
          stroke-dasharray: 24 600; /* short bright pulse followed by long gap */
          animation: edgePulse forwards linear infinite 2.4s;
          filter: drop-shadow(0 0 4px rgba(147,197,253,0.9)) drop-shadow(0 0 10px rgba(59,130,246,0.8));
          mix-blend-mode: screen; /* enhance glow on dark bg */
        }

        /* Distinct color for forward overrun (skips columns) */
        .edge-pulse.edge-pulse--overrun {
          stroke: #22d3ee; /* cyan-400 */
          filter: drop-shadow(0 0 6px rgba(34,211,238,0.95)) drop-shadow(0 0 12px rgba(34,211,238,0.75));
          animation-duration: 2s; /* slightly faster */
        }

        /* Reverse direction for backward edges */
        .edge-pulse-backward {
          animation-name: edgePulseReverse;
        }

        /* Pulse travels from path start (source right handle) to end (target left handle) */
        @keyframes edgePulse { 
          0% { stroke-dashoffset: 0; opacity: 0.9; }
          50% { opacity: 1; }
          100% { stroke-dashoffset: -620; opacity: 0.9; }
        }

        /* Reverse: from end toward start */
        @keyframes edgePulseReverse {
          0% { stroke-dashoffset: -620; opacity: 0.9; }
          50% { opacity: 1; }
          100% { stroke-dashoffset: 0; opacity: 0.9; }
        }
      `}</style>
            {/* Header (fixed overlay) */}
            <div className="fixed inset-x-0 top-0 z-20 bg-gray-900/80 border-b border-gray-800 backdrop-blur">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-16">
                        <div className="flex items-center space-x-4">
                            <h1 className="text-xl font-semibold text-yellow-400">
                                Workflow Designer
                            </h1>
                        </div>
                        <div className="flex items-center space-x-4">
                            <button
                                onClick={addNode}
                                className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 px-4 py-2 rounded-md text-sm font-medium"
                            >
                                Add Node
                            </button>
                            {/* Auto Layout button removed as per request */}
                            <button
                                onClick={() => setShowConfig(true)}
                                className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-md text-sm font-medium"
                            >
                                ⚙️ Config
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Full-screen ReactFlow canvas */}
            {(() => {
                // Compute layout and row heights for edge routing data
                const layoutData = getLayoutData()
                const rowHeights = getRowHeights()

                // Build map from node id to (colIndex, rowIndex)
                const nodeIndexMap = new Map<string, { col: number; row: number }>()
                Object.entries(layoutData.nodesByLevel).forEach(([lvlStr, levelNodes]) => {
                    const col = Number(lvlStr)
                    levelNodes.forEach((n) => {
                        const row = layoutData.rowIndexByNode?.[n.id] ?? 0
                        nodeIndexMap.set(n.id, { col, row })
                    })
                })

                const sanitized = dedupeEdges(edges)

                // Build per-node side channels: source (right) and target (left)
                const outgoingByNode = new Map<string, Edge[]>()
                const incomingByNode = new Map<string, Edge[]>()
                sanitized.forEach((e) => {
                    if (!outgoingByNode.has(e.source)) outgoingByNode.set(e.source, [])
                    if (!incomingByNode.has(e.target)) incomingByNode.set(e.target, [])
                    outgoingByNode.get(e.source)!.push(e)
                    incomingByNode.get(e.target)!.push(e)
                })
                // Sort edges on each side by opposite row, ensure stable order
                outgoingByNode.forEach((arr) => {
                    arr.sort((a, b) => {
                        const ta = nodeIndexMap.get(a.target)!, tb = nodeIndexMap.get(b.target)!
                        return ta.row - tb.row || a.id.localeCompare(b.id)
                    })
                })
                incomingByNode.forEach((arr) => {
                    arr.sort((a, b) => {
                        const sa = nodeIndexMap.get(a.source)!, sb = nodeIndexMap.get(b.source)!
                        return sa.row - sb.row || a.id.localeCompare(b.id)
                    })
                })

                // Precompute row bottoms and lane positions (lane below each row)
                const rowBottoms: number[] = []
                {
                    let cumulative = 100
                    for (let i = 0; i < rowHeights.length; i++) {
                        const bottom = cumulative + rowHeights[i]
                        rowBottoms[i] = bottom
                        cumulative = bottom + nodePadding
                    }
                }
                const laneYBelowRow = (rowIndex: number) => rowBottoms[rowIndex] + nodePadding / 2

                const derivedEdges = sanitized.map((e) => {
                    const s = nodeIndexMap.get(e.source)
                    const t = nodeIndexMap.get(e.target)
                    const isBackwards = !!(s && t && t.col < s.col)
                    let isForwardOverrun = false
                    let arcY: number | undefined
                    let arcXMid: number | undefined
                    if (s && t) {
                        const colGap = Math.abs(s.col - t.col)
                        const sameRow = s.row === t.row
                        if (!isBackwards && sameRow && colGap > 1) {
                            isForwardOverrun = true
                        } else if (!isBackwards && !sameRow && colGap > 1) {
                            isForwardOverrun = true
                        }
                        // If skipping at least one column forward, arc above the entire intermediate column(s)
                        if (!isBackwards && colGap > 1) {
                            // Compute a Y above all rows: base (100) minus lift
                            const totalHeight = rowHeights.reduce((sum, h) => sum + h, 0) + nodePadding * (rowHeights.length - 1)
                            const topY = 100
                            // Base lift above the top by 20% of total height, min 80px
                            const baseLift = Math.max(80, totalHeight * 0.2)
                            // Extra lift per additional skipped column to keep farther targets arcing higher
                            const avgRow = rowHeights.length ? (rowHeights.reduce((a, b) => a + b, 0) / rowHeights.length) : 60
                            const extraLift = (colGap - 1) * Math.max(40, avgRow * 0.5)
                            arcY = Math.max(topY - (baseLift + extraLift), 20)
                            // Apex X: center between source and target X column centers
                            const sCol = layoutData.columnData[s.col]
                            const tCol = layoutData.columnData[t.col]
                            if (sCol && tCol) {
                                const sCenter = sCol.x + sCol.width / 2
                                const tCenter = tCol.x + tCol.width / 2
                                arcXMid = (sCenter + tCenter) / 2
                            }
                        }
                    }

                    return {
                        ...e,
                        type: 'pulseBezier' as any,
                        data: { isBackwards, isForwardOverrun, arcY, arcXMid },
                    }
                })

                return (
                    <div className="fixed inset-0">
                        <ReactFlow
                            nodes={nodes}
                            edges={derivedEdges}
                            onNodesChange={onNodesChange}
                            onEdgesChange={onEdgesChange}
                            onConnect={onConnect}
                            onConnectStart={onConnectStart}
                            onConnectEnd={onConnectEnd}
                            onNodeDragStop={() => {
                                if (!lockNodes) setTimeout(() => autoLayoutRef.current?.(), 0)
                            }}
                            nodeTypes={nodeTypes}
                            edgeTypes={edgeTypes}
                            className="bg-gray-950"
                            nodesDraggable={!lockNodes}
                            panOnDrag={true}
                            zoomOnScroll={true}
                            zoomOnPinch={true}
                            zoomOnDoubleClick={true}
                            minZoom={0.25}
                            maxZoom={1.75}
                            proOptions={{ hideAttribution: true }}
                        >
                            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#334155" />
                            <Controls className="bg-gray-800 border-gray-700" />
                        </ReactFlow>
                    </div>
                )
            })()}

            {/* Configuration Modal */}
            {showConfig && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-96">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-semibold text-yellow-400">Configuration</h2>
                            <button
                                onClick={() => setShowConfig(false)}
                                className="text-gray-400 hover:text-gray-200"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="flex items-center space-x-2">
                                    <input
                                        type="checkbox"
                                        checked={lockNodes}
                                        onChange={(e) => setLockNodes(e.target.checked)}
                                        className="rounded border-gray-600 text-yellow-400 focus:ring-yellow-400"
                                    />
                                    <span className="text-sm font-medium text-gray-200">Lock Nodes (disable dragging)</span>
                                </label>
                                <p className="text-xs text-gray-400 mt-1">
                                    Keep nodes positioned by auto-layout. Uncheck to allow dragging (will re-snap on release).
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-200 mb-2">
                                    Node Padding (pixels)
                                </label>
                                <input
                                    type="number"
                                    value={nodePadding}
                                    onChange={(e) => setNodePadding(Number(e.target.value))}
                                    min="10"
                                    max="200"
                                    className="w-full bg-gray-800 text-gray-200 border border-gray-600 hover:border-yellow-400 focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 px-3 py-2 rounded-md"
                                />
                                <p className="text-xs text-gray-400 mt-1">
                                    Vertical spacing between nodes in same column (10-200px)
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-200 mb-2">
                                    Column Spacing Factor
                                </label>
                                <input
                                    type="range"
                                    value={spacingFactor}
                                    onChange={(e) => setSpacingFactor(Number(e.target.value))}
                                    min="0.1"
                                    max="0.6"
                                    step="0.05"
                                    className="w-full"
                                />
                                <p className="text-xs text-gray-400 mt-1">
                                    Spacing = next column net height × factor (0.10–0.60). Current: {Math.round(spacingFactor * 100)}%
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-200 mb-2">
                                    Column Padding (pixels)
                                </label>
                                <input
                                    type="number"
                                    value={columnPadding}
                                    onChange={(e) => setColumnPadding(Number(e.target.value))}
                                    min="20"
                                    max="100"
                                    className="w-full bg-gray-800 text-gray-200 border border-gray-600 hover:border-yellow-400 focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 px-3 py-2 rounded-md"
                                />
                                <p className="text-xs text-gray-400 mt-1">
                                    Extra padding around widest node in column (20-100px)
                                </p>
                            </div>
                        </div>

                        <div className="flex justify-end space-x-3 mt-6">
                            <button
                                onClick={() => setShowConfig(false)}
                                className="bg-gray-700 hover:bg-gray-600 text-gray-200 px-4 py-2 rounded-md text-sm font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => {
                                    autoLayout()
                                    setShowConfig(false)
                                }}
                                className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 px-4 py-2 rounded-md text-sm font-medium"
                            >
                                Apply & Layout
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// Wrapper component with ReactFlow provider
export default function WorkflowPage() {
    return (
        <ReactFlowProvider>
            <WorkflowContent />
        </ReactFlowProvider>
    )
}
