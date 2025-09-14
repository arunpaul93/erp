'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import { supabase } from '@/lib/supabase'
import {
    ReactFlow,
    Controls,
    Background,
    applyNodeChanges,
    applyEdgeChanges,
    addEdge,
    Node,
    Edge,
    NodeChange,
    EdgeChange,
    Connection,
    BackgroundVariant,
    Position,
    Handle,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'

// Add custom styles for sliders
const sliderStyles = `
  .config-slider {
    width: 100%;
    height: 8px;
    background: #374151;
    border-radius: 8px;
    outline: none;
    -webkit-appearance: none;
    cursor: pointer;
  }
  
  .config-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fbbf24;
    cursor: pointer;
  }
  
  .config-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fbbf24;
    cursor: pointer;
    border: none;
  }
`

interface ProcessStep {
    id: string
    organisation_id: string | null
    name: string
    description: string | null
    metadata: any
    parent_step_id: string | null
}

interface ProcessFlowEdge {
    id: string
    organisation_id: string | null
    from_step_id: string | null
    to_step_id: string | null
    metadata: any
    label: string | null
}

// Custom node component with side handles
const ProcessNode = ({ data, id, selected }: { data: any, id: string, selected: boolean }) => {
    return (
        <div className={`px-4 py-3 shadow-lg rounded-lg border-2 bg-gray-900 min-w-[200px] relative ${selected ? 'border-yellow-400' : 'border-gray-700'
            }`}>
            <Handle
                type="target"
                position={Position.Left}
                className="!w-3 !h-3 !bg-yellow-400 !border-2 !border-gray-900"
            />

            <div className="text-center">
                <div className="text-sm font-semibold text-gray-100 mb-1">
                    {data.label}
                </div>
                {data.description && (
                    <div className="text-xs text-gray-400">
                        {data.description}
                    </div>
                )}
            </div>

            {/* Expand button for nodes with children */}
            {data.hasChildren && (
                <button
                    onClick={() => data.onToggleExpand?.(id)}
                    className="absolute -bottom-2 -right-2 w-6 h-6 bg-yellow-400 hover:bg-yellow-300 rounded-full flex items-center justify-center text-gray-900 text-xs font-bold transition-colors"
                    title={`${data.isExpanded ? 'Collapse' : 'Expand'} to ${data.isExpanded ? 'hide' : 'show'} ${data.childrenCount || 0} child nodes`}
                >
                    {data.isExpanded ? '−' : '+'}
                </button>
            )}

            <Handle
                type="source"
                position={Position.Right}
                className="!w-3 !h-3 !bg-yellow-400 !border-2 !border-gray-900"
            />
        </div>
    )
}

// Group node component (parent container)
const GroupNode = ({ data, id, selected }: { data: any, id: string, selected: boolean }) => {
    return (
        <div className={`relative bg-gray-800/20 border-2 border-dashed rounded-xl p-4 min-w-[300px] min-h-[150px] ${selected ? 'border-yellow-400/60' : 'border-gray-600/40'
            }`}>
            <div className="absolute -top-3 left-4 bg-gray-900 px-3 py-1 rounded-full border border-gray-600">
                <span className="text-sm font-semibold text-yellow-400">📦 {data.label}</span>
            </div>
            {data.description && (
                <div className="absolute top-6 left-4 text-xs text-gray-400 max-w-[250px]">
                    {data.description}
                </div>
            )}

            {/* Handles for the group node */}
            <Handle
                type="target"
                position={Position.Left}
                className="!w-3 !h-3 !bg-yellow-400 !border-2 !border-gray-900"
            />

            <Handle
                type="source"
                position={Position.Right}
                className="!w-3 !h-3 !bg-yellow-400 !border-2 !border-gray-900"
            />
        </div>
    )
}

// Node types for React Flow
const nodeTypes = {
    processNode: ProcessNode,
    group: GroupNode,
}

// Dagre layout configuration
const dagreGraph = new dagre.graphlib.Graph()
dagreGraph.setDefaultEdgeLabel(() => ({}))

// Function to layout nodes within a group using Dagre
const layoutNodesInGroup = (
    groupNodes: Node[],
    groupEdges: Edge[],
    groupWidth: number,
    groupHeight: number,
    direction: 'TB' | 'LR' = 'TB',
    config = {
        nodeSpacing: 40,
        rankSpacing: 60,
        groupMarginX: 20,
        groupMarginY: 40,
        maxNodesPerRank: 3
    }
) => {
    if (groupNodes.length <= 1) {
        // If only one node, center it
        if (groupNodes.length === 1) {
            return [{
                ...groupNodes[0],
                position: { x: groupWidth / 2 - 90, y: groupHeight / 2 - 40 }
            }]
        }
        return groupNodes
    }

    // Create a new graph for the group layout
    const groupGraph = new dagre.graphlib.Graph()
    groupGraph.setDefaultEdgeLabel(() => ({}))

    // Configure for compact layout within the group - use same direction as main layout
    const isHorizontal = direction === 'LR'

    // Use configuration values for spacing
    groupGraph.setGraph({
        rankdir: direction,
        ranksep: isHorizontal ? config.rankSpacing + 20 : config.rankSpacing,
        nodesep: config.nodeSpacing,
        marginx: config.groupMarginX,
        marginy: config.groupMarginY,
    })

    // Add nodes to the group graph
    groupNodes.forEach((node) => {
        groupGraph.setNode(node.id, { width: 160, height: 60 })
    })

    // Add edges between nodes in this group
    groupEdges.forEach((edge) => {
        groupGraph.setEdge(edge.source, edge.target)
    })

    // Apply layout
    dagre.layout(groupGraph)

    // Update node positions based on layout
    const layoutedGroupNodes = groupNodes.map((node) => {
        const nodeWithPosition = groupGraph.node(node.id)
        return {
            ...node,
            position: {
                x: nodeWithPosition.x - 80, // Half of width (160/2)
                y: nodeWithPosition.y - 30, // Half of height (60/2)
            },
        }
    })

    return layoutedGroupNodes
}

const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'TB') => {
    const isHorizontal = direction === 'LR'
    dagreGraph.setGraph({
        rankdir: direction,
        ranksep: isHorizontal ? 300 : 150, // Increased spacing for groups
        nodesep: isHorizontal ? 150 : 120
    })

    // Only layout parent nodes (groups and standalone nodes), not children
    const parentNodes = nodes.filter(node => !node.parentId)

    parentNodes.forEach((node) => {
        // Use actual dimensions for group nodes, default for others
        const width = typeof node.style?.width === 'number' ? node.style.width : 200
        const height = typeof node.style?.height === 'number' ? node.style.height : 80
        dagreGraph.setNode(node.id, { width, height })
    })

    edges.forEach((edge) => {
        // Only add edges between parent nodes for layout
        const sourceIsParent = parentNodes.some(n => n.id === edge.source)
        const targetIsParent = parentNodes.some(n => n.id === edge.target)
        if (sourceIsParent && targetIsParent) {
            dagreGraph.setEdge(edge.source, edge.target)
        }
    })

    dagre.layout(dagreGraph)

    const layoutedNodes = nodes.map((node) => {
        if (node.parentId) {
            // Child nodes keep their relative position within the parent
            return {
                ...node,
                targetPosition: isHorizontal ? Position.Left : Position.Top,
                sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
            }
        }

        // Parent nodes get positioned by dagre
        const nodeWithPosition = dagreGraph.node(node.id)
        const width = typeof node.style?.width === 'number' ? node.style.width : 200
        const height = typeof node.style?.height === 'number' ? node.style.height : 80

        const newNode = {
            ...node,
            targetPosition: isHorizontal ? Position.Left : Position.Top,
            sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
            position: {
                x: nodeWithPosition.x - width / 2,
                y: nodeWithPosition.y - height / 2,
            },
        }

        return newNode
    })

    return { nodes: layoutedNodes, edges }
}

export default function PlannerPage() {
    const { user, loading: authLoading } = useAuth()
    const { selectedOrgId } = useOrg()
    const router = useRouter()

    const [nodes, setNodes] = useState<Node[]>([])
    const [edges, setEdges] = useState<Edge[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [layoutDirection, setLayoutDirection] = useState<'TB' | 'LR'>('LR') // Default to horizontal

    // Layout configuration state
    const [layoutConfig, setLayoutConfig] = useState({
        nodeSpacing: 40,     // Space between nodes
        rankSpacing: 60,     // Space between ranks/rows
        groupMarginX: 20,    // Horizontal margin inside groups
        groupMarginY: 40,    // Vertical margin inside groups
        maxNodesPerRank: 3,  // Maximum nodes per row/column in auto layout
    })
    const [showConfig, setShowConfig] = useState(false) // Toggle for config panel

    // Handle authentication
    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/login')
        }
    }, [user, authLoading, router])

    // Fetch data from Supabase
    const fetchFlowData = useCallback(async (direction: 'TB' | 'LR' = 'LR') => {
        if (!selectedOrgId) return

        try {
            setLoading(true)
            setError(null)

            // Fetch process steps
            const { data: processSteps, error: stepsError } = await supabase
                .from('process_step')
                .select('*')
                .eq('organisation_id', selectedOrgId)

            if (stepsError) throw stepsError

            // Fetch process flow edges
            const { data: processEdges, error: edgesError } = await supabase
                .from('process_flow_edge')
                .select('*')
                .eq('organisation_id', selectedOrgId)

            if (edgesError) throw edgesError

            // Convert process steps to React Flow nodes with grouping
            const processStepsData = processSteps || []

            // Create a map to track which nodes have children
            const childrenByParent = new Map<string, ProcessStep[]>()
            processStepsData.forEach(step => {
                if (step.parent_step_id) {
                    if (!childrenByParent.has(step.parent_step_id)) {
                        childrenByParent.set(step.parent_step_id, [])
                    }
                    childrenByParent.get(step.parent_step_id)!.push(step)
                }
            })

            // Create nodes with grouping
            const flowNodes: Node[] = []
            const addedNodes = new Set<string>()

            processStepsData.forEach((step: ProcessStep) => {
                const children = childrenByParent.get(step.id) || []
                const hasChildren = children.length > 0

                // If this is a parent node with children, create a group
                if (hasChildren && !addedNodes.has(step.id)) {
                    // First, create temporary child nodes to calculate layout
                    const tempChildNodes: Node[] = children.map((child, index) => ({
                        id: child.id,
                        type: 'processNode',
                        position: { x: 0, y: 0 }, // Will be set by dagre
                        data: {
                            label: child.name,
                            description: child.description,
                            metadata: child.metadata,
                            hasChildren: false,
                            isExpanded: false,
                        },
                    }))

                    // Get edges between children in this group
                    const childIds = new Set(children.map(c => c.id))
                    const childEdges = (processEdges || [])
                        .filter((edge: ProcessFlowEdge) =>
                            edge.from_step_id &&
                            edge.to_step_id &&
                            childIds.has(edge.from_step_id) &&
                            childIds.has(edge.to_step_id)
                        )
                        .map((edge: ProcessFlowEdge) => ({
                            id: edge.id,
                            source: edge.from_step_id!,
                            target: edge.to_step_id!,
                        }))

                    // Calculate required group size based on potential layout
                    const baseGroupWidth = Math.max(300, children.length * 120 + 100)
                    const baseGroupHeight = Math.max(200, Math.ceil(children.length / 2) * 80 + 120)

                    // Layout children within the group using Dagre
                    const layoutedChildren = layoutNodesInGroup(tempChildNodes, childEdges, baseGroupWidth, baseGroupHeight, direction, layoutConfig)

                    // Calculate actual required dimensions based on layouted positions
                    const childPositions = layoutedChildren.map(node => node.position)
                    const minX = Math.min(...childPositions.map(p => p.x))
                    const maxX = Math.max(...childPositions.map(p => p.x + 160)) // 160 = node width
                    const minY = Math.min(...childPositions.map(p => p.y))
                    const maxY = Math.max(...childPositions.map(p => p.y + 60))   // 60 = node height

                    const groupWidth = Math.max(baseGroupWidth, maxX - minX + 40)
                    const groupHeight = Math.max(baseGroupHeight, maxY - minY + 80)

                    // Create the group node
                    flowNodes.push({
                        id: step.id,
                        type: 'group',
                        position: { x: 0, y: 0 }, // Will be set by layout
                        data: {
                            label: step.name,
                            description: step.description,
                            metadata: step.metadata,
                        },
                        style: {
                            width: groupWidth,
                            height: groupHeight,
                        },
                    })

                    // Add the layouted children nodes within the group
                    layoutedChildren.forEach((layoutedChild) => {
                        flowNodes.push({
                            ...layoutedChild,
                            parentId: step.id,
                            extent: 'parent' as const,
                            style: {
                                width: 160,
                            },
                        })
                        addedNodes.add(layoutedChild.id)
                    })

                    addedNodes.add(step.id)
                }
                // If this is a standalone node (no parent, no children), add it normally
                else if (!step.parent_step_id && !hasChildren && !addedNodes.has(step.id)) {
                    flowNodes.push({
                        id: step.id,
                        type: 'processNode',
                        position: { x: 0, y: 0 }, // Will be set by layout
                        data: {
                            label: step.name,
                            description: step.description,
                            metadata: step.metadata,
                            hasChildren: false,
                            isExpanded: false,
                        },
                    })
                    addedNodes.add(step.id)
                }
                // If this is a parent node without a parent but also without children
                else if (!step.parent_step_id && !hasChildren && !addedNodes.has(step.id)) {
                    flowNodes.push({
                        id: step.id,
                        type: 'processNode',
                        position: { x: 0, y: 0 }, // Will be set by layout
                        data: {
                            label: step.name,
                            description: step.description,
                            metadata: step.metadata,
                            hasChildren: false,
                            isExpanded: false,
                        },
                    })
                    addedNodes.add(step.id)
                }
            })

            // Convert process edges to React Flow edges (only show edges between visible nodes)
            const visibleNodeIds = new Set(flowNodes.map(node => node.id))
            const flowEdges: Edge[] = (processEdges || [])
                .filter((edge: ProcessFlowEdge) =>
                    edge.from_step_id &&
                    edge.to_step_id &&
                    visibleNodeIds.has(edge.from_step_id) &&
                    visibleNodeIds.has(edge.to_step_id)
                )
                .map((edge: ProcessFlowEdge) => ({
                    id: edge.id,
                    source: edge.from_step_id!,
                    target: edge.to_step_id!,
                    label: edge.label || '',
                    type: 'smoothstep',
                    style: {
                        stroke: '#fbbf24',
                        strokeWidth: 2,
                    },
                    labelStyle: {
                        fill: '#f3f4f6',
                        fontSize: '12px',
                        fontWeight: '500',
                    },
                    labelBgStyle: {
                        fill: '#111827',
                        fillOpacity: 0.8,
                    },
                }))

            // Apply dagre layout to all nodes
            const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
                flowNodes,
                flowEdges,
                'LR' // Left to Right layout (horizontal)
            )

            setNodes(layoutedNodes)
            setEdges(layoutedEdges)
        } catch (err) {
            console.error('Error fetching flow data:', err)
            setError(err instanceof Error ? err.message : 'Failed to fetch flow data')
        } finally {
            setLoading(false)
        }
    }, [selectedOrgId, layoutDirection, layoutConfig])

    useEffect(() => {
        if (selectedOrgId && user) {
            fetchFlowData(layoutDirection)
        }
    }, [selectedOrgId, user, fetchFlowData, layoutDirection])

    // React Flow event handlers
    const onNodesChange = useCallback(
        (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
        [setNodes]
    )

    const onEdgesChange = useCallback(
        (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
        [setEdges]
    )

    const onConnect = useCallback(
        (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
        [setEdges]
    )

    // Re-layout function for when nodes/edges change
    const onLayout = useCallback(
        (direction: 'TB' | 'LR') => {
            const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
                nodes,
                edges,
                direction
            )

            setNodes([...layoutedNodes])
            setEdges([...layoutedEdges])
            setLayoutDirection(direction)
        },
        [nodes, edges]
    )

    // Loading states
    if (authLoading || loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-950">
                <div className="text-lg text-gray-100">Loading planner...</div>
            </div>
        )
    }

    if (!user) {
        return null // Will redirect to login
    }

    if (!selectedOrgId) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-950">
                <div className="text-lg text-gray-100">Please select an organization to view the planner.</div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-950">
                <div className="text-lg text-red-400">Error: {error}</div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-950">
            <style dangerouslySetInnerHTML={{ __html: sliderStyles }} />
            {/* Header */}
            <nav className="bg-gray-900 shadow">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16">
                        <div className="flex items-center">
                            <button
                                onClick={() => router.push('/home')}
                                className="text-yellow-400 hover:text-yellow-300 mr-4"
                            >
                                ← Back to Dashboard
                            </button>
                            <h1 className="text-xl font-semibold text-yellow-400">
                                ⚡ Planner
                            </h1>
                        </div>
                        <div className="flex items-center space-x-4">
                            <span className="text-sm text-gray-300">
                                {user.email}
                            </span>
                            <button
                                onClick={() => onLayout('TB')}
                                className={`px-3 py-1.5 rounded-md text-sm font-medium ${layoutDirection === 'TB'
                                    ? 'bg-yellow-400 text-gray-900'
                                    : 'bg-gray-700 hover:bg-gray-600 text-gray-100'
                                    }`}
                            >
                                Vertical Layout
                            </button>
                            <button
                                onClick={() => onLayout('LR')}
                                className={`px-3 py-1.5 rounded-md text-sm font-medium ${layoutDirection === 'LR'
                                    ? 'bg-yellow-400 text-gray-900'
                                    : 'bg-gray-700 hover:bg-gray-600 text-gray-100'
                                    }`}
                            >
                                Horizontal Layout
                            </button>
                            <button
                                onClick={() => setShowConfig(!showConfig)}
                                className={`px-3 py-1.5 rounded-md text-sm font-medium ${showConfig
                                    ? 'bg-yellow-400 text-gray-900'
                                    : 'bg-gray-700 hover:bg-gray-600 text-gray-100'
                                    }`}
                            >
                                ⚙️ Config
                            </button>
                            <button
                                onClick={() => fetchFlowData(layoutDirection)}
                                className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 px-4 py-2 rounded-md text-sm font-medium"
                            >
                                Refresh
                            </button>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Configuration Panel */}
            {showConfig && (
                <div className="bg-gray-800 border-b border-gray-700 px-4 py-3">
                    <div className="max-w-7xl mx-auto">
                        <h3 className="text-lg font-semibold text-yellow-400 mb-3">Layout Configuration</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">
                                    Node Spacing
                                </label>
                                <input
                                    type="range"
                                    min="20"
                                    max="100"
                                    value={layoutConfig.nodeSpacing}
                                    onChange={(e) => setLayoutConfig(prev => ({ ...prev, nodeSpacing: parseInt(e.target.value) }))}
                                    className="config-slider"
                                />
                                <span className="text-xs text-gray-400">{layoutConfig.nodeSpacing}px</span>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">
                                    Rank Spacing
                                </label>
                                <input
                                    type="range"
                                    min="30"
                                    max="150"
                                    value={layoutConfig.rankSpacing}
                                    onChange={(e) => setLayoutConfig(prev => ({ ...prev, rankSpacing: parseInt(e.target.value) }))}
                                    className="config-slider"
                                />
                                <span className="text-xs text-gray-400">{layoutConfig.rankSpacing}px</span>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">
                                    Group Margin X
                                </label>
                                <input
                                    type="range"
                                    min="10"
                                    max="50"
                                    value={layoutConfig.groupMarginX}
                                    onChange={(e) => setLayoutConfig(prev => ({ ...prev, groupMarginX: parseInt(e.target.value) }))}
                                    className="config-slider"
                                />
                                <span className="text-xs text-gray-400">{layoutConfig.groupMarginX}px</span>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">
                                    Group Margin Y
                                </label>
                                <input
                                    type="range"
                                    min="20"
                                    max="80"
                                    value={layoutConfig.groupMarginY}
                                    onChange={(e) => setLayoutConfig(prev => ({ ...prev, groupMarginY: parseInt(e.target.value) }))}
                                    className="config-slider"
                                />
                                <span className="text-xs text-gray-400">{layoutConfig.groupMarginY}px</span>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">
                                    Max Nodes Per Rank
                                </label>
                                <input
                                    type="range"
                                    min="2"
                                    max="8"
                                    value={layoutConfig.maxNodesPerRank}
                                    onChange={(e) => setLayoutConfig(prev => ({ ...prev, maxNodesPerRank: parseInt(e.target.value) }))}
                                    className="config-slider"
                                />
                                <span className="text-xs text-gray-400">{layoutConfig.maxNodesPerRank} nodes</span>
                            </div>
                        </div>

                        <div className="flex items-center justify-between mt-4">
                            <div className="text-xs text-gray-400">
                                Changes apply automatically to group layouts
                            </div>
                            <button
                                onClick={() => setLayoutConfig({
                                    nodeSpacing: 40,
                                    rankSpacing: 60,
                                    groupMarginX: 20,
                                    groupMarginY: 40,
                                    maxNodesPerRank: 3,
                                })}
                                className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-100 rounded-md"
                            >
                                Reset to Defaults
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content */}
            <main className={`h-screen ${showConfig ? 'pt-[280px]' : 'pt-16'}`}>
                <div className="h-full w-full">
                    {nodes.length === 0 ? (
                        <div className="h-full flex items-center justify-center">
                            <div className="text-center">
                                <h2 className="text-xl font-semibold text-gray-100 mb-2">
                                    No Process Steps Found
                                </h2>
                                <p className="text-gray-400">
                                    Create some process steps to see them visualized here.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <ReactFlow
                            nodes={nodes}
                            edges={edges}
                            onNodesChange={onNodesChange}
                            onEdgesChange={onEdgesChange}
                            onConnect={onConnect}
                            nodeTypes={nodeTypes}
                            fitView
                            attributionPosition="bottom-left"
                            className="bg-gray-950"
                            defaultEdgeOptions={{
                                style: { stroke: '#fbbf24', strokeWidth: 2 },
                                type: 'smoothstep',
                            }}
                        >
                            <Controls
                                className="bg-gray-800 border border-gray-600 rounded-lg [&_button]:bg-gray-700 [&_button]:border-gray-600 [&_button]:text-gray-100 [&_button:hover]:bg-gray-600"
                            />
                            <Background
                                variant={BackgroundVariant.Dots}
                                gap={20}
                                size={1}
                                color="#374151"
                                className="bg-gray-950"
                            />
                        </ReactFlow>
                    )}
                </div>
            </main>
        </div>
    )
}
