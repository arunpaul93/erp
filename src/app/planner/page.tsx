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
    <div className={`px-4 py-3 shadow-lg rounded-lg border-2 bg-gray-900 min-w-[200px] relative ${
      selected ? 'border-yellow-400' : 'border-gray-700'
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
    <div className={`relative bg-gray-800/20 border-2 border-dashed rounded-xl p-4 min-w-[300px] min-h-[150px] ${
      selected ? 'border-yellow-400/60' : 'border-gray-600/40'
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
}

// Dagre layout configuration
const dagreGraph = new dagre.graphlib.Graph()
dagreGraph.setDefaultEdgeLabel(() => ({}))

const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'TB') => {
  const isHorizontal = direction === 'LR'
  dagreGraph.setGraph({ 
    rankdir: direction, 
    ranksep: isHorizontal ? 200 : 100, 
    nodesep: isHorizontal ? 100 : 80 
  })

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 200, height: 80 })
  })

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    
    const newNode = {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: nodeWithPosition.x - 100, // Half of width
        y: nodeWithPosition.y - 40,  // Half of height
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
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

  // Toggle expand/collapse for nodes with children
  const toggleNodeExpansion = (nodeId: string) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev)
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId)
      } else {
        newSet.add(nodeId)
      }
      return newSet
    })
  }

  // Handle authentication
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
    }
  }, [user, authLoading, router])

  // Fetch data from Supabase
  const fetchFlowData = useCallback(async () => {
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

      // Convert process steps to React Flow nodes (simple layout without grouping)
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

      // Filter nodes based on expansion state
      const getVisibleNodes = () => {
        const visibleSteps: ProcessStep[] = []
        
        processStepsData.forEach(step => {
          // Always show nodes that don't have a parent
          if (!step.parent_step_id) {
            visibleSteps.push(step)
          } else {
            // Only show child nodes if their parent is expanded
            if (expandedNodes.has(step.parent_step_id)) {
              visibleSteps.push(step)
            }
          }
        })
        
        return visibleSteps
      }

      const visibleSteps = getVisibleNodes()

      const flowNodes: Node[] = visibleSteps.map((step: ProcessStep) => {
        const children = childrenByParent.get(step.id) || []
        const hasChildren = children.length > 0
        const isExpanded = expandedNodes.has(step.id)
        
        return {
          id: step.id,
          type: 'processNode',
          position: { x: 0, y: 0 }, // Will be set by dagre layout
          data: { 
            label: step.name,
            description: step.description,
            metadata: step.metadata,
            hasChildren: hasChildren,
            children: children,
            childrenCount: children.length,
            isExpanded: isExpanded,
            onToggleExpand: toggleNodeExpansion,
          },
        }
      })

      // Convert process edges to React Flow edges (only show edges between visible nodes)
      const visibleNodeIds = new Set(visibleSteps.map(step => step.id))
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
  }, [selectedOrgId, expandedNodes])

  useEffect(() => {
    if (selectedOrgId && user) {
      fetchFlowData()
    }
  }, [selectedOrgId, user, fetchFlowData, expandedNodes])

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
                className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                  layoutDirection === 'TB' 
                    ? 'bg-yellow-400 text-gray-900' 
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-100'
                }`}
              >
                Vertical Layout
              </button>
              <button
                onClick={() => onLayout('LR')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                  layoutDirection === 'LR' 
                    ? 'bg-yellow-400 text-gray-900' 
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-100'
                }`}
              >
                Horizontal Layout
              </button>
              <button
                onClick={fetchFlowData}
                className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 px-4 py-2 rounded-md text-sm font-medium"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="h-screen pt-16">
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
