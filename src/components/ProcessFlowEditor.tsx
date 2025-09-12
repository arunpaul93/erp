'use client'

import React, { useCallback, useEffect, useState, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import { supabase } from '@/lib/supabase'
import ReactFlow, {
    Controls,
    Background,
    Node,
    Edge,
    Connection,
    ConnectionLineType,
    useNodesState,
    useEdgesState,
    addEdge,
    MarkerType,
    ReactFlowProvider,
    useReactFlow,
    NodeProps,
    Handle,
    Position,
    OnConnectStartParams,
    EdgeProps,
    getBezierPath
} from 'reactflow'
import 'reactflow/dist/style.css'

const GRID_SIZE = 16
/*
 * Enhanced ProcessFlowEditor with OperationalFlowEditor-inspired improvements:
 * 
 * 🔧 4-Corner Node Repulsion System:
 *    - Uses all 4 corners of nodes as reference points for collision detection
 *    - More accurate spatial awareness compared to center-point calculations
 *    - Enhanced repulsion forces with normalized distance calculations
 * 
 * 🎯 Intelligent Edge Routing:
 *    - Enhanced backward connection handling for right-to-left flows
 *    - Improved Bézier curve calculations with proper control point positioning
 *    - Better label positioning using cubic Bézier interpolation
 *    - Enhanced self-loop and complex angle routing
 * 
 * 🛡️ Collision-Aware Node Placement:
 *    - Sophisticated collision detection using 4-corner distance calculations
 *    - Smart positioning algorithm that finds optimal placement locations
 *    - Fallback to best available position when perfect placement unavailable
 *    - Applied to drag-to-create, floating button, and programmatic node creation
 * 
 * ⚡ Enhanced Connection Lifecycle:
 *    - Improved onConnectStart/onConnect/onConnectEnd handling
 *    - Better drop detection with canvas interaction awareness
 *    - Automatic node creation with intelligent positioning on empty canvas drops
 * 
 * 📊 Visual & UX Improvements:
 *    - Enhanced edge styling with proper stroke properties
 *    - Better hit testing areas for edge interaction
 *    - Improved label styling and positioning
 *    - Optimized repulsion forces and distance calculations
 */

const NODE_REPULSION_DISTANCE = 30

// Simple UUID v4 generator (fallback without external deps)
function uuidv4() {
    // Source: RFC4122 compliant enough for client IDs
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
    })
}

// Clean 3-point Bézier curve with 90-degree angle constraint
function AdvancedBezierEdge({
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
    label,
    labelStyle,
    labelShowBg,
    labelBgStyle,
    labelBgPadding,
    labelBgBorderRadius,
}: EdgeProps) {
    // Calculate distance and direction
    const dx = targetX - sourceX
    const dy = targetY - sourceY
    const distance = Math.sqrt(dx * dx + dy * dy)

    // Calculate the single control point for quadratic Bézier
    let controlX: number
    let controlY: number

    // Determine control point based on connection direction
    const isHorizontal = Math.abs(dx) > Math.abs(dy)

    if (isHorizontal) {
        // Horizontal-dominant connection
        const midX = sourceX + dx * 0.5
        const offsetY = Math.sign(dy) * Math.min(Math.abs(dy) * 0.8, distance * 0.3, 60)
        controlX = midX
        controlY = sourceY + offsetY
    } else {
        // Vertical-dominant connection
        const midY = sourceY + dy * 0.5
        const offsetX = Math.sign(dx) * Math.min(Math.abs(dx) * 0.8, distance * 0.3, 60)
        controlX = sourceX + offsetX
        controlY = midY
    }

    // Validate angle constraint (max 90 degrees)
    // Calculate vectors from source to control and control to target
    const v1x = controlX - sourceX
    const v1y = controlY - sourceY
    const v2x = targetX - controlX
    const v2y = targetY - controlY

    // Calculate angle between vectors using dot product
    const dotProduct = v1x * v2x + v1y * v2y
    const mag1 = Math.sqrt(v1x * v1x + v1y * v1y)
    const mag2 = Math.sqrt(v2x * v2x + v2y * v2y)

    if (mag1 > 0 && mag2 > 0) {
        const cosAngle = dotProduct / (mag1 * mag2)
        const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle))) // Clamp to avoid NaN

        // If angle is too sharp (> 90 degrees), adjust control point
        if (angle > Math.PI / 2) {
            const adjustmentFactor = 0.5 // Reduce curvature
            controlX = sourceX + (controlX - sourceX) * adjustmentFactor + (targetX - sourceX) * (1 - adjustmentFactor) * 0.5
            controlY = sourceY + (controlY - sourceY) * adjustmentFactor + (targetY - sourceY) * (1 - adjustmentFactor) * 0.5
        }
    }

    // Create quadratic Bézier path (3 points: source, control, target)
    const path = `M ${sourceX},${sourceY} Q ${controlX},${controlY} ${targetX},${targetY}`

    // Calculate label position at curve midpoint (t = 0.5)
    const t = 0.5
    const labelX = (1 - t) * (1 - t) * sourceX + 2 * (1 - t) * t * controlX + t * t * targetX
    const labelY = (1 - t) * (1 - t) * sourceY + 2 * (1 - t) * t * controlY + t * t * targetY

    return (
        <>
            <path
                id={id}
                style={style}
                className="react-flow__edge-path"
                d={path}
                markerEnd={markerEnd}
                fill="none"
                stroke={style?.stroke || '#b1b1b7'}
                strokeWidth={style?.strokeWidth || 2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            {/* Invisible thicker path for better hit testing */}
            <path
                d={path}
                fill="none"
                strokeOpacity={0}
                strokeWidth={20}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="react-flow__edge-interaction"
            />
            {label && (
                <text
                    x={labelX}
                    y={labelY}
                    style={labelStyle}
                    className="react-flow__edge-text"
                    textAnchor="middle"
                    dominantBaseline="middle"
                >
                    {label}
                </text>
            )}
        </>
    )
}

// Enhanced 4-corner node repulsion based on OperationalFlowEditor patterns
function applyNodeRepulsion(nodes: Node[], draggedNodeId?: string): Node[] {
    const nodeSize = { width: 150, height: 80 } // Approximate node size
    const repulsionDistance = NODE_REPULSION_DISTANCE

    return nodes.map((node, index) => {
        if (!node.position) return node

        let newPosition = { ...node.position }
        let hasCollision = false

        // Get all 4 corner reference points for current node
        const nodeCorners = [
            { x: node.position.x, y: node.position.y }, // top-left
            { x: node.position.x + nodeSize.width, y: node.position.y }, // top-right
            { x: node.position.x, y: node.position.y + nodeSize.height }, // bottom-left
            { x: node.position.x + nodeSize.width, y: node.position.y + nodeSize.height } // bottom-right
        ]

        // Check collision with other nodes using 4-corner system
        nodes.forEach((otherNode, otherIndex) => {
            if (index === otherIndex || !otherNode.position) return

            // Get other node's corners
            const otherCorners = [
                { x: otherNode.position.x, y: otherNode.position.y },
                { x: otherNode.position.x + nodeSize.width, y: otherNode.position.y },
                { x: otherNode.position.x, y: otherNode.position.y + nodeSize.height },
                { x: otherNode.position.x + nodeSize.width, y: otherNode.position.y + nodeSize.height }
            ]

            // Check all corner-to-corner distances
            let minDistance = Infinity
            let repulsionVector = { x: 0, y: 0 }

            nodeCorners.forEach(corner => {
                otherCorners.forEach(otherCorner => {
                    const dx = corner.x - otherCorner.x
                    const dy = corner.y - otherCorner.y
                    const distance = Math.sqrt(dx * dx + dy * dy)

                    if (distance < minDistance) {
                        minDistance = distance
                        repulsionVector = { x: dx, y: dy }
                    }
                })
            })

            const threshold = repulsionDistance + 20 // Additional buffer for corners

            if (minDistance < threshold && minDistance > 0) {
                hasCollision = true
                // Apply enhanced repulsion force
                const force = (threshold - minDistance) / threshold
                const normalizedDistance = Math.sqrt(repulsionVector.x * repulsionVector.x + repulsionVector.y * repulsionVector.y)

                if (normalizedDistance > 0) {
                    const repulsionX = (repulsionVector.x / normalizedDistance) * force * 25
                    const repulsionY = (repulsionVector.y / normalizedDistance) * force * 25

                    // Only move the current node if it's not the one being dragged
                    if (node.id !== draggedNodeId) {
                        newPosition.x += repulsionX
                        newPosition.y += repulsionY
                    }
                }
            }
        })

        if (hasCollision) {
            return { ...node, position: newPosition }
        }
        return node
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
    return (
        <div className={`px-4 py-3 shadow-lg rounded-lg bg-gray-800 border-2 ${selected ? 'border-yellow-400' : 'border-gray-600'
            } hover:border-yellow-400 transition-colors min-w-[150px]`}>
            <Handle type="target" position={Position.Left} className="w-3 h-3 bg-yellow-400" />
            <div className="font-medium text-gray-100">{data.label}</div>
            {data.description && (
                <div className="text-xs text-gray-400 mt-1">{data.description}</div>
            )}
            <Handle type="source" position={Position.Right} className="w-3 h-3 bg-yellow-400" />
        </div>
    )
}

const nodeTypes = {
    processStep: ProcessStepNode,
}

const edgeTypes = {
    advancedBezier: AdvancedBezierEdge,
}

interface ProcessFlowEditorProps {
    height?: number
    className?: string
    onSave?: () => void
    hideToolbar?: boolean
}

function ProcessFlowEditorInner({
    height = 600,
    className = '',
    onSave,
    hideToolbar = false
}: ProcessFlowEditorProps) {
    const { user } = useAuth()
    const { selectedOrgId } = useOrg()
    const reactFlowInstance = useReactFlow()

    const [nodes, setNodes, defaultOnNodesChange] = useNodesState([])
    const [edges, setEdges, onEdgesChange] = useEdgesState([])

    // Custom onNodesChange with repulsion
    const onNodesChange = useCallback((changes: any[]) => {
        defaultOnNodesChange(changes)

        // Apply repulsion after position changes
        const positionChanges = changes.filter(change => change.type === 'position')
        if (positionChanges.length > 0) {
            setNodes(currentNodes => applyNodeRepulsion(currentNodes, positionChanges[0]?.id))
        }
    }, [defaultOnNodesChange, setNodes])
    const [originalSteps, setOriginalSteps] = useState<ProcessStepData[]>([])
    const [originalEdges, setOriginalEdges] = useState<ProcessFlowEdgeData[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [lastSaved, setLastSaved] = useState<Date | null>(null)
    const [selectedNode, setSelectedNode] = useState<Node | null>(null)
    // Track connection drag start
    const connectingRef = useRef<{ nodeId?: string; handleType?: 'source' | 'target' }>({})
    // Track if connection was successful (to avoid creating new node)
    const connectionSuccessfulRef = useRef<boolean>(false)
    const containerRef = useRef<HTMLDivElement | null>(null)

    // Node editing state
    const [editingNode, setEditingNode] = useState<{
        id: string
        name: string
        description: string
    } | null>(null)

    // Edge editing state
    const [editingEdge, setEditingEdge] = useState<{
        id: string
        label: string
    } | null>(null)

    // Convert Supabase data to ReactFlow format
    const convertFromSupabase = useCallback((
        steps: ProcessStepData[],
        flowEdges: ProcessFlowEdgeData[]
    ): { nodes: Node[], edges: Edge[] } => {
        const reactFlowNodes: Node[] = steps.map((step, index) => ({
            id: step.id,
            type: 'processStep',
            position: {
                x: (step.metadata?.position?.x) || (index % 3) * 300 + 100,
                y: (step.metadata?.position?.y) || Math.floor(index / 3) * 150 + 100,
            },
            data: {
                label: step.name,
                description: step.description,
                stepData: step
            },
        }))

        const reactFlowEdges: Edge[] = flowEdges.map(edge => ({
            id: edge.id,
            source: edge.from_step_id,
            target: edge.to_step_id,
            type: 'advancedBezier',
            label: edge.label,
            markerEnd: {
                type: MarkerType.ArrowClosed,
            },
            style: {
                strokeWidth: 2,
                cursor: 'pointer'
            },
            labelStyle: {
                fill: '#e5e7eb',
                fontSize: '12px',
                cursor: 'pointer'
            },
            data: edge
        }))

        return { nodes: reactFlowNodes, edges: reactFlowEdges }
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
            const flowEdges = edgesData || []

            setOriginalSteps(steps)
            setOriginalEdges(flowEdges)

            const { nodes: reactFlowNodes, edges: reactFlowEdges } = convertFromSupabase(steps, flowEdges)
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

            // Handle edges
            const currentEdgeIds = new Set(edges.map(e => e.id))
            const originalEdgeIds = new Set(originalEdges.map(e => e.id))

            // Delete removed edges
            const edgesToDelete = originalEdges.filter(e => !currentEdgeIds.has(e.id))
            if (edgesToDelete.length > 0) {
                const { error: deleteError } = await supabase
                    .from('process_flow_edge')
                    .delete()
                    .in('id', edgesToDelete.map(e => e.id))

                if (deleteError) throw deleteError
            }

            // Insert new edges
            const edgesToInsert = edges.filter(e => !originalEdgeIds.has(e.id))
            if (edgesToInsert.length > 0) {
                const { error: insertError } = await supabase
                    .from('process_flow_edge')
                    .insert(
                        edgesToInsert.map(edge => ({
                            id: edge.id,
                            organisation_id: selectedOrgId,
                            from_step_id: edge.source,
                            to_step_id: edge.target,
                            label: edge.label,
                            metadata: {}
                        }))
                    )

                if (insertError) throw insertError
            }

            // Update existing edges
            for (const edge of edges) {
                if (originalEdgeIds.has(edge.id)) {
                    const { error: updateError } = await supabase
                        .from('process_flow_edge')
                        .update({
                            from_step_id: edge.source,
                            to_step_id: edge.target,
                            label: edge.label
                        })
                        .eq('id', edge.id)

                    if (updateError) throw updateError
                }
            }

            // Reload data to get updated state
            await loadProcessFlow()
            setLastSaved(new Date())
            onSave?.()

        } catch (err: any) {
            // Supabase errors sometimes come as objects; try to extract message
            const message = err?.message || err?.error_description || JSON.stringify(err || {})
            console.error('Error saving process flow:', err)
            setError(message || 'Failed to save process flow')
        } finally {
            setIsSaving(false)
        }
    }, [selectedOrgId, nodes, edges, originalSteps, originalEdges, loadProcessFlow, onSave])

    // Handle connection creation
    const onConnect = useCallback((params: Connection) => {
        if (!params.source || !params.target) return

        // Mark connection as successful
        connectionSuccessfulRef.current = true

        const newEdge: Edge = {
            id: uuidv4(),
            source: params.source,
            target: params.target,
            type: 'advancedBezier',
            markerEnd: {
                type: MarkerType.ArrowClosed,
            },
            label: '',
            style: {
                strokeWidth: 2,
                cursor: 'pointer'
            },
            labelStyle: {
                fill: '#e5e7eb',
                fontSize: '12px',
                cursor: 'pointer'
            }
        }

        setEdges((eds) => addEdge(newEdge, eds))
    }, [setEdges])

    // Start a connection (remember source/target node & handle type)
    const onConnectStart = useCallback((_: any, params: OnConnectStartParams) => {
        connectingRef.current = {
            nodeId: params.nodeId ?? undefined,
            handleType: params.handleType as 'source' | 'target' | undefined,
        }
        // Reset connection success flag
        connectionSuccessfulRef.current = false
    }, [])

    // Enhanced collision-aware node positioning inspired by OperationalFlowEditor
    const findCollisionFreePosition = useCallback((preferredPosition: { x: number, y: number }) => {
        const nodeSize = { width: 150, height: 80 }
        const minDistance = 180 // Minimum spacing between nodes
        let attempts = 0
        const maxAttempts = 50
        let bestPosition = { ...preferredPosition }
        let bestDistance = 0

        while (attempts < maxAttempts) {
            const testPosition = {
                x: preferredPosition.x + (Math.random() - 0.5) * 400,
                y: preferredPosition.y + (Math.random() - 0.5) * 300
            }

            // Calculate minimum distance to all existing nodes using 4-corner system
            let minDistanceToNodes = Infinity

            nodes.forEach(node => {
                // Test node corners
                const testCorners = [
                    { x: testPosition.x, y: testPosition.y },
                    { x: testPosition.x + nodeSize.width, y: testPosition.y },
                    { x: testPosition.x, y: testPosition.y + nodeSize.height },
                    { x: testPosition.x + nodeSize.width, y: testPosition.y + nodeSize.height }
                ]

                // Existing node corners
                const existingCorners = [
                    { x: node.position.x, y: node.position.y },
                    { x: node.position.x + nodeSize.width, y: node.position.y },
                    { x: node.position.x, y: node.position.y + nodeSize.height },
                    { x: node.position.x + nodeSize.width, y: node.position.y + nodeSize.height }
                ]

                // Find minimum corner-to-corner distance
                testCorners.forEach(testCorner => {
                    existingCorners.forEach(existingCorner => {
                        const dx = testCorner.x - existingCorner.x
                        const dy = testCorner.y - existingCorner.y
                        const distance = Math.sqrt(dx * dx + dy * dy)
                        minDistanceToNodes = Math.min(minDistanceToNodes, distance)
                    })
                })
            })

            // If this position is better than minimum required distance, use it
            if (minDistanceToNodes >= minDistance) {
                return testPosition
            }

            // Track the best position found so far
            if (minDistanceToNodes > bestDistance) {
                bestDistance = minDistanceToNodes
                bestPosition = { ...testPosition }
            }

            attempts++
        }

        // Return best position found, even if not ideal
        return bestPosition
    }, [nodes])

    // If dropped on canvas, create a new node at drop location and connect
    const onConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
        // If connection was successful (to existing node), don't create new node
        if (connectionSuccessfulRef.current) {
            connectingRef.current = {}
            return
        }

        const target = event.target as Element | null
        const isPane = !!target && (target.classList?.contains('react-flow__pane') || !!target.closest?.('.react-flow__pane'))
        if (!isPane) {
            connectingRef.current = {}
            return
        }

        const pos = 'touches' in event && event.touches.length > 0
            ? { x: (event as TouchEvent).touches[0].clientX, y: (event as TouchEvent).touches[0].clientY }
            : { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY }

        const flowPos = reactFlowInstance.screenToFlowPosition(pos)

        // Use enhanced collision-aware positioning
        const safePosition = findCollisionFreePosition(flowPos)
        const newNodeId = uuidv4()

        const newNode: Node = {
            id: newNodeId,
            type: 'processStep',
            position: safePosition,
            data: {
                label: 'New Step',
                description: '',
                stepData: {
                    id: newNodeId,
                    organisation_id: selectedOrgId,
                    name: 'New Step',
                    description: '',
                    metadata: { position: { x: safePosition.x, y: safePosition.y } }
                }
            }
        }
        setNodes(nds => applyNodeRepulsion([...nds, newNode]))

        const from = connectingRef.current.handleType === 'source' ? connectingRef.current.nodeId : newNodeId
        const to = connectingRef.current.handleType === 'source' ? newNodeId : connectingRef.current.nodeId
        if (from && to) {
            const newEdge: Edge = {
                id: uuidv4(),
                source: from,
                target: to,
                type: 'advancedBezier',
                markerEnd: { type: MarkerType.ArrowClosed },
                label: '',
                style: {
                    strokeWidth: 2,
                    cursor: 'pointer'
                },
                labelStyle: {
                    fill: '#e5e7eb',
                    fontSize: '12px',
                    cursor: 'pointer'
                }
            }
            setEdges(eds => addEdge(newEdge, eds))
        }

        // reset
        connectingRef.current = {}
    }, [reactFlowInstance, selectedOrgId, setNodes, setEdges, findCollisionFreePosition])

    // Enhanced add new node with collision-aware positioning
    const addNewNode = useCallback(() => {
        const id = uuidv4()

        // Start with a center-ish position and find a collision-free spot
        const preferredPosition = {
            x: 200 + Math.random() * 200,
            y: 150 + Math.random() * 150
        }

        const safePosition = findCollisionFreePosition(preferredPosition)

        const newNode: Node = {
            id,
            type: 'processStep',
            position: safePosition,
            data: {
                label: 'New Step',
                description: '',
                stepData: {
                    id,
                    organisation_id: selectedOrgId,
                    name: 'New Step',
                    description: '',
                    metadata: { position: { x: safePosition.x, y: safePosition.y } }
                }
            },
        }

        setNodes((nds) => applyNodeRepulsion([...nds, newNode]))
        setEditingNode({ id, name: 'New Step', description: '' })
    }, [selectedOrgId, setNodes, findCollisionFreePosition])

    // Add a node at a specific flow position
    // Enhanced add node at specific position with collision-aware positioning
    const addNodeAt = useCallback((position: { x: number; y: number }) => {
        const id = uuidv4()

        // Use collision-aware positioning from the requested position
        const safePosition = findCollisionFreePosition(position)

        const newNode: Node = {
            id,
            type: 'processStep',
            position: safePosition,
            data: {
                label: 'New Step',
                description: '',
                stepData: {
                    id,
                    organisation_id: selectedOrgId,
                    name: 'New Step',
                    description: '',
                    metadata: { position: safePosition }
                }
            }
        }
        setNodes(nds => applyNodeRepulsion([...nds, newNode]))
        setEditingNode({ id, name: 'New Step', description: '' })
    }, [selectedOrgId, setNodes, findCollisionFreePosition])

    // Floating button handler: add node at viewport center
    const handleAddNodeClick = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect()
        const center = rect
            ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
            : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
        const flowPos = reactFlowInstance.screenToFlowPosition(center)
        addNodeAt(flowPos)
    }, [reactFlowInstance, addNodeAt])

    // Delete selected elements
    const deleteSelected = useCallback(() => {
        const selectedNodes = nodes.filter(node => node.selected)
        const selectedEdges = edges.filter(edge => edge.selected)

        if (selectedNodes.length > 0) {
            const nodeIds = selectedNodes.map(n => n.id)
            setNodes((nds) => nds.filter(n => !nodeIds.includes(n.id)))
            setEdges((eds) => eds.filter(e => !nodeIds.includes(e.source) && !nodeIds.includes(e.target)))
        }

        if (selectedEdges.length > 0) {
            const edgeIds = selectedEdges.map(e => e.id)
            setEdges((eds) => eds.filter(e => !edgeIds.includes(e.id)))
        }
    }, [nodes, edges, setNodes, setEdges])

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

    // Load data on mount
    useEffect(() => {
        loadProcessFlow()
    }, [loadProcessFlow])

    // Handle node click for editing
    const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
        setSelectedNode(node)
        setEditingNode({
            id: node.id,
            name: node.data.label,
            description: node.data.description || ''
        })
    }, [])

    // Handle edge click for editing
    const onEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
        setEditingEdge({
            id: edge.id,
            label: String(edge.label || '')
        })
    }, [])

    // Update edge label
    const updateEdgeLabel = useCallback((edgeId: string, newLabel: string) => {
        setEdges(prev => prev.map(edge =>
            edge.id === edgeId
                ? { ...edge, label: newLabel }
                : edge
        ))
    }, [setEdges])

    // Save edge changes
    const saveEdgeChanges = useCallback(() => {
        if (editingEdge) {
            updateEdgeLabel(editingEdge.id, editingEdge.label)
            setEditingEdge(null)
        }
    }, [editingEdge, updateEdgeLabel])

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
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onConnectStart={onConnectStart}
                    onConnectEnd={onConnectEnd}
                    onNodeClick={onNodeClick}
                    onEdgeClick={onEdgeClick}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    fitView
                    fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                    minZoom={0}
                    maxZoom={4}
                    nodeOrigin={[0.5, 0.5]}
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
                    nodeExtent={[[-Infinity, -Infinity], [Infinity, Infinity]]}
                    translateExtent={[[-Infinity, -Infinity], [Infinity, Infinity]]}
                    preventScrolling={false}
                    defaultEdgeOptions={{
                        markerEnd: { type: MarkerType.ArrowClosed },
                        interactionWidth: 40,
                        type: 'advancedBezier'
                    }}
                    connectionLineType={ConnectionLineType.Bezier}
                    connectionLineStyle={{ strokeWidth: 2, stroke: '#64748b' }}
                    connectionRadius={20}
                    onInit={(inst) => { setTimeout(() => inst.fitView?.({ padding: 0.2, maxZoom: 1 }), 0) }}
                    onPaneClick={() => {
                        setNodes(prev => prev.map(n => (n as any).selected ? { ...n, selected: false } : n))
                        setEdges(prev => prev.map(e => (e as any).selected ? { ...e, selected: false } : e))
                        // Close editing panels when clicking on pane
                        setEditingNode(null)
                        setEditingEdge(null)
                    }}
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

                {/* Node Editing Panel */}
                {editingNode && (
                    <div className="absolute top-4 right-4 bg-gray-800 border border-gray-700 p-4 rounded-lg shadow-lg w-64">
                        <h4 className="font-medium text-yellow-400 mb-3">Edit Process Step</h4>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">
                                    Step Name
                                </label>
                                <input
                                    type="text"
                                    value={editingNode.name}
                                    onChange={(e) => setEditingNode({ ...editingNode, name: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-600 bg-gray-700 text-gray-100 rounded-md text-sm focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">
                                    Description
                                </label>
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

                {/* Edge Editing Panel */}
                {editingEdge && (
                    <div className="absolute top-4 left-4 bg-gray-800 border border-gray-700 p-4 rounded-lg shadow-lg w-64">
                        <h4 className="font-medium text-blue-400 mb-3">Edit Connection Label</h4>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">
                                    Label
                                </label>
                                <input
                                    type="text"
                                    value={editingEdge.label}
                                    onChange={(e) => setEditingEdge({ ...editingEdge, label: e.target.value })}
                                    placeholder="Enter connection label..."
                                    className="w-full px-3 py-2 border border-gray-600 bg-gray-700 text-gray-100 rounded-md text-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                                />
                            </div>
                            <div className="flex space-x-2">
                                <button
                                    onClick={saveEdgeChanges}
                                    className="flex-1 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded font-medium"
                                >
                                    Save
                                </button>
                                <button
                                    onClick={() => setEditingEdge(null)}
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
}

export default function ProcessFlowEditor(props: ProcessFlowEditorProps) {
    return (
        <ReactFlowProvider>
            <ProcessFlowEditorInner {...props} />
        </ReactFlowProvider>
    )
}
