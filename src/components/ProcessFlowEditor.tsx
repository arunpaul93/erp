"use client"

import React, { useCallback, useEffect, useState, useRef, useImperativeHandle } from 'react'
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
    ConnectionLineType
} from 'reactflow'
    import { ReactFlowProvider } from 'reactflow'
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
                style={{
                    ...style,
                    strokeWidth: selected ? 3 : 2,
                    stroke: selected ? '#ff6b6b' : '#b1b1b7',
                    fill: 'none'
                }}
                className="react-flow__edge-path"
                d={edgePath}
                markerEnd={`url(#${markerId})`}
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

    // Connection handlers for edge creation
    const [connectingNodeId, setConnectingNodeId] = useState<string | null>(null)

    const onConnect = useCallback((connection: Connection) => {
        const newEdge: Edge = {
            id: uuidv4(),
            source: connection.source!,
            target: connection.target!,
            type: 'n8n-bezier',
            data: { label: '' },
        }
        setEdges((eds) => addEdge(newEdge, eds))
    }, [setEdges])

    const onConnectStart = useCallback((event: React.MouseEvent | React.TouchEvent, params: OnConnectStartParams) => {
        // Store the source node ID when connection starts
        setConnectingNodeId(params.nodeId || null)
        console.log('Connection started from:', params)
    }, [])

    const onConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
        // Check if connection ended in empty space (not on a node)
        const target = event.target as Element
        
        // If the connection didn't end on a valid target and we have a source node, create a new node
        if (target && !target.closest('.react-flow__node') && !target.closest('.react-flow__handle') && connectingNodeId) {
            // Get the mouse/touch position
            const clientX = 'clientX' in event ? event.clientX : event.touches?.[0]?.clientX || 0
            const clientY = 'clientY' in event ? event.clientY : event.touches?.[0]?.clientY || 0
            
            // Convert screen coordinates to flow coordinates
            const containerRect = containerRef.current?.getBoundingClientRect()
            if (containerRect) {
                const relativeX = clientX - containerRect.left
                const relativeY = clientY - containerRect.top
                const flowPosition = reactFlowInstance.screenToFlowPosition({ x: relativeX, y: relativeY })
                
                // Create new node at the drop position
                const newNodeId = uuidv4()
                const newNode: Node = {
                    id: newNodeId,
                    type: 'processStep',
                    position: flowPosition,
                    data: {
                        label: 'New Step',
                        description: '',
                        stepData: {
                            id: newNodeId,
                            organisation_id: selectedOrgId,
                            name: 'New Step',
                            description: '',
                            metadata: { position: flowPosition }
                        }
                    }
                }
                
                // Add the new node
                setNodes(nds => [...nds, newNode])
                
                // Create edge from source to new node using stored connecting node ID
                const newEdge: Edge = {
                    id: uuidv4(),
                    source: connectingNodeId,
                    target: newNodeId,
                    type: 'n8n-bezier',
                    data: { label: '' },
                }
                
                setEdges(eds => addEdge(newEdge, eds))
                
                // Open editing for the new node
                setEditingNode({
                    id: newNodeId,
                    name: 'New Step',
                    description: ''
                })
            }
        }
        
        // Clear the connecting node ID
        setConnectingNodeId(null)
    }, [reactFlowInstance, selectedOrgId, setNodes, setEdges, connectingNodeId])

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

        const reactFlowEdges: Edge[] = edgeData.map((edge) => ({
            id: edge.id,
            source: edge.from_step_id,
            target: edge.to_step_id,
            type: 'n8n-bezier',
            data: {
                label: edge.label || '',
                edgeData: edge
            },
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
                            metadata: edge.data?.edgeData?.metadata || {}
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
                            metadata: {}
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
            
            for (const nodeToDelete of nodesToDelete) {
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
            // Supabase errors sometimes come as objects; try to extract message
            const message = err?.message || err?.error_description || JSON.stringify(err || {})
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
                }
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
                }
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
                    nodeOrigin={[0.5, 0.5]}
                    panOnScroll
                    panOnDrag
                    zoomOnPinch
                    elementsSelectable
                    nodesDraggable
                    nodesConnectable={true}
                    deleteKeyCode={["Delete", "Backspace"]}
                    nodeExtent={[[-Infinity, -Infinity], [Infinity, Infinity]]}
                    defaultEdgeOptions={{
                        type: 'n8n-bezier',
                    }}
                    translateExtent={[[-Infinity, -Infinity], [Infinity, Infinity]]}
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
