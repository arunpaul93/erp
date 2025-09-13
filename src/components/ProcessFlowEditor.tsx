"use client"

import React, { useCallback, useEffect, useState, useRef, useImperativeHandle, useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import { supabase } from '@/lib/supabase'
import ReactFlow, {
    Controls,
    Background,
    Handle,
    Position,
    useReactFlow,
    useNodesState,
    useEdgesState,
    addEdge,
    getBezierPath,
    Connection,
    Edge,
    Node,
    EdgeProps,
    NodeProps,
    OnConnectStartParams,
    ConnectionLineType,
    ReactFlowProvider
} from 'reactflow'
import 'reactflow/dist/style.css'

const GRID_SIZE = 16

// Simple UUID v4 generator (fallback without external deps)
function uuidv4() {
    // Source: RFC4122 compliant enough for client IDs
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
    })
}

// Interfaces for Supabase data
interface ProcessStepData {
    id: string
    organisation_id: string | null
    name: string
    description?: string | null
    metadata?: any
    parent_step_id?: string | null
}

// Internal shape used within React Flow node.data.stepData (aligning with ProcessStepData but with non-null organisation_id and name as label)
interface ProcessStep extends Omit<ProcessStepData, 'name' | 'organisation_id'> {
    organisation_id: string
    label?: string
}

interface ProcessFlowEdgeData {
    id: string
    organisation_id: string | null
    from_step_id: string
    to_step_id: string
    metadata?: any
    label?: string | null
}

// Custom Node Component
function ProcessStepNode({ data, selected }: NodeProps) {
    const isParentNode = data.stepData?.metadata?.hasSubProcesses || false
    const isSubProcess = !!data.stepData?.parent_step_id
    const size = data.stepData?.metadata?.size || { width: 420, height: 300 }

    if (isParentNode) {
        // Parent node acts as a container; make its body non-interactive so edges underneath are clickable
        return (
            <div
                className={`rounded-lg border-2 ${selected ? 'border-yellow-400' : 'border-gray-600'} hover:border-yellow-400 transition-colors relative pointer-events-none`}
                style={{ width: size.width, height: size.height, overflow: 'visible', background: 'none', zIndex: 0 }}
            >
                {/* Left target/source overlapped (show as single dot) */}
                <Handle id="left-target" type="target" position={Position.Left} className="w-3 h-3 bg-yellow-400 pointer-events-auto" style={{ zIndex: 10 }} />
                <Handle id="left-source" type="source" position={Position.Left} className="w-3 h-3 bg-yellow-400 parent-left-source pointer-events-auto" style={{ zIndex: 11 }} />
                    <div className="absolute inset-0 flex flex-col pointer-events-none">
                        <div
                            className="px-3 py-2 text-center pointer-events-auto"
                        >
                            <div className="font-medium text-gray-100 leading-tight truncate">{data.label}</div>
                        {data.description && (
                                <div className="text-[10px] text-gray-400 mt-0.5 line-clamp-2">{data.description}</div>
                        )}
                    </div>
                    <div className="flex-1 relative nodrag nopan nowheel pointer-events-none" style={{ zIndex: 0 }}>
                        {/* Child nodes render here via React Flow; no embedded DOM needed */}
                        {/* Resize handle (bottom-right) */}
                        <div
                            role="button"
                            aria-label="Resize"
                            title="Resize"
                            onPointerDown={(e) => {
                                e.preventDefault(); e.stopPropagation();
                                try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
                                const startX = e.clientX; const startY = e.clientY
                                const startW = data.stepData?.metadata?.size?.width || 420
                                const startH = data.stepData?.metadata?.size?.height || 300
                                const MIN_W = 300; const MIN_H = 200
                                const onMove = (ev: PointerEvent) => {
                                    ev.preventDefault()
                                    const w = Math.max(MIN_W, startW + (ev.clientX - startX))
                                    const h = Math.max(MIN_H, startH + (ev.clientY - startY))
                                    // Update live (visual) via callback if provided
                                    data.onResize?.({ width: w, height: h })
                                }
                                const onUp = (ev: PointerEvent) => {
                                    ev.preventDefault()
                                    window.removeEventListener('pointermove', onMove)
                                    window.removeEventListener('pointerup', onUp)
                                    const w = Math.max(MIN_W, startW + (ev.clientX - startX))
                                    const h = Math.max(MIN_H, startH + (ev.clientY - startY))
                                    data.onResizeEnd?.({ width: w, height: h })
                                }
                                window.addEventListener('pointermove', onMove)
                                window.addEventListener('pointerup', onUp)
                            }}
                            className="absolute bottom-1 right-1 w-4 h-4 bg-yellow-500 rounded-sm cursor-nwse-resize shadow border border-yellow-400 pointer-events-auto"
                            style={{ zIndex: 3, pointerEvents: 'auto' }}
                        />
                    </div>
                </div>
                {/* Right target/source overlapped */}
                <Handle id="right-target" type="target" position={Position.Right} className="w-3 h-3 bg-yellow-400 pointer-events-auto" style={{ zIndex: 10 }} />
                <Handle id="right-source" type="source" position={Position.Right} className="w-3 h-3 bg-yellow-400 pointer-events-auto" style={{ zIndex: 11 }} />
            </div>
        )
    }
    // Unified node rendering for both regular and sub-process nodes
    return (
        <div className={`px-4 py-3 shadow-lg rounded-lg bg-gray-800 border-2 ${selected ? 'border-yellow-400' : 'border-gray-600'} hover:border-yellow-400 transition-colors min-w-[150px]`}>
            <Handle id="left-target" type="target" position={Position.Left} className="w-3 h-3 bg-yellow-400" style={{ zIndex: 1 }} />
            <div className="font-medium text-gray-100">{data.label}</div>
            {data.description && (
                <div className="text-xs text-gray-400 mt-1">{data.description}</div>
            )}
            <Handle id="left-source" type="source" position={Position.Left} className="w-3 h-3 bg-yellow-400" style={{ zIndex: 2 }} />
            <Handle id="right-source" type="source" position={Position.Right} className="w-3 h-3 bg-yellow-400" />
        </div>
    )
}

// Custom Edge Component with n8n-style Bézier curves
const N8nStyleBezierEdge = ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    data,
    markerEnd,
    selected
}: EdgeProps) => {
    // Check if this is a backward connection (target is to the left of source)
    const isBackwardConnection = targetX < sourceX
    
    const createPath = () => {
        if (isBackwardConnection) {
            // Line with smooth Bezier curve bends for backward connections
            const midY = sourceY + (targetY - sourceY) / 2
            const offsetX = 30 // Distance to extend before bending
            const curveLength = 15 // Length of Bezier curve transition
            
            // Calculate bend positions
            const bend1X = sourceX + offsetX
            const bend1Y = sourceY
            const bend2X = sourceX + offsetX
            const bend2Y = midY
            const bend3X = targetX - offsetX
            const bend3Y = midY
            const bend4X = targetX - offsetX
            const bend4Y = targetY
            
            // Direction helpers
            const verticalDirection = midY > sourceY ? 1 : -1
            const horizontalDirection = targetX < sourceX ? -1 : 1
            const finalVerticalDirection = targetY > midY ? 1 : -1
            
            return `M ${sourceX},${sourceY} 
                    L ${bend1X - curveLength},${bend1Y}
                    C ${bend1X - curveLength/3},${bend1Y} ${bend1X},${bend1Y} ${bend1X},${bend1Y + curveLength * verticalDirection}
                    L ${bend2X},${bend2Y - curveLength * verticalDirection}
                    C ${bend2X},${bend2Y - curveLength/3 * verticalDirection} ${bend2X},${bend2Y} ${bend2X + curveLength * horizontalDirection},${bend2Y}
                    L ${bend3X - curveLength * horizontalDirection},${bend3Y}
                    C ${bend3X - curveLength/3 * horizontalDirection},${bend3Y} ${bend3X},${bend3Y} ${bend3X},${bend3Y + curveLength * finalVerticalDirection}
                    L ${bend4X},${bend4Y - curveLength * finalVerticalDirection}
                    C ${bend4X},${bend4Y - curveLength/3 * finalVerticalDirection} ${bend4X},${bend4Y} ${bend4X + curveLength},${bend4Y}
                    L ${targetX},${targetY}`
        } else {
            // Curved path for forward connections
            const deltaX = targetX - sourceX
            const deltaY = targetY - sourceY
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
            
            // Use a more conservative control point distance
            // This creates gentler curves that won't bend sharply
            const controlDistance = Math.min(Math.abs(deltaX) * 0.6, distance * 0.4, 150)
            
            // Ensure control points are always at least 50px away from handles
            const sourceControlX = sourceX + Math.max(controlDistance, 50)
            const targetControlX = targetX - Math.max(controlDistance, 50)
            
            return `M ${sourceX},${sourceY} C ${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`
        }
    }
    
    const edgePath = createPath()
    const labelX = sourceX + (targetX - sourceX) / 2
    const labelY = sourceY + (targetY - sourceY) / 2
    
    const markerId = `arrow-${id}`
    return (
        <g>
            <defs>
                <marker
                    id={markerId}
                    markerWidth={8}
                    markerHeight={8}
                    refX={4}
                    refY={4}
                    orient="auto"
                    markerUnits="strokeWidth"
                >
                    {/** Smaller arrow: tip at x=4 touches handle, base at x=0 */}
                    <path
                        d="M0,1 L0,7 L4,4 z"
                        fill={selected ? '#ff6b6b' : '#b1b1b7'}
                        stroke={selected ? '#ff6b6b' : '#b1b1b7'}
                    />
                </marker>
            </defs>
            <path
                id={id}
                data-id={id}
                style={{
                    ...style,
                    pointerEvents: 'visibleStroke',
                    strokeWidth: selected ? 5 : 4,
                    stroke: selected ? '#ff6b6b' : '#b1b1b7',
                    fill: 'none',
                    zIndex: 5
                }}
                className="react-flow__edge-path"
                d={edgePath}
                markerEnd={`url(#${markerId})`}
            />
            {/* Invisible thicker stroke for easier clicking; keep class so RF delegates events */}
            <path
                data-id={id}
                className="react-flow__edge-path"
                style={{
                    pointerEvents: 'stroke',
                    strokeWidth: 14,
                    stroke: 'transparent',
                    fill: 'none'
                }}
                d={edgePath}
            />
            {data?.label && (
                <text
                    x={labelX}
                    y={labelY}
                    style={{
                        fontSize: '12px',
                        fill: '#ccc',
                        textAnchor: 'middle',
                        dominantBaseline: 'middle',
                        pointerEvents: 'none'
                    }}
                >
                    {data.label}
                </text>
            )}
        </g>
    )
}

// Custom Connection Line
const N8nConnectionLine = ({ fromX, fromY, toX, toY }: any) => {
    // Check if this is a backward connection (target is to the left of source)
    const isBackwardConnection = toX < fromX
    
    const createPath = () => {
        if (isBackwardConnection) {
            // Line with smooth Bezier curve bends for backward connections
            const midY = fromY + (toY - fromY) / 2
            const offsetX = 30 // Distance to extend before bending
            const curveLength = 15 // Length of Bezier curve transition
            
            // Calculate bend positions
            const bend1X = fromX + offsetX
            const bend1Y = fromY
            const bend2X = fromX + offsetX
            const bend2Y = midY
            const bend3X = toX - offsetX
            const bend3Y = midY
            const bend4X = toX - offsetX
            const bend4Y = toY
            
            // Direction helpers
            const verticalDirection = midY > fromY ? 1 : -1
            const horizontalDirection = toX < fromX ? -1 : 1
            const finalVerticalDirection = toY > midY ? 1 : -1
            
            return `M ${fromX},${fromY} 
                    L ${bend1X - curveLength},${bend1Y}
                    C ${bend1X - curveLength/3},${bend1Y} ${bend1X},${bend1Y} ${bend1X},${bend1Y + curveLength * verticalDirection}
                    L ${bend2X},${bend2Y - curveLength * verticalDirection}
                    C ${bend2X},${bend2Y - curveLength/3 * verticalDirection} ${bend2X},${bend2Y} ${bend2X + curveLength * horizontalDirection},${bend2Y}
                    L ${bend3X - curveLength * horizontalDirection},${bend3Y}
                    C ${bend3X - curveLength/3 * horizontalDirection},${bend3Y} ${bend3X},${bend3Y} ${bend3X},${bend3Y + curveLength * finalVerticalDirection}
                    L ${bend4X},${bend4Y - curveLength * finalVerticalDirection}
                    C ${bend4X},${bend4Y - curveLength/3 * finalVerticalDirection} ${bend4X},${bend4Y} ${bend4X + curveLength},${bend4Y}
                    L ${toX},${toY}`
        } else {
            // Curved path for forward connections
            const deltaX = toX - fromX
            const deltaY = toY - fromY
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
            
            // Use a more conservative control point distance
            // This creates gentler curves that won't bend sharply
            const controlDistance = Math.min(Math.abs(deltaX) * 0.6, distance * 0.4, 150)
            
            // Ensure control points are always at least 50px away from handles
            const sourceControlX = fromX + Math.max(controlDistance, 50)
            const targetControlX = toX - Math.max(controlDistance, 50)
            
            return `M ${fromX},${fromY} C ${sourceControlX},${fromY} ${targetControlX},${toY} ${toX},${toY}`
        }
    }
    
    const edgePath = createPath()
    const markerId = `connection-arrow`

    return (
        <g>
            <defs>
                <marker
                    id={markerId}
                    markerWidth={8}
                    markerHeight={8}
                    refX={4}
                    refY={4}
                    orient="auto"
                    markerUnits="strokeWidth"
                >
                    <path
                        d="M0,1 L0,7 L4,4 z"
                        fill="#b1b1b7"
                        stroke="#b1b1b7"
                    />
                </marker>
            </defs>
            <path
                fill="none"
                stroke="#b1b1b7"
                strokeWidth={2}
                style={{ pointerEvents: 'visibleStroke' }}
                d={edgePath}
                markerEnd={`url(#${markerId})`}
            />
        </g>
    )
}

const nodeTypes = {
    processStep: ProcessStepNode,
}

const edgeTypes = {
    'n8n-bezier': N8nStyleBezierEdge,
}

interface ProcessFlowEditorProps {
    height?: number
    className?: string
    onSave?: () => void
    hideToolbar?: boolean
    ref?: React.Ref<{ saveProcessFlow: () => Promise<void> }>
}

const ProcessFlowEditorInner = React.forwardRef<
    { saveProcessFlow: () => Promise<void> },
    ProcessFlowEditorProps
>(({
    height = 600,
    className = '',
    onSave,
    hideToolbar = false
}, ref) => {
    const { user } = useAuth()
    const { selectedOrgId } = useOrg()
    const reactFlowInstance = useReactFlow()

    const [nodes, setNodes, defaultOnNodesChange] = useNodesState([])
    const [edges, setEdges, onEdgesChange] = useEdgesState([])

    // State declarations first
    const [organisationId] = useState<string>(selectedOrgId || 'c6b0261b-690f-4c43-9b79-3426a7b97804') // Use actual org or fallback
        // Recompute parent node sizes based on child bounds
    const recomputeParentSizes = useCallback((currentNodes: Node[]): Node[] => {
            const UPDATED_PADDING = { x: 24, y: 64 } // side + header
            const FALLBACK_CHILD_SIZE = { w: 150, h: 60 }

            const childrenByParent: Record<string, Node[]> = {}
            currentNodes.forEach(n => {
                if (n.parentNode) {
                    if (!childrenByParent[n.parentNode]) childrenByParent[n.parentNode] = []
                    childrenByParent[n.parentNode].push(n)
                }
            })

            return currentNodes.map(node => {
                const kids = childrenByParent[node.id] || []
                const hasChildrenFlag = !!(node as any).data?.stepData?.metadata?.hasSubProcesses
                const isParent = hasChildrenFlag || kids.length > 0
                if (!isParent) return node

        if (kids.length === 0) {
                    const defaultWidth = 420
                    const defaultHeight = 300
                    return {
                        ...node,
            style: { ...(node.style || {}), width: defaultWidth, height: defaultHeight, pointerEvents: 'none' },
                        data: {
                            ...node.data,
                            stepData: {
                                ...node.data.stepData,
                                metadata: { ...(node.data.stepData?.metadata || {}), size: { width: defaultWidth, height: defaultHeight } }
                            }
                        }
                    }
                }

                let maxX = 0, maxY = 0
                kids.forEach(c => {
                    const cw = (c as any).width || FALLBACK_CHILD_SIZE.w
                    const ch = (c as any).height || FALLBACK_CHILD_SIZE.h
                    maxX = Math.max(maxX, c.position.x + cw)
                    maxY = Math.max(maxY, c.position.y + ch)
                })

                const contentMinWidth = Math.max(420, maxX + UPDATED_PADDING.x)
                const contentMinHeight = Math.max(300, maxY + UPDATED_PADDING.y)
                const curSize = (node as any).data?.stepData?.metadata?.size || {}
                const desiredWidth = Math.max(curSize.width || 420, contentMinWidth)
                const desiredHeight = Math.max(curSize.height || 300, contentMinHeight)
                if (curSize.width === desiredWidth && curSize.height === desiredHeight) return node

                return {
                    ...node,
                    style: { ...(node.style || {}), width: desiredWidth, height: desiredHeight, pointerEvents: 'none' },
                    data: {
                        ...node.data,
                        stepData: {
                            ...node.data.stepData,
                            metadata: { ...(node.data.stepData?.metadata || {}), size: { width: desiredWidth, height: desiredHeight } }
                        }
                    }
                }
            })
        }, [])

        // Effect: whenever nodes change, recompute parent sizes
        useEffect(() => {
            const timer = setTimeout(() => {
                setNodes(old => {
                    const updated = recomputeParentSizes(old)
                    return updated
                })
            }, 10)
            return () => clearTimeout(timer)
        }, [recomputeParentSizes, setNodes])
    const [originalSteps, setOriginalSteps] = useState<ProcessStepData[]>([])
    const [originalEdges, setOriginalEdges] = useState<ProcessFlowEdgeData[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [lastSaved, setLastSaved] = useState<Date | null>(null)
    const [selectedNode, setSelectedNode] = useState<Node | null>(null)
    const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
    const [editingEdge, setEditingEdge] = useState<string | null>(null)
    const [contextMenu, setContextMenu] = useState<{
        visible: boolean
        x: number
        y: number
        type: 'node' | 'edge' | null
        target: Node | null
        edgeId?: string
    }>({
        visible: false,
        x: 0,
        y: 0,
        type: null,
        target: null
    })
    const containerRef = useRef<HTMLDivElement | null>(null)
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const subConnectRef = useRef<null | { parentId: string; fromSubId: string; side: 'left'|'right'; preview?: { x: number; y: number } }>(null)
    // Track if a real connection completed to avoid accidental creation on onConnectEnd
    const didConnectRef = useRef<boolean>(false)

    // Update embedded sub-step position and persist (debounced)
    const updateEmbeddedSubStep = useCallback((parentId: string, subId: string, pos: { x: number; y: number }) => {
        setNodes(nds => nds.map(n => {
            if (n.id !== parentId) return n
            // @ts-ignore
            const list: ProcessStepData[] = n.data?.subSteps || []
            const updated = list.map(s => s.id === subId ? { ...s, metadata: { ...(s.metadata || {}), position: pos } } : s)
            return { ...n, data: { ...n.data, subSteps: updated } }
        }))

        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = setTimeout(async () => {
            try {
                await supabase.from('process_step').update({ metadata: { position: pos } }).eq('id', subId)
            } catch (e) {
                console.error('Failed to persist sub-step position', e)
            }
        }, 400)
    }, [])

    // Begin and complete internal sub-edge connections
    const beginSubConnection = useCallback((args: { parentId: string; subId: string; side: 'left'|'right'; clientX: number; clientY: number }) => {
        subConnectRef.current = { parentId: args.parentId, fromSubId: args.subId, side: args.side }
    }, [])

    const completeSubConnection = useCallback((parentId: string, toSubId: string) => {
        const ctx = subConnectRef.current
        if (!ctx || ctx.parentId !== parentId || ctx.fromSubId === toSubId) { subConnectRef.current = null; return }
        // Create internal edge record and persist
        const newId = uuidv4()
        const newEdge: ProcessFlowEdgeData = {
            id: newId,
            organisation_id: organisationId,
            from_step_id: ctx.fromSubId,
            to_step_id: toSubId,
            label: ''
        }
        // Save and update parent node's data.subEdges
        void supabase.from('process_flow_edge').upsert(newEdge, { onConflict: 'id' }).then(() => {
            setNodes(nds => nds.map(n => n.id === parentId ? ({
                ...n,
                data: { ...n.data, subEdges: ([...(n.data?.subEdges || []), newEdge]) }
            }) : n))
        })
        subConnectRef.current = null
    }, [organisationId, setNodes])

    // Node editing state
    const [editingNode, setEditingNode] = useState<{
        id: string
        name: string
        description: string
    } | null>(null)

    // Custom onNodesChange
    const onNodesChange = useCallback((changes: any[]) => {
        defaultOnNodesChange(changes)
    }, [defaultOnNodesChange])

    // Handle right-click context menu
    const handleContextMenu = useCallback((event: React.MouseEvent) => {
        event.preventDefault()
    }, [])

    // Handle node right-click
    const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
        event.preventDefault()
        event.stopPropagation()
        
        const containerRect = containerRef.current?.getBoundingClientRect()
        if (containerRect) {
            setContextMenu({
                visible: true,
                x: event.clientX - containerRect.left,
                y: event.clientY - containerRect.top,
                type: 'node',
                target: node
            })
        }
    }, [])

    // Close context menu
    const closeContextMenu = useCallback(() => {
        setContextMenu({
            visible: false,
            x: 0,
            y: 0,
            type: null,
            target: null
        })
    }, [])

    // Auto-save functionality for nodes and edges
    const saveProcessStep = async (step: ProcessStepData) => {
        try {
            // Filter out any properties that don't belong in the database
            const dbStep = {
                id: step.id,
                organisation_id: step.organisation_id,
                name: step.name,
                description: step.description,
                metadata: step.metadata || {},
                parent_step_id: step.parent_step_id
            }

            console.log('Saving process step:', dbStep) // Debug log

            const { error } = await supabase
                .from('process_step')
                .upsert(dbStep, {
                    onConflict: 'id'
                })

            if (error) {
                console.error('Error saving process step:', error)
                console.error('Error details:', JSON.stringify(error, null, 2))
                throw error
            }
        } catch (error) {
            console.error('Failed to save process step:', error)
            console.error('Error type:', typeof error)
            console.error('Error stringified:', JSON.stringify(error, null, 2))
            throw error
        }
    }

    const saveProcessEdge = async (edge: ProcessFlowEdgeData) => {
        try {
            console.log('Saving process edge:', edge) // Debug log
            
            const { error } = await supabase
                .from('process_flow_edge')
                .upsert(edge, {
                    onConflict: 'id'
                })

            if (error) {
                console.error('Error saving process edge:', error)
                console.error('Error details:', JSON.stringify(error, null, 2))
                throw error
            }
        } catch (error) {
            console.error('Failed to save process edge:', error)
            console.error('Error type:', typeof error)
            console.error('Error stringified:', JSON.stringify(error, null, 2))
            throw error
        }
    }

    // Connection handlers for edge creation
    const [connectingNodeId, setConnectingNodeId] = useState<string | null>(null)
    const [connectingFromLeft, setConnectingFromLeft] = useState<boolean>(false)
    const [connectingFromChildRight, setConnectingFromChildRight] = useState<boolean>(false)

    const onConnect = useCallback(async (connection: Connection) => {
        // Mark that a connection completed so onConnectEnd won't spawn a node
        didConnectRef.current = true
        if (!connection.source || !connection.target) return

        const sourceNode = nodes.find(n => n.id === connection.source)
        const targetNode = nodes.find(n => n.id === connection.target)

        // Default to the handles chosen by the user if provided
        let sourceHandle = connection.sourceHandle || undefined
        let targetHandle = connection.targetHandle || undefined

        // If connecting parent -> its child, enforce left-to-left handles
        if (targetNode && sourceNode && targetNode.parentNode === sourceNode.id) {
            sourceHandle = 'left-source'
            targetHandle = 'left-target'
        } else if (sourceNode && targetNode && !sourceNode.parentNode && !targetNode.parentNode) {
            // Parent -> Parent: enforce right-to-left (source right, target left)
            sourceHandle = 'right-source'
            targetHandle = 'left-target'
        } else if (sourceNode && targetNode && sourceNode.parentNode && targetNode.id === sourceNode.parentNode) {
            // Child -> Parent: enforce right-to-right (child right-source to parent right-target)
            sourceHandle = 'right-source'
            targetHandle = 'right-target'
        }

        const newEdge: Edge = {
            id: uuidv4(),
            source: connection.source,
            target: connection.target,
            type: 'n8n-bezier',
            sourceHandle,
            targetHandle,
            data: { label: '' },
        }

        // Save to database with handle metadata
        const edgeData: ProcessFlowEdgeData = {
            id: newEdge.id,
            organisation_id: organisationId,
            from_step_id: newEdge.source,
            to_step_id: newEdge.target,
            label: '',
            metadata: { sourceHandle, targetHandle }
        }

        try {
            await saveProcessEdge(edgeData)
            newEdge.data = { ...newEdge.data, edgeData }
            setEdges((eds) => addEdge(newEdge, eds))
        } catch (error) {
            console.error('Failed to save edge:', error)
        }
    }, [setEdges, organisationId, nodes])

    const onConnectStart = useCallback((event: React.MouseEvent | React.TouchEvent, params: OnConnectStartParams) => {
        // Store the source node ID and handle type when connection starts
        setConnectingNodeId(params.nodeId || null)
        
        // Detect if connecting from the specific parent left-source handle (for sub-process creation)
        const target = event.target as Element
        const isParentLeftSource = target.closest('.parent-left-source') !== null
        setConnectingFromLeft(isParentLeftSource)
        // Detect child right handle start using handleId
        const node = nodes.find(n => n.id === (params.nodeId || ''))
        const sourceIsChild = !!node?.parentNode
        const isRightHandle = (params as any).handleId === 'right-source'
        setConnectingFromChildRight(Boolean(sourceIsChild && isRightHandle))
        
        console.log('Connection started from:', params, 'from parent-left-source:', isParentLeftSource)
    }, [nodes])

    const onConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
        // If a real connection happened, skip creation
        if (didConnectRef.current) {
            didConnectRef.current = false
            setConnectingNodeId(null)
            setConnectingFromLeft(false)
            setConnectingFromChildRight(false)
            return
        }
        // Create on drop anywhere that's not a handle (empty space or over parent box)
        const target = event.target as Element
        const endedOnHandle = !!target && !!target.closest('.react-flow__handle')
        if (!endedOnHandle && connectingNodeId) {
            // Get the mouse/touch position
            const clientX = 'clientX' in event ? event.clientX : event.touches?.[0]?.clientX || 0
            const clientY = 'clientY' in event ? event.clientY : event.touches?.[0]?.clientY || 0
            
            // Convert screen coordinates to flow coordinates
            const containerRect = containerRef.current?.getBoundingClientRect()
            if (containerRect) {
                const relativeX = clientX - containerRect.left
                const relativeY = clientY - containerRect.top
                const flowPosition = reactFlowInstance.screenToFlowPosition({ x: relativeX, y: relativeY })
                
                // Determine if we should create a child or a sibling
                const sourceIsChild = nodes.find(n => n.id === connectingNodeId)?.parentNode
                if (connectingFromLeft) {
                    // Create sub-process under the top-most parent (if child, use its parent; else use itself)
                    const parentId = sourceIsChild || connectingNodeId
                    createSubProcess(parentId, flowPosition, { createParentEdge: true })
                } else if (connectingFromChildRight && sourceIsChild) {
                    // From child right handle: create a sibling sub-process under same parent and connect child -> new child
                    const parentId = sourceIsChild
                    createSubProcess(parentId, flowPosition, { connectFromChildId: connectingNodeId, createParentEdge: false })
                } else {
                    // Create a regular step at the same level as the source
                    createRegularNode(sourceIsChild || connectingNodeId, flowPosition)
                }
            }
        }
        
        // Clear the connecting state
        setConnectingNodeId(null)
        setConnectingFromLeft(false)
        setConnectingFromChildRight(false)
    }, [reactFlowInstance, organisationId, setNodes, setEdges, connectingNodeId, connectingFromLeft, connectingFromChildRight, nodes])

    // Create regular node function
    const createRegularNode = useCallback(async (sourceNodeId: string, position: { x: number; y: number }) => {
        const newNodeId = uuidv4()
        const stepData: ProcessStepData = {
            id: newNodeId,
            organisation_id: organisationId,
            name: 'New Step',
            description: '',
            metadata: { position }
        }
        
        const newNode: Node = {
            id: newNodeId,
            type: 'processStep',
            position,
            data: {
                label: 'New Step',
                description: '',
                stepData,
                onSubStepMove: (subId: string, pos: { x: number; y: number }) => updateEmbeddedSubStep(newNodeId, subId, pos)
            }
        }
        
        try {
            // Save node to database
            await saveProcessStep(stepData)
            
            // Add the new node
            setNodes(nds => [...nds, newNode])
            
            // Create edge from source to new node
            const edgeData: ProcessFlowEdgeData = {
                id: uuidv4(),
                organisation_id: organisationId,
                from_step_id: sourceNodeId,
                to_step_id: newNodeId,
                label: '',
                metadata: { sourceHandle: 'right-source', targetHandle: 'left-target' }
            }
            
            // Save edge to database
            await saveProcessEdge(edgeData)
            
            const newEdge: Edge = {
                id: edgeData.id,
                source: sourceNodeId,
                target: newNodeId,
                type: 'n8n-bezier',
                sourceHandle: 'right-source',
                targetHandle: 'left-target',
                data: { label: '', edgeData }
            }
            
            setEdges(eds => [...eds, newEdge])
        } catch (error) {
            console.error('Failed to create regular node:', error)
        }
    }, [organisationId, setNodes, setEdges])

    // Create sub-process function (as a real child React Flow node)
    const createSubProcess = useCallback(async (
        parentNodeId: string,
        dropPosition: { x: number; y: number },
        options?: { connectFromChildId?: string; createParentEdge?: boolean }
    ) => {
        try {
            // First, update the parent node to indicate it has sub-processes
            const parentNode = nodes.find(n => n.id === parentNodeId)
            if (!parentNode) return
            
            // Determine current size or defaults
            // @ts-ignore
            const parentSize = parentNode.data?.stepData?.metadata?.size || { width: 420, height: 300 }
        const PADDING = { x: 24, y: 64 } // match recompute func header + side

            const updatedParentStepData: ProcessStepData = {
                ...parentNode.data.stepData,
                metadata: {
                    ...parentNode.data.stepData.metadata,
                    hasSubProcesses: true
                }
            }

            // Save updated parent to database
            await saveProcessStep(updatedParentStepData)

    // Convert drop position to position relative to parent's internal coordinate system
            // React Flow uses absolute positioning, so we need to position relative to parent's top-left
            const relativeX = dropPosition.x - parentNode.position.x
            const relativeY = dropPosition.y - parentNode.position.y
            
            // Ensure the child is positioned within the parent's content area (after header)
        const headerHeight = PADDING.y
        const margin = 16
        const childWidth = 140
        const childHeight = 70
            
            // Clamp position to stay within parent bounds
            const childX = Math.max(margin, Math.min(relativeX, parentSize.width - childWidth - margin))
            const childY = Math.max(headerHeight, Math.min(relativeY, parentSize.height - childHeight - margin))
            
            console.log(`Creating child at relative position: ${childX}, ${childY} within parent ${parentSize.width}x${parentSize.height}`)

    // Create a single sub-process record
            const subProcessId = uuidv4()
        const subProcessPosition = { x: childX, y: childY }
            
            const subProcessStepData: ProcessStepData = {
                id: subProcessId,
                organisation_id: organisationId,
        name: 'New Sub-process',
                description: '',
                parent_step_id: parentNodeId,
                metadata: { position: subProcessPosition }
            }

            // Save sub-process to database
            await saveProcessStep(subProcessStepData)

            // Create RF child node
            const childNode: Node = {
                id: subProcessId,
                type: 'processStep',
                position: subProcessPosition,
                parentNode: parentNodeId,
                extent: 'parent',
                data: {
                    label: subProcessStepData.name,
                    description: subProcessStepData.description,
                    stepData: subProcessStepData
                }
            }

            // Update parent and add child
            setNodes(nds => nds.map(n => n.id === parentNodeId ? ({
                ...n,
                data: { ...n.data, stepData: updatedParentStepData }
            }) : n).concat(childNode))
            // Create linking edge depending on options
            if (options?.connectFromChildId) {
                // Child -> New Child (right to left)
                const edgeId = uuidv4()
                const edgeData: ProcessFlowEdgeData = {
                    id: edgeId,
                    organisation_id: organisationId,
                    from_step_id: options.connectFromChildId,
                    to_step_id: subProcessId,
                    label: '',
                    metadata: { sourceHandle: 'right-source', targetHandle: 'left-target' }
                }
                await saveProcessEdge(edgeData)
                const rfEdge: Edge = {
                    id: edgeId,
                    source: options.connectFromChildId,
                    target: subProcessId,
                    type: 'n8n-bezier',
                    sourceHandle: 'right-source',
                    targetHandle: 'left-target',
                    data: { label: '', edgeData }
                }
                setEdges(eds => [...eds, rfEdge])
            } else if (options?.createParentEdge !== false) {
                // Default: Parent -> Child (left to left)
                const edgeId = uuidv4()
                const edgeData: ProcessFlowEdgeData = {
                    id: edgeId,
                    organisation_id: organisationId,
                    from_step_id: parentNodeId,
                    to_step_id: subProcessId,
                    label: '',
                    metadata: { sourceHandle: 'left-source', targetHandle: 'left-target' }
                }
                await saveProcessEdge(edgeData)
                const rfEdge: Edge = {
                    id: edgeId,
                    source: parentNodeId,
                    target: subProcessId,
                    type: 'n8n-bezier',
                    sourceHandle: 'left-source',
                    targetHandle: 'left-target',
                    data: { label: '', edgeData }
                }
                setEdges(eds => [...eds, rfEdge])
            }

            console.log(`Created child sub-process ${subProcessId} under ${parentNodeId}`)
        } catch (error) {
            console.error('Failed to create sub-process:', error)
        }
    }, [organisationId, setNodes, setEdges, nodes])

    // Edge selection and interaction handlers
    const onEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
        event.stopPropagation()
        setSelectedEdge(edge.id)
    }, [])

    const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
        event.preventDefault()
        event.stopPropagation()
        
        const containerRect = containerRef.current?.getBoundingClientRect()
        if (containerRect) {
            setContextMenu({
                visible: true,
                x: event.clientX - containerRect.left,
                y: event.clientY - containerRect.top,
                type: 'edge',
                target: null,
                edgeId: edge.id
            })
        }
    }, [])

    // Convert Supabase data to ReactFlow format
    const convertFromSupabase = useCallback((
        steps: ProcessStepData[],
        edgeData: ProcessFlowEdgeData[] = []
    ): { nodes: Node[]; edges: Edge[] } => {
        // Separate parent nodes and sub-processes
        const parentSteps = steps.filter(step => !step.parent_step_id)
        const subProcessSteps = steps.filter(step => step.parent_step_id)
        
        // Check which parent steps have sub-processes
        const parentsWithSubProcesses = parentSteps.map(step => ({
            ...step,
            metadata: {
                ...step.metadata,
                hasSubProcesses: subProcessSteps.some(sub => sub.parent_step_id === step.id)
            }
        }))

        // Create parent nodes
    const reactFlowNodes: Node[] = parentsWithSubProcesses.map((step, index) => ({
            id: step.id,
            type: 'processStep',
            position: {
                x: (step.metadata?.position?.x) || (index % 3) * 450 + 100,
                y: (step.metadata?.position?.y) || Math.floor(index / 3) * 320 + 100,
            },
            // leave pointer events enabled on RF node wrapper for selection
            data: {
                label: step.name,
                description: step.description,
        stepData: step
            },
        }))

        // Parent nodes get callbacks; child nodes will be added below
    const parentNodesWithData = reactFlowNodes.map(n => ({
            ...n,
            data: {
                ...n.data,
                onResize: ({ width, height }: { width: number; height: number }) => {
                    setNodes(nds => nds.map(nn => nn.id === n.id ? ({
                        ...nn,
                        style: { ...(nn.style || {}), width, height },
                        data: { ...nn.data, stepData: { ...nn.data.stepData, metadata: { ...(nn.data.stepData?.metadata || {}), size: { width, height } } } }
                    }) : nn))
                },
                onResizeEnd: ({ width, height }: { width: number; height: number }) => {
                    void supabase.from('process_step').update({
                        metadata: { ...(n.data.stepData?.metadata || {}), size: { width, height } }
                    }).eq('id', n.id).then(() => {}, (err) => console.error(err))
        }
            }
        }))

        // Build a quick map of parent sizes
        const parentSizeMap = new Map<string, { width: number; height: number }>()
        parentsWithSubProcesses.forEach(p => {
            const sz = p.metadata?.size || { width: 420, height: 300 }
            parentSizeMap.set(p.id, sz)
        })

        // Guard: filter out sub-processes whose parent is missing (avoid RF runtime error)
        const validSubProcessSteps = subProcessSteps.filter(s => s.parent_step_id && parentSizeMap.has(s.parent_step_id))
        const orphanSubSteps = subProcessSteps.filter(s => !s.parent_step_id || !parentSizeMap.has(s.parent_step_id))
        if (orphanSubSteps.length) {
            console.warn('Ignoring orphan sub-process steps (missing parent):', orphanSubSteps.map(o => o.id))
        }

        // Clamp child positions to be within parent content area
        const childNodes: Node[] = validSubProcessSteps.map(s => {
            const parentId = s.parent_step_id!
            const size = parentSizeMap.get(parentId) || { width: 420, height: 300 }
            const margin = 16
            const header = 64
            const childW = 150
            const childH = 60
            const p = s.metadata?.position || { x: margin, y: header }
            const x = Math.max(margin, Math.min(p.x, size.width - childW - margin))
            const y = Math.max(header, Math.min(p.y, size.height - childH - margin))
            return {
                id: s.id,
                type: 'processStep',
                position: { x, y },
                parentNode: parentId,
                extent: 'parent',
                data: {
                    label: s.name,
                    description: s.description,
                    stepData: { ...s, metadata: { ...(s.metadata || {}), position: { x, y } } }
                }
            }
        })

        // Include edges with any combination of parent/child nodes; respect handle metadata if present
        // Build node type map to determine top-level vs child
        const nodeKind = new Map<string, 'parent' | 'child'>()
        parentsWithSubProcesses.forEach(p => nodeKind.set(p.id, 'parent'))
        subProcessSteps.forEach(c => nodeKind.set(c.id, 'child'))

        // Only include edges whose nodes exist
        const existingNodeIds = new Set<string>([...parentNodesWithData, ...childNodes].map(n => n.id))
        const reactFlowEdges: Edge[] = edgeData
            .filter(edge => existingNodeIds.has(edge.from_step_id) && existingNodeIds.has(edge.to_step_id))
            .map((edge) => {
                let sourceHandle = (edge as any).metadata?.sourceHandle as string | undefined
                let targetHandle = (edge as any).metadata?.targetHandle as string | undefined
                const sKind = nodeKind.get(edge.from_step_id)
                const tKind = nodeKind.get(edge.to_step_id)

                // Normalize missing handle metadata
                if (!sourceHandle || !targetHandle) {
                    if (sKind === 'parent' && tKind === 'parent') {
                        sourceHandle = 'right-source'
                        targetHandle = 'left-target'
                    } else if (sKind === 'parent' && tKind === 'child') {
                        sourceHandle = 'left-source'
                        targetHandle = 'left-target'
                    } else if (sKind === 'child' && tKind === 'parent') {
                        sourceHandle = 'left-source'
                        targetHandle = 'left-target'
                    }
                }

                return ({
                    id: edge.id,
                    source: edge.from_step_id,
                    target: edge.to_step_id,
                    type: 'n8n-bezier',
                    sourceHandle,
                    targetHandle,
                    data: {
                        label: edge.label || '',
                        edgeData: edge
                    },
                })
            })

    return { nodes: [...parentNodesWithData, ...childNodes], edges: reactFlowEdges }
    }, [])

    // Load data from Supabase
    const loadProcessFlow = useCallback(async () => {
        if (!selectedOrgId) return

        setIsLoading(true)
        setError(null)

        try {
            // Fetch process steps
            const { data: stepsData, error: stepsError } = await supabase
                .from('process_step')
                .select('*')
                .eq('organisation_id', selectedOrgId)

            if (stepsError) throw stepsError

            // Fetch process flow edges
            const { data: edgesData, error: edgesError } = await supabase
                .from('process_flow_edge')
                .select('*')
                .eq('organisation_id', selectedOrgId)

            if (edgesError) throw edgesError

            const steps = stepsData || []
            const edgeData = edgesData || []
            setOriginalSteps(steps)
            setOriginalEdges(edgeData)

            const { nodes: reactFlowNodes, edges: reactFlowEdges } = convertFromSupabase(steps, edgeData)
            setNodes(reactFlowNodes)
            setEdges(reactFlowEdges)

        } catch (err) {
            console.error('Error loading process flow:', err)
            setError(err instanceof Error ? err.message : 'Failed to load process flow')
        } finally {
            setIsLoading(false)
        }
    }, [selectedOrgId, convertFromSupabase])

    // Save workflow to Supabase
    const saveProcessFlow = useCallback(async () => {
        if (!selectedOrgId) {
            setError('No organization selected')
            return
        }

        setIsSaving(true)
        setError(null)

    try {
            // Save node positions and data
            for (const node of nodes) {
                const existingStep = originalSteps.find(s => s.id === node.id)
                if (existingStep) {
                    // Update existing step with position
                    const { error: updateError } = await supabase
                        .from('process_step')
                        .update({
                            name: node.data.label,
                            description: node.data.description,
                            metadata: {
                                ...existingStep.metadata,
                                position: { x: node.position.x, y: node.position.y }
                            }
                        })
                        .eq('id', node.id)

                    if (updateError) throw updateError
                } else {
                    // Insert new step
                    const { error: insertError } = await supabase
                        .from('process_step')
                        .insert({
                            id: node.id,
                            organisation_id: selectedOrgId,
                            name: node.data.label,
                            description: node.data.description,
                            metadata: {
                                position: { x: node.position.x, y: node.position.y }
                            }
                        })

                    if (insertError) throw insertError
                }
            }

            // Save edge data
            for (const edge of edges) {
                const existingEdge = originalEdges.find(e => e.id === edge.id)
                if (existingEdge) {
                    // Update existing edge
                    const { error: updateError } = await supabase
                        .from('process_flow_edge')
                        .update({
                            from_step_id: edge.source,
                            to_step_id: edge.target,
                            label: edge.data?.label || null,
                            metadata: edge.data?.edgeData?.metadata || {
                                sourceHandle: edge.sourceHandle,
                                targetHandle: edge.targetHandle,
                            }
                        })
                        .eq('id', edge.id)

                    if (updateError) throw updateError
                } else {
                    // Insert new edge
                    const { error: insertError } = await supabase
                        .from('process_flow_edge')
                        .insert({
                            id: edge.id,
                            organisation_id: selectedOrgId,
                            from_step_id: edge.source,
                            to_step_id: edge.target,
                            label: edge.data?.label || null,
                            metadata: {
                                sourceHandle: edge.sourceHandle,
                                targetHandle: edge.targetHandle,
                            }
                        })

                    if (insertError) throw insertError
                }
            }

            // Delete edges that no longer exist
            const currentEdgeIds = edges.map(e => e.id)
            const edgesToDelete = originalEdges.filter(e => !currentEdgeIds.includes(e.id))
            
            for (const edgeToDelete of edgesToDelete) {
                const { error: deleteError } = await supabase
                    .from('process_flow_edge')
                    .delete()
                    .eq('id', edgeToDelete.id)

                if (deleteError) throw deleteError
            }

            // Delete nodes that no longer exist
            const currentNodeIds = nodes.map(n => n.id)
            const nodesToDelete = originalSteps.filter(s => !currentNodeIds.includes(s.id))
            // Delete children before parents to avoid FK violations
            const parentOf: Record<string, string | null | undefined> = {}
            originalSteps.forEach(s => { parentOf[s.id] = s.parent_step_id })
            const depthCache = new Map<string, number>()
            const getDepth = (id: string): number => {
                if (depthCache.has(id)) return depthCache.get(id)!
                const p = parentOf[id]
                const d = p ? (1 + getDepth(p)) : 0
                depthCache.set(id, d)
                return d
            }
            const nodesToDeleteSorted = [...nodesToDelete].sort((a, b) => getDepth(b.id) - getDepth(a.id))

            for (const nodeToDelete of nodesToDeleteSorted) {
                const { error: deleteError } = await supabase
                    .from('process_step')
                    .delete()
                    .eq('id', nodeToDelete.id)

                if (deleteError) throw deleteError
            }

            // Reload data to get updated state
            await loadProcessFlow()
            setLastSaved(new Date())
            onSave?.()

        } catch (err: any) {
            // Extract helpful details from Supabase/Postgrest errors
            const message =
                (err && (err.message || err.details || err.hint || err.code)) ||
                (typeof err === 'string' ? err : '') ||
                (() => { try { return JSON.stringify(err) } catch { return '' } })()
            console.error('Error saving process flow:', err)
            setError(message || 'Failed to save process flow')
        } finally {
            setIsSaving(false)
        }
    }, [selectedOrgId, nodes, edges, originalSteps, originalEdges, loadProcessFlow, onSave])

    // Add new node with simple positioning
    const addNewNode = useCallback(() => {
        const id = uuidv4()

        // Simple random positioning
        const position = {
            x: 200 + Math.random() * 200,
            y: 150 + Math.random() * 150
        }

        const newNode: Node = {
            id,
            type: 'processStep',
            position,
            data: {
                label: 'New Step',
                description: '',
                stepData: {
                    id,
                    organisation_id: selectedOrgId,
                    name: 'New Step',
                    description: '',
                    metadata: { position }
                },
                onSubStepMove: (subId: string, pos: { x: number; y: number }) => updateEmbeddedSubStep(id, subId, pos)
            },
        }

        setNodes((nds) => [...nds, newNode])
        setEditingNode({ id, name: 'New Step', description: '' })
    }, [selectedOrgId, setNodes])

    // Add a node at a specific flow position
    // Add node at specific position with simple positioning
    const addNodeAt = useCallback((position: { x: number; y: number }) => {
        const id = uuidv4()

        const newNode: Node = {
            id,
            type: 'processStep',
            position,
            data: {
                label: 'New Step',
                description: '',
                stepData: {
                    id,
                    organisation_id: selectedOrgId,
                    name: 'New Step',
                    description: '',
                    metadata: { position }
                },
                onSubStepMove: (subId: string, pos: { x: number; y: number }) => updateEmbeddedSubStep(id, subId, pos)
            }
        }
        setNodes(nds => [...nds, newNode])
        setEditingNode({ id, name: 'New Step', description: '' })
    }, [selectedOrgId, setNodes])

    // Floating button handler: add node at viewport center
    const handleAddNodeClick = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect()
        const center = rect
            ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
            : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
        const flowPos = reactFlowInstance.screenToFlowPosition(center)
        addNodeAt(flowPos)
    }, [reactFlowInstance, addNodeAt])

    // Handle node editing
    const saveNodeEdit = useCallback(() => {
        if (!editingNode) return

        setNodes((nds) =>
            nds.map((node) =>
                node.id === editingNode.id
                    ? {
                        ...node,
                        data: {
                            ...node.data,
                            label: editingNode.name,
                            description: editingNode.description,
                        },
                    }
                    : node
            )
        )
        setEditingNode(null)
    }, [editingNode, setNodes])

    // Expose saveProcessFlow function to parent component
    useImperativeHandle(ref, () => ({
        saveProcessFlow
    }), [saveProcessFlow])

    // Load data on mount
    useEffect(() => {
        loadProcessFlow()
    }, [loadProcessFlow])

    // Handle node click for editing
    const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
        event.stopPropagation()
        setSelectedNode(node)
        closeContextMenu()
        
        setEditingNode({
            id: node.id,
            name: node.data.label,
            description: node.data.description || ''
        })
    }, [closeContextMenu])

    // Delete element from context menu
    const deleteElement = useCallback(() => {
        if (contextMenu.type === 'node' && contextMenu.target) {
            // Delete node and associated edges
            const nodeId = contextMenu.target.id
            setNodes((nds) => nds.filter(n => n.id !== nodeId))
            setEdges((eds) => eds.filter(e => e.source !== nodeId && e.target !== nodeId))
            setSelectedNode(null)
            setEditingNode(null)
        } else if (contextMenu.type === 'edge' && contextMenu.edgeId) {
            // Delete edge
            setEdges((eds) => eds.filter(e => e.id !== contextMenu.edgeId))
            setSelectedEdge(null)
            setEditingEdge(null)
        }
        
        closeContextMenu()
    }, [contextMenu, setNodes, setEdges, closeContextMenu])

    // Delete selected element (for keyboard shortcut)
    const deleteSelected = useCallback(() => {
        if (selectedNode) {
            const nodeId = selectedNode.id
            setNodes((nds) => nds.filter(n => n.id !== nodeId))
            setEdges((eds) => eds.filter(e => e.source !== nodeId && e.target !== nodeId))
            setSelectedNode(null)
            setEditingNode(null)
        } else if (selectedEdge) {
            setEdges((eds) => eds.filter(e => e.id !== selectedEdge))
            setSelectedEdge(null)
            setEditingEdge(null)
        }
    }, [selectedNode, selectedEdge, setNodes, setEdges])

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Delete') {
                deleteSelected()
            }
        }

        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [deleteSelected])

    // Close context menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (contextMenu.visible) {
                closeContextMenu()
            }
        }

        document.addEventListener('click', handleClickOutside)
        return () => document.removeEventListener('click', handleClickOutside)
    }, [contextMenu.visible, closeContextMenu])

    // Final safety net: sanitize nodes/edges to avoid orphan child referencing a missing parent
    const { sanitizedNodes, sanitizedEdges } = useMemo(() => {
        const idSet = new Set(nodes.map(n => n.id))
        // Keep only children whose parent exists in current nodes list
        const validNodes = nodes.filter(n => !n.parentNode || idSet.has(n.parentNode))
        if (validNodes.length !== nodes.length) {
            const dropped = nodes.filter(n => n.parentNode && !idSet.has(n.parentNode)).map(n => n.id)
            console.warn('Sanitizer: dropping child nodes whose parent is missing:', dropped)
        }
        const validIdSet = new Set(validNodes.map(n => n.id))
        const validEdges = edges.filter(e => validIdSet.has(e.source) && validIdSet.has(e.target))
        return { sanitizedNodes: validNodes, sanitizedEdges: validEdges }
    }, [nodes, edges])

    if (isLoading) {
        return (
            <div className={`flex items-center justify-center bg-gray-950 ${className}`} style={{ height }}>
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400 mx-auto mb-2"></div>
                    <p className="text-gray-400">Loading process flow...</p>
                </div>
            </div>
        )
    }

    return (
        <div className={`border border-gray-800 rounded-lg bg-gray-950 ${className}`}>
            {/* Toolbar (optional) */}
            {!hideToolbar && (
                <div className="flex items-center justify-between p-3 border-b border-gray-800 bg-gray-900">
                    <h3 className="text-lg font-medium text-yellow-400">Process Flow Editor</h3>
                    <div className="flex items-center space-x-3">
                        {error && (
                            <span className="text-sm text-red-400 bg-red-900/50 px-2 py-1 rounded">
                                {error}
                            </span>
                        )}
                        {lastSaved && (
                            <span className="text-sm text-gray-400">
                                Saved {lastSaved.toLocaleTimeString()}
                            </span>
                        )}
                        <button
                            onClick={addNewNode}
                            className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded"
                        >
                            Add Step
                        </button>
                        <button
                            onClick={saveProcessFlow}
                            disabled={isSaving}
                            className="px-3 py-1 bg-yellow-500 hover:bg-yellow-600 text-gray-900 text-sm rounded font-medium disabled:opacity-50"
                        >
                            {isSaving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>
            )}

            {/* Main Flow Editor */}
            <div ref={containerRef} style={{ height: hideToolbar ? height : (height - 60) }} className="relative rounded-lg border border-gray-800 overflow-hidden bg-gray-900">
                <ReactFlow
                    nodes={sanitizedNodes}
                    edges={sanitizedEdges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onConnectStart={onConnectStart}
                    onConnectEnd={onConnectEnd}
                    isValidConnection={({ source, target, sourceHandle, targetHandle }) => {
                        if (!source || !target) return false
                        const sNode = nodes.find(n => n.id === source)
                        const tNode = nodes.find(n => n.id === target)
                        // If using left-source from a top-level parent, only allow connecting to own children
                        if (sourceHandle === 'left-source' && sNode && !sNode.parentNode) {
                            return !!(tNode && tNode.parentNode === sNode.id)
                        }
                        // Allow child right-source to connect to its parent's right-target
                        if (sourceHandle === 'right-source' && targetHandle === 'right-target' && sNode && tNode) {
                            return !!(sNode.parentNode && sNode.parentNode === tNode.id)
                        }
                        // If top-level parent -> top-level parent, prefer right-source; allow if not left-source
                        if (sNode && tNode && !sNode.parentNode && !tNode.parentNode) {
                            return sourceHandle !== 'left-source'
                        }
                        return true
                    }}
                    onNodeClick={onNodeClick}
                    onNodeContextMenu={onNodeContextMenu}
                    onEdgeClick={onEdgeClick}
                    onEdgeContextMenu={onEdgeContextMenu}
                    onPaneClick={closeContextMenu}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    connectionLineComponent={N8nConnectionLine}
                    connectionLineType={ConnectionLineType.Bezier}
                    fitView
                    fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                    minZoom={0}
                    maxZoom={4}
                    nodeOrigin={[0, 0]}
                    panOnScroll
                    panOnDrag
                    zoomOnPinch
                    elementsSelectable
                    nodesDraggable
                    nodesConnectable={true}
                    deleteKeyCode={["Delete", "Backspace"]}
                    defaultEdgeOptions={{
                        type: 'n8n-bezier',
                    }}
                    translateExtent={undefined}
                    preventScrolling={false}
                    onInit={(inst) => { setTimeout(() => inst.fitView?.({ padding: 0.2, maxZoom: 1 }), 0) }}
                    proOptions={{ hideAttribution: true }}
                    className="bg-gray-900"
                >
                    <Controls position="bottom-left" className="bg-gray-800 border-gray-700" />
                    <Background color="#374151" gap={16} />
                </ReactFlow>

                {/* Floating Add Node button */}
                <button
                    type="button"
                    onClick={handleAddNodeClick}
                    aria-label="Add step"
                    title="Add step"
                    className="absolute bottom-4 right-4 w-12 h-12 rounded-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 shadow-lg border border-yellow-400 flex items-center justify-center"
                >
                    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                    </svg>
                </button>

                {/* Context Menu */}
                {contextMenu.visible && (
                    <div
                        style={{
                            position: 'absolute',
                            left: contextMenu.x,
                            top: contextMenu.y,
                            zIndex: 1000,
                        }}
                        className="bg-gray-800 border border-gray-700 rounded-lg shadow-lg min-w-32"
                    >
                        <button
                            type="button"
                            onClick={deleteElement}
                            className="w-full px-3 py-2 text-left text-red-400 hover:bg-gray-700 flex items-center gap-2 rounded-lg"
                        >
                            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Delete {contextMenu.type}
                        </button>
                    </div>
                )}

                {/* Node Editing Panel */}
                {editingNode && (
                    <div className="absolute top-4 right-4 bg-gray-800 border border-gray-700 p-4 rounded-lg shadow-lg w-64">
                        <h4 className="font-medium text-yellow-400 mb-3">Edit Process Step</h4>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Step Name</label>
                                <input
                                    type="text"
                                    value={editingNode.name}
                                    onChange={(e) => setEditingNode({ ...editingNode, name: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-600 bg-gray-700 text-gray-100 rounded-md text-sm focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Description</label>
                                <textarea
                                    value={editingNode.description}
                                    onChange={(e) => setEditingNode({ ...editingNode, description: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-600 bg-gray-700 text-gray-100 rounded-md text-sm focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400"
                                    rows={3}
                                />
                            </div>
                            <div className="flex space-x-2">
                                <button
                                    onClick={saveNodeEdit}
                                    className="flex-1 px-3 py-2 bg-yellow-500 hover:bg-yellow-600 text-gray-900 text-sm rounded font-medium"
                                >
                                    Save
                                </button>
                                <button
                                    onClick={() => setEditingNode(null)}
                                    className="flex-1 px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
})

const ProcessFlowEditor = React.forwardRef<
    { saveProcessFlow: () => Promise<void> },
    ProcessFlowEditorProps
>((props, ref) => {
    return (
        <ReactFlowProvider>
            <ProcessFlowEditorInner {...props} ref={ref} />
        </ReactFlowProvider>
    )
})

ProcessFlowEditor.displayName = 'ProcessFlowEditor'

export default ProcessFlowEditor
